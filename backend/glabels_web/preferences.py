"""Preferences of this installation.

These settings belong to the server, not to a browser: that way everyone who
opens the application sees the same unit and the same date format, even on a
machine whose language setting is wrong.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

# Units as the file format knows them.
UNITS = ("mm", "cm", "in", "pt", "pc")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS preferences (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class PreferenceError(ValueError):
    """A setting has a value we do not accept."""


@dataclass(frozen=True)
class Preferences:
    # An empty language code means: follow the browser's language setting.
    locale: str = ""
    unit: str = "mm"


class PreferenceStore:
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

    def get(self) -> Preferences:
        with self._connect() as conn:
            rows = {row["key"]: row["value"] for row in conn.execute("SELECT * FROM preferences")}
        return Preferences(
            locale=rows.get("locale", ""),
            unit=rows.get("unit", "mm") if rows.get("unit") in UNITS else "mm",
        )

    def save(self, *, locale: str | None = None, unit: str | None = None) -> Preferences:
        if unit is not None and unit not in UNITS:
            raise PreferenceError(f"unknown unit: {unit!r}")
        if locale is not None and locale and not _is_language_code(locale):
            raise PreferenceError(f"unusable language code: {locale!r}")

        with self._connect() as conn:
            if locale is not None:
                conn.execute(
                    "INSERT OR REPLACE INTO preferences (key, value) VALUES ('locale', ?)",
                    (locale,),
                )
            if unit is not None:
                conn.execute(
                    "INSERT OR REPLACE INTO preferences (key, value) VALUES ('unit', ?)", (unit,)
                )
        return self.get()


def _is_language_code(value: str) -> bool:
    """A simple check for the shape ``nl`` or ``nl-NL``."""
    parts = value.split("-")
    if not 1 <= len(parts) <= 3 or len(value) > 20:
        return False
    return all(part.isalnum() for part in parts) and parts[0].isalpha()
