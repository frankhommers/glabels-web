"""Fonts that both the browser and the renderer can use.

The renderer makes the PDF with the fonts inside the container. To see the
same in the editor, the API serves those same files to the browser. Uploads
land on a shared volume, so fontconfig in the renderer finds them too.
"""

from __future__ import annotations

import hashlib
import logging
import re
import shutil
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .sfnt import FontError, read_names

log = logging.getLogger(__name__)

SUFFIXES = (".ttf", ".otf", ".ttc")
MAX_FONT_BYTES = 20 * 1024 * 1024

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    cleaned = _SAFE.sub("-", normalized).strip("-._")
    return cleaned or "font"


@dataclass(frozen=True)
class FontFace:
    id: str
    family: str
    subfamily: str
    full_name: str
    source: Literal["builtin", "uploaded"]
    path: Path
    size_bytes: int

    @property
    def bold(self) -> bool:
        return "bold" in self.subfamily.casefold()

    @property
    def italic(self) -> bool:
        lowered = self.subfamily.casefold()
        return "italic" in lowered or "oblique" in lowered

    @property
    def media_type(self) -> str:
        suffix = self.path.suffix.casefold()
        if suffix == ".otf":
            return "font/otf"
        if suffix == ".ttc":
            return "font/collection"
        return "font/ttf"


class FontLibrary:
    def __init__(self, builtin_dir: Path, upload_dir: Path):
        self._builtin_dir = builtin_dir
        self._upload_dir = upload_dir
        self._faces: dict[str, FontFace] = {}
        self._stamp: tuple[float, int] | None = None
        self.reload()

    # ------------------------------------------------------------------ index
    def _upload_stamp(self) -> tuple[float, int]:
        """Cheap fingerprint of the upload folder: latest change and count."""
        if not self._upload_dir.is_dir():
            return (0.0, 0)
        newest = 0.0
        count = 0
        for path in self._upload_dir.rglob("*"):
            if path.suffix.casefold() not in SUFFIXES or not path.is_file():
                continue
            count += 1
            newest = max(newest, path.stat().st_mtime)
        return (newest, count)

    def refresh_if_changed(self) -> bool:
        """Reload when something changed outside the web interface."""
        stamp = self._upload_stamp()
        if stamp == self._stamp:
            return False
        self.reload()
        return True

    def reload(self) -> None:
        faces: dict[str, FontFace] = {}
        for directory, source in ((self._builtin_dir, "builtin"), (self._upload_dir, "uploaded")):
            if not directory.is_dir():
                continue
            for path in sorted(directory.rglob("*")):
                if path.suffix.casefold() not in SUFFIXES or not path.is_file():
                    continue
                face = self._read_face(path, source)  # type: ignore[arg-type]
                if face is not None:
                    faces[face.id] = face
        self._faces = faces
        self._stamp = self._upload_stamp()
        log.info(
            "fonts loaded: %d files, %d families",
            len(faces),
            len({face.family for face in faces.values()}),
        )

    def _read_face(self, path: Path, source: Literal["builtin", "uploaded"]) -> FontFace | None:
        try:
            data = path.read_bytes()
            names = read_names(data)
        except (OSError, FontError) as exc:
            log.warning("font skipped %s: %s", path, exc)
            return None
        digest = hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:16]
        return FontFace(
            id=digest,
            family=names.family,
            subfamily=names.subfamily,
            full_name=names.full_name,
            source=source,
            path=path,
            size_bytes=len(data),
        )

    # ------------------------------------------------------------------ queries
    def faces(self) -> list[FontFace]:
        return sorted(self._faces.values(), key=lambda face: (face.family.casefold(), face.subfamily))

    def face(self, face_id: str) -> FontFace | None:
        return self._faces.get(face_id)

    def families(self) -> list[str]:
        return sorted({face.family for face in self._faces.values()}, key=str.casefold)

    def has_family(self, family: str) -> bool:
        needle = family.casefold()
        return any(face.family.casefold() == needle for face in self._faces.values())

    # ---------------------------------------------------------------- management
    def add_upload(self, filename: str, data: bytes) -> FontFace:
        """Store an uploaded font after checking its content."""
        if len(data) > MAX_FONT_BYTES:
            raise FontError("the font file is too large")
        # The content decides whether we accept it, not the file name.
        names = read_names(data)

        suffix = Path(filename).suffix.casefold()
        if suffix not in SUFFIXES:
            suffix = ".otf" if data[:4] == b"OTTO" else ".ttf"

        self._upload_dir.mkdir(parents=True, exist_ok=True)
        target = self._upload_dir / f"{_safe_filename(names.full_name)}{suffix}"
        counter = 1
        while target.exists():
            target = self._upload_dir / f"{_safe_filename(names.full_name)}-{counter}{suffix}"
            counter += 1
        target.write_bytes(data)

        face = self._read_face(target, "uploaded")
        if face is None:
            target.unlink(missing_ok=True)
            raise FontError("the font could not be read after saving")
        self._faces[face.id] = face
        return face

    def remove_upload(self, face_id: str) -> None:
        face = self._faces.get(face_id)
        if face is None:
            raise KeyError(face_id)
        if face.source != "uploaded":
            raise PermissionError("bundled fonts cannot be deleted")
        face.path.unlink(missing_ok=True)
        del self._faces[face_id]

    @property
    def upload_dir(self) -> Path:
        return self._upload_dir

    def clear_uploads(self) -> None:
        shutil.rmtree(self._upload_dir, ignore_errors=True)
        self.reload()
