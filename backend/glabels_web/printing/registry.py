"""Which printers this installation knows.

Without a print service there is no CUPS keeping the list; that bookkeeping
is ours now. A printer is no more than a name for an IPP address — the
printer itself stays the source of truth for state and jobs.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .ipp_client import PrintingError, validate_name, validate_uri

_SCHEMA = """
CREATE TABLE IF NOT EXISTS printers (
    name       TEXT PRIMARY KEY,
    uri        TEXT NOT NULL,
    info       TEXT NOT NULL DEFAULT '',
    location   TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class Printer:
    name: str
    uri: str
    info: str = ""
    location: str = ""
    is_default: bool = False
    created_at: str = ""


class PrinterRegistry:
    def __init__(self, database_path: Path):
        self._path = database_path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    @staticmethod
    def _row(row: sqlite3.Row) -> Printer:
        return Printer(
            name=row["name"],
            uri=row["uri"],
            info=row["info"],
            location=row["location"],
            is_default=bool(row["is_default"]),
            created_at=row["created_at"],
        )

    def list(self) -> list[Printer]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM printers ORDER BY is_default DESC, name COLLATE NOCASE"
            ).fetchall()
        return [self._row(row) for row in rows]

    def get(self, name: str) -> Printer | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM printers WHERE name = ?", (name,)).fetchone()
        return self._row(row) if row else None

    def require(self, name: str) -> Printer:
        printer = self.get(name)
        if printer is None:
            raise PrintingError(f"unknown printer: {name!r}")
        return printer

    def add(self, name: str, uri: str, *, info: str = "", location: str = "") -> Printer:
        name = validate_name(name)
        uri = validate_uri(uri)
        if self.get(name) is not None:
            raise PrintingError(f"a printer named {name!r} already exists")

        with self._connect() as conn:
            # The first printer becomes the default straight away; otherwise
            # nothing would be preselected when printing.
            first = conn.execute("SELECT COUNT(*) AS total FROM printers").fetchone()["total"] == 0
            conn.execute(
                "INSERT INTO printers (name, uri, info, location, is_default, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (name, uri, info, location, 1 if first else 0, _now()),
            )
        return self.require(name)

    def remove(self, name: str) -> None:
        self.require(name)
        with self._connect() as conn:
            conn.execute("DELETE FROM printers WHERE name = ?", (name,))
            # Without a default printer we pick the next one.
            remaining = conn.execute(
                "SELECT name FROM printers WHERE is_default = 1"
            ).fetchone()
            if remaining is None:
                next_printer = conn.execute(
                    "SELECT name FROM printers ORDER BY name COLLATE NOCASE LIMIT 1"
                ).fetchone()
                if next_printer is not None:
                    conn.execute(
                        "UPDATE printers SET is_default = 1 WHERE name = ?", (next_printer["name"],)
                    )

    def set_default(self, name: str) -> Printer:
        self.require(name)
        with self._connect() as conn:
            conn.execute("UPDATE printers SET is_default = 0")
            conn.execute("UPDATE printers SET is_default = 1 WHERE name = ?", (name,))
        return self.require(name)

    def default(self) -> Printer | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM printers WHERE is_default = 1").fetchone()
        return self._row(row) if row else None
