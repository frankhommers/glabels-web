"""Merge sources: the text formats gLabels knows.

The renderer reads the source itself; this module exists to show in the
interface which fields there are and what the first rows look like. When in
doubt, the renderer's output is authoritative.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass

# Ids from backends/merge/*.cpp; these strings are what the file contains.
MERGE_TYPES: dict[str, tuple[str, str, bool]] = {
    # id: (display name, delimiter, first line holds field names)
    "None": ("None", "", False),
    "Text/Comma": ("Text, comma separated", ",", False),
    "Text/Comma/Line1Keys": ("Text, comma separated (field names on line 1)", ",", True),
    "Text/Tab": ("Text, tab separated", "\t", False),
    "Text/Tab/Line1Keys": ("Text, tab separated (field names on line 1)", "\t", True),
    "Text/Colon": ("Text, colon separated", ":", False),
    "Text/Colon/Line1Keys": ("Text, colon separated (field names on line 1)", ":", True),
    "Text/Semicolon": ("Text, semicolon separated", ";", False),
    "Text/Semicolon/Keys": ("Text, semicolon separated (field names on line 1)", ";", True),
}


class MergeError(ValueError):
    """The source cannot be read with the chosen type."""


@dataclass(frozen=True)
class MergePreview:
    keys: list[str]
    records: list[dict[str, str]]
    record_count: int
    truncated: bool


def is_known_type(merge_type: str) -> bool:
    return merge_type in MERGE_TYPES


def label_for(merge_type: str) -> str:
    entry = MERGE_TYPES.get(merge_type)
    return entry[0] if entry else merge_type


def preview(data: bytes, merge_type: str, *, limit: int = 25) -> MergePreview:
    """Read the fields and the first rows from a merge source."""
    entry = MERGE_TYPES.get(merge_type)
    if entry is None:
        raise MergeError(f"unknown merge type: {merge_type!r}")
    _label, delimiter, line1_keys = entry
    if not delimiter:
        return MergePreview(keys=[], records=[], record_count=0, truncated=False)

    text = data.decode("utf-8", errors="replace")
    rows = [row for row in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter) if row]
    if not rows:
        return MergePreview(keys=[], records=[], record_count=0, truncated=False)

    if line1_keys:
        keys = [value.strip() for value in rows[0]]
        data_rows = rows[1:]
    else:
        # Without field names gLabels uses the column numbers: "1", "2", ...
        keys = [str(index + 1) for index in range(max(len(row) for row in rows))]
        data_rows = rows

    records = []
    for row in data_rows[:limit]:
        record = {}
        for index, value in enumerate(row):
            key = keys[index] if index < len(keys) else str(index + 1)
            record[key] = value
        records.append(record)

    return MergePreview(
        keys=keys,
        records=records,
        record_count=len(data_rows),
        truncated=len(data_rows) > limit,
    )
