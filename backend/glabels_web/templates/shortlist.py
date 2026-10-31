"""Products this installation uses: favourites and the ones chosen lately.

Kept on the server, like the preferences, so the phone and the desktop show
the same short list.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS template_marks (
    brand     TEXT NOT NULL,
    part      TEXT NOT NULL,
    favorite  INTEGER NOT NULL DEFAULT 0,
    last_used TEXT,
    PRIMARY KEY (brand, part)
);
"""


class ShortlistStore:
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

    def favorites(self) -> list[tuple[str, str]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT brand, part FROM template_marks WHERE favorite = 1"
                " ORDER BY brand COLLATE NOCASE, part COLLATE NOCASE"
            )
            return [(row["brand"], row["part"]) for row in rows]

    def recent(self, limit: int) -> list[tuple[str, str]]:
        """Most recently chosen first."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT brand, part FROM template_marks WHERE last_used IS NOT NULL"
                " ORDER BY last_used DESC LIMIT ?",
                (limit,),
            )
            return [(row["brand"], row["part"]) for row in rows]

    def set_favorite(self, brand: str, part: str, favorite: bool) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO template_marks (brand, part, favorite) VALUES (?, ?, ?)"
                " ON CONFLICT (brand, part) DO UPDATE SET favorite = excluded.favorite",
                (brand, part, int(favorite)),
            )

    def mark_used(self, brand: str, part: str) -> None:
        now = datetime.now(UTC).isoformat(timespec="microseconds")
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO template_marks (brand, part, last_used) VALUES (?, ?, ?)"
                " ON CONFLICT (brand, part) DO UPDATE SET last_used = excluded.last_used",
                (brand, part, now),
            )
