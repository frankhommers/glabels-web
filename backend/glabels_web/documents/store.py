"""Document storage: files on disk, metadata in SQLite.

Every save makes a new revision. Preview and printing always refer to a
recorded revision, so what you see is what gets printed.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .models import DocumentInfo

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    revision             INTEGER NOT NULL,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    template_brand       TEXT NOT NULL,
    template_part        TEXT NOT NULL,
    template_description TEXT NOT NULL DEFAULT '',
    merge_source_path    TEXT NOT NULL DEFAULT '',
    -- Ids of the objects in document order, as JSON. They do not belong in
    -- the .glabels file; they belong to this application.
    object_ids           TEXT NOT NULL DEFAULT '[]',
    -- The .glabels file in the shared folder this project lives in, and the
    -- SHA-256 of what was there when we last wrote or read it. That is how we
    -- see whether someone changed the file outside the app.
    file_path            TEXT NOT NULL DEFAULT '',
    file_sha256          TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

-- Print jobs sent. Needed to recognise a repeated submission and to ask the
-- printer for the state later; the printer itself stays the source of truth
-- for that state.
CREATE TABLE IF NOT EXISTS print_requests (
    request_id   TEXT PRIMARY KEY,
    document_id  TEXT NOT NULL,
    printer      TEXT NOT NULL,
    printer_uri  TEXT NOT NULL DEFAULT '',
    title        TEXT NOT NULL DEFAULT '',
    job_id       INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    -- Final state once the printer reports it (completed, canceled,
    -- aborted). After that we no longer need to ask the printer.
    final_state_code INTEGER NOT NULL DEFAULT 0,
    final_reasons    TEXT NOT NULL DEFAULT ''
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class DocumentNotFound(LookupError):
    pass


@dataclass(frozen=True)
class PrintRecord:
    """A job we sent to a printer."""

    request_id: str
    document_id: str
    printer: str
    printer_uri: str
    title: str
    job_id: int
    created_at: str
    final_state_code: int = 0
    final_reasons: str = ""

    @property
    def finished(self) -> bool:
        return self.final_state_code != 0


def _print_record(row: sqlite3.Row) -> PrintRecord:
    return PrintRecord(
        request_id=row["request_id"],
        document_id=row["document_id"],
        printer=row["printer"],
        printer_uri=row["printer_uri"],
        title=row["title"],
        job_id=row["job_id"],
        created_at=row["created_at"],
        final_state_code=row["final_state_code"],
        final_reasons=row["final_reasons"],
    )


class DocumentStore:
    def __init__(self, database_path: Path, documents_dir: Path):
        self._db_path = database_path
        self._dir = documents_dir
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._dir.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_SCHEMA)
            if conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == 0:
                conn.execute("INSERT INTO schema_version (version) VALUES (1)")
            # Add columns for databases from before they existed.
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(documents)")}
            if "merge_source_path" not in columns:
                conn.execute(
                    "ALTER TABLE documents ADD COLUMN merge_source_path TEXT NOT NULL DEFAULT ''"
                )
            if "object_ids" not in columns:
                conn.execute(
                    "ALTER TABLE documents ADD COLUMN object_ids TEXT NOT NULL DEFAULT '[]'"
                )
            for column in ("file_path", "file_sha256"):
                if column not in columns:
                    conn.execute(
                        f"ALTER TABLE documents ADD COLUMN {column} TEXT NOT NULL DEFAULT ''"
                    )
            job_columns = {row["name"] for row in conn.execute("PRAGMA table_info(print_requests)")}
            for column in ("printer_uri", "title", "final_reasons"):
                if column not in job_columns:
                    conn.execute(
                        f"ALTER TABLE print_requests ADD COLUMN {column} TEXT NOT NULL DEFAULT ''"
                    )
            if "final_state_code" not in job_columns:
                conn.execute(
                    "ALTER TABLE print_requests ADD COLUMN final_state_code INTEGER NOT NULL DEFAULT 0"
                )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    # ----------------------------------------------------------------- paths
    def _doc_dir(self, doc_id: str) -> Path:
        # Only our own generated UUIDs; never a path from a request.
        uuid.UUID(doc_id)
        return self._dir / doc_id

    def revision_path(self, doc_id: str, revision: int) -> Path:
        return self._doc_dir(doc_id) / f"rev-{revision:06d}.glabels"

    def render_path(self, doc_id: str, revision: int, settings_key: str) -> Path:
        digest = hashlib.sha256(settings_key.encode("utf-8")).hexdigest()[:16]
        return self._doc_dir(doc_id) / "renders" / f"rev-{revision:06d}-{digest}.pdf"

    # ------------------------------------------------------------- metadata
    def _row_to_info(self, row: sqlite3.Row) -> DocumentInfo:
        return DocumentInfo(
            id=row["id"],
            name=row["name"],
            revision=row["revision"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            template_brand=row["template_brand"],
            template_part=row["template_part"],
            template_description=row["template_description"],
            merge_source_path=row["merge_source_path"] or None,
            file_path=row["file_path"] or None,
        )

    def list(self) -> list[DocumentInfo]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM documents ORDER BY updated_at DESC").fetchall()
        return [self._row_to_info(row) for row in rows]

    def info(self, doc_id: str) -> DocumentInfo:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if row is None:
            raise DocumentNotFound(doc_id)
        return self._row_to_info(row)

    # -------------------------------------------------------------- actions
    def create(
        self,
        *,
        name: str,
        xml_bytes: bytes,
        template_brand: str,
        template_part: str,
        template_description: str = "",
    ) -> DocumentInfo:
        doc_id = str(uuid.uuid4())
        now = _now()
        path = self.revision_path(doc_id, 1)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(xml_bytes)
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO documents "
                "(id, name, revision, created_at, updated_at, template_brand, template_part, template_description) "
                "VALUES (?, ?, 1, ?, ?, ?, ?, ?)",
                (doc_id, name, now, now, template_brand, template_part, template_description),
            )
        return self.info(doc_id)

    def save_revision(
        self,
        doc_id: str,
        xml_bytes: bytes,
        *,
        name: str | None = None,
        object_ids: list[str] | None = None,
    ) -> DocumentInfo:
        """Record a new revision.

        If the content equals the current revision, that one stays. That way
        autosave does not pile up identical revisions.
        """
        info = self.info(doc_id)
        current = self.revision_path(doc_id, info.revision)
        unchanged = current.exists() and current.read_bytes() == xml_bytes

        revision = info.revision if unchanged else info.revision + 1
        if not unchanged:
            path = self.revision_path(doc_id, revision)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(xml_bytes)

        with self._connect() as conn:
            conn.execute(
                "UPDATE documents SET revision = ?, updated_at = ?, name = COALESCE(?, name), "
                "object_ids = COALESCE(?, object_ids) WHERE id = ?",
                (
                    revision,
                    _now(),
                    name,
                    json.dumps(object_ids) if object_ids is not None else None,
                    doc_id,
                ),
            )
        return self.info(doc_id)

    def object_ids(self, doc_id: str) -> list[str]:
        with self._connect() as conn:
            row = conn.execute("SELECT object_ids FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if row is None:
            raise DocumentNotFound(doc_id)
        try:
            value = json.loads(row["object_ids"])
        except (TypeError, ValueError):
            return []
        return [str(item) for item in value] if isinstance(value, list) else []

    def set_object_ids(self, doc_id: str, object_ids: list[str]) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE documents SET object_ids = ? WHERE id = ?", (json.dumps(object_ids), doc_id)
            )

    def read_revision(self, doc_id: str, revision: int | None = None) -> bytes:
        info = self.info(doc_id)
        path = self.revision_path(doc_id, revision if revision is not None else info.revision)
        if not path.exists():
            raise DocumentNotFound(f"{doc_id}@{revision}")
        return path.read_bytes()

    # ----------------------------------------------------- file in the folder
    def file_link(self, doc_id: str) -> tuple[str | None, str]:
        """The linked file and the hash we last knew for it."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT file_path, file_sha256 FROM documents WHERE id = ?", (doc_id,)
            ).fetchone()
        if row is None:
            raise DocumentNotFound(doc_id)
        return (row["file_path"] or None, row["file_sha256"] or "")

    def set_file_link(self, doc_id: str, path: str | None, sha256: str = "") -> DocumentInfo:
        self.info(doc_id)
        with self._connect() as conn:
            conn.execute(
                "UPDATE documents SET file_path = ?, file_sha256 = ? WHERE id = ?",
                (path or "", sha256 if path else "", doc_id),
            )
        return self.info(doc_id)

    def find_by_file(self, path: str) -> DocumentInfo | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM documents WHERE file_path = ? ORDER BY updated_at DESC LIMIT 1",
                (path,),
            ).fetchone()
        return self._row_to_info(row) if row else None

    def set_merge_source(self, doc_id: str, path: str | None) -> DocumentInfo:
        """Remember which file in the shared folder is the merge source.

        The document itself only holds a bare file name, so it stays usable on
        a desktop; where that file lives here is application metadata and
        belongs in the database.
        """
        self.info(doc_id)
        with self._connect() as conn:
            conn.execute(
                "UPDATE documents SET merge_source_path = ?, updated_at = ? WHERE id = ?",
                (path or "", _now(), doc_id),
            )
        return self.info(doc_id)

    # -------------------------------------------------------------- print jobs
    def find_print_request(self, request_id: str) -> PrintRecord | None:
        """Has this request been sent before?"""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM print_requests WHERE request_id = ?", (request_id,)
            ).fetchone()
        return _print_record(row) if row else None

    def record_print_request(
        self,
        request_id: str,
        doc_id: str,
        printer: str,
        printer_uri: str,
        job_id: int,
        title: str,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO print_requests "
                "(request_id, document_id, printer, printer_uri, title, job_id, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (request_id, doc_id, printer, printer_uri, title, job_id, _now()),
            )

    def recent_print_requests(self, limit: int = 20, offset: int = 0) -> list[PrintRecord]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM print_requests ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return [_print_record(row) for row in rows]

    def count_print_requests(self) -> int:
        with self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM print_requests").fetchone()[0]

    def finish_print_request(self, request_id: str, state_code: int, reasons: str) -> None:
        """Record the final state; the printer need not be asked after that."""
        with self._connect() as conn:
            conn.execute(
                "UPDATE print_requests SET final_state_code = ?, final_reasons = ? WHERE request_id = ?",
                (state_code, reasons, request_id),
            )

    # How much print job history is kept.
    HISTORY_KEEP = 100
    HISTORY_MAX_AGE_DAYS = 30

    def prune_print_requests(
        self, *, keep: int = HISTORY_KEEP, max_age_days: int = HISTORY_MAX_AGE_DAYS
    ) -> int:
        """Clean up old jobs.

        Everything older than `max_age_days` goes, finished or not. Of the
        rest, the newest `keep` jobs stay; beyond that only finished jobs are
        removed, so a job that may still be running is never dropped early.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat(
            timespec="seconds"
        )
        with self._connect() as conn:
            # Too old: gone, even if the printer never gave a final state (a
            # printer that has since disappeared, for example).
            cursor = conn.execute("DELETE FROM print_requests WHERE created_at < ?", (cutoff,))
            removed = cursor.rowcount
            cursor = conn.execute(
                "DELETE FROM print_requests WHERE final_state_code != 0 AND request_id NOT IN ("
                "SELECT request_id FROM print_requests "
                "ORDER BY created_at DESC, rowid DESC LIMIT ?)",
                (keep,),
            )
            return removed + cursor.rowcount

    def clear_finished_print_requests(self, *, stale_after_minutes: int = 60) -> int:
        """Clear the history, except jobs that may still be running.

        Finished jobs go. A job without a final state stays as long as it is
        younger than `stale_after_minutes`; after that it is almost certainly
        stuck, or belongs to a printer that is gone.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=stale_after_minutes)).isoformat(
            timespec="seconds"
        )
        with self._connect() as conn:
            return conn.execute(
                "DELETE FROM print_requests WHERE final_state_code != 0 OR created_at < ?",
                (cutoff,),
            ).rowcount

    def forget_print_request(self, request_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM print_requests WHERE request_id = ?", (request_id,))

    def rename(self, doc_id: str, name: str) -> DocumentInfo:
        self.info(doc_id)
        with self._connect() as conn:
            conn.execute("UPDATE documents SET name = ?, updated_at = ? WHERE id = ?", (name, _now(), doc_id))
        return self.info(doc_id)

    def delete(self, doc_id: str) -> None:
        self.info(doc_id)
        shutil.rmtree(self._doc_dir(doc_id), ignore_errors=True)
        with self._connect() as conn:
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
