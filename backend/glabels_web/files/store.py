"""Shared folder for merge sources and .glabels files.

Everything happens inside one configured folder, mounted into the container
as a volume. Paths from a request are always checked against that folder, so
a document can never open an arbitrary host file.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import shutil
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

log = logging.getLogger(__name__)

# File kinds we recognise; everything else is shown as "other".
DOCUMENT_SUFFIXES = {".glabels"}
DATA_SUFFIXES = {".csv", ".tsv", ".txt"}
FONT_SUFFIXES = {".ttf", ".otf", ".ttc"}
DEFINITION_SUFFIXES = {".xml"}

_UNSAFE = re.compile(r"[^\w.() -]+", re.UNICODE)


class FileAreaError(ValueError):
    """Invalid path or an operation that is not allowed."""


def safe_name(name: str) -> str:
    """Turn a supplied file name into a safe plain name."""
    base = PurePosixPath(name.replace("\\", "/")).name
    base = unicodedata.normalize("NFC", base)
    cleaned = _UNSAFE.sub("_", base).strip(" .")
    if not cleaned or cleaned in (".", ".."):
        raise FileAreaError(f"unusable file name: {name!r}")
    return cleaned[:180]


@dataclass(frozen=True)
class FileEntry:
    path: str  # relative to the base folder, with forward slashes
    name: str
    is_dir: bool
    size_bytes: int
    modified_at: str
    kind: str  # "folder" | "document" | "data" | "font" | "definition" | "other"


class FileArea:
    def __init__(self, root: Path):
        self._root = root

    @property
    def root(self) -> Path:
        return self._root

    @property
    def available(self) -> bool:
        return self._root.is_dir()

    def ensure(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ paths
    def resolve(self, relative: str = "") -> Path:
        """Turn a relative path into a real path inside the base folder.

        Symbolic links are handled too: after full resolution the result must
        still lie inside the base folder.
        """
        cleaned = (relative or "").strip().replace("\\", "/").lstrip("/")
        candidate = PurePosixPath(cleaned)
        if any(part == ".." for part in candidate.parts):
            raise FileAreaError("path outside the shared folder")

        root = self._root.resolve(strict=False)
        target = (root / candidate).resolve(strict=False)
        if target != root and root not in target.parents:
            raise FileAreaError("path outside the shared folder")
        return target

    def relative(self, path: Path) -> str:
        root = self._root.resolve(strict=False)
        return path.resolve(strict=False).relative_to(root).as_posix()

    # ----------------------------------------------------------------- queries
    @staticmethod
    def _kind(path: Path) -> str:
        if path.is_dir():
            return "folder"
        suffix = path.suffix.casefold()
        if suffix in DOCUMENT_SUFFIXES:
            return "document"
        if suffix in DATA_SUFFIXES:
            return "data"
        if suffix in FONT_SUFFIXES:
            return "font"
        if suffix in DEFINITION_SUFFIXES:
            return "definition"
        return "other"

    def _entry(self, path: Path) -> FileEntry:
        stat = path.stat()
        return FileEntry(
            path=self.relative(path),
            name=path.name,
            is_dir=path.is_dir(),
            size_bytes=0 if path.is_dir() else stat.st_size,
            modified_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds"),
            kind=self._kind(path),
        )

    def list(self, relative: str = "") -> list[FileEntry]:
        directory = self.resolve(relative)
        if not directory.is_dir():
            raise FileAreaError("folder not found")
        entries = []
        for child in directory.iterdir():
            if child.name.startswith("."):
                continue  # hidden files are not shown
            try:
                entries.append(self._entry(child))
            except OSError as exc:
                log.warning("file skipped %s: %s", child, exc)
        entries.sort(key=lambda entry: (not entry.is_dir, entry.name.casefold()))
        return entries

    def read(self, relative: str, *, max_bytes: int | None = None) -> bytes:
        path = self.resolve(relative)
        if not path.is_file():
            raise FileAreaError("file not found")
        if max_bytes is not None and path.stat().st_size > max_bytes:
            raise FileAreaError("the file is larger than allowed")
        return path.read_bytes()

    def entry(self, relative: str) -> FileEntry:
        path = self.resolve(relative)
        if not path.exists():
            raise FileAreaError("file not found")
        return self._entry(path)

    # ------------------------------------------------------------------ changes
    def write(self, directory: str, name: str, data: bytes, *, overwrite: bool = False) -> FileEntry:
        parent = self.resolve(directory)
        if not parent.is_dir():
            raise FileAreaError("folder not found")
        target = parent / safe_name(name)
        if target.exists() and not overwrite:
            stem, suffix = target.stem, target.suffix
            counter = 1
            while target.exists():
                target = parent / f"{stem}-{counter}{suffix}"
                counter += 1
        target.write_bytes(data)
        return self._entry(target)

    def write_file(self, relative: str, data: bytes) -> FileEntry:
        """Write a file at a fixed path, in one go.

        First to a temporary file next to it, then rename: whoever opens the
        file at the same time (gLabels on the desktop over a network share,
        for example) never sees a half-written document.
        """
        target = self.resolve(relative)
        if not target.parent.is_dir():
            raise FileAreaError("folder not found")
        if target.is_dir():
            raise FileAreaError("there is a folder with that name")
        temporary = target.with_name(f".{target.name}.tmp")
        temporary.write_bytes(data)
        os.replace(temporary, target)
        return self._entry(target)

    def rename(self, relative: str, new_name: str) -> FileEntry:
        """Rename a file within the same folder."""
        source = self.resolve(relative)
        if not source.is_file():
            raise FileAreaError("file not found")
        target = source.parent / safe_name(new_name)
        if target == source:
            return self._entry(source)
        if target.exists():
            raise FileAreaError("a file with that name already exists")
        source.rename(target)
        return self._entry(target)

    def sha256(self, relative: str) -> str | None:
        """Hash of a file, or `None` if it is not (or no longer) there."""
        path = self.resolve(relative)
        if not path.is_file():
            return None
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def make_directory(self, directory: str, name: str) -> FileEntry:
        parent = self.resolve(directory)
        if not parent.is_dir():
            raise FileAreaError("folder not found")
        target = parent / safe_name(name)
        if target.exists():
            raise FileAreaError("something with that name already exists")
        target.mkdir()
        return self._entry(target)

    def delete(self, relative: str) -> None:
        path = self.resolve(relative)
        if path == self._root.resolve(strict=False):
            raise FileAreaError("the base folder cannot be deleted")
        if not path.exists():
            raise FileAreaError("file not found")
        if path.is_dir():
            if any(path.iterdir()):
                raise FileAreaError("the folder is not empty")
            path.rmdir()
        else:
            path.unlink()

    def copy_into(self, relative: str, destination: Path) -> Path:
        """Copy a file from the folder into a work folder for rendering."""
        source = self.resolve(relative)
        if not source.is_file():
            raise FileAreaError("file not found")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        return destination
