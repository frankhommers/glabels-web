"""Merge sources: the text formats gLabels knows.

The renderer reads the source itself; this module exists to show in the
interface which fields there are and what the first rows look like. When in
doubt, the renderer's output is authoritative.
"""

from __future__ import annotations

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


def parse_text(text: str, delimiter: str) -> list[list[str]]:
    """Split a text source into records the way gLabels does.

    A copy of upstream's merge::Text::parseLine: RFC 4180 with additions.
    A backslash takes the next character literally, except that \\n is a new
    line and \\t a tab; a quoted field may hold the delimiter, quotes ("")
    and line breaks; text after a closing quote is added to the field.
    """
    records: list[list[str]] = []
    fields: list[str] = []
    field: list[str] = []
    state = "delim"
    for c in text:
        if state == "delim":
            if c == "\n":
                fields.append("")
                records.append(fields)
                fields = []
            elif c == "\r":
                pass
            elif c == '"':
                state = "quoted"
            elif c == "\\":
                state = "simple_escaped"
            elif c == delimiter:
                fields.append("")
            else:
                field.append(c)
                state = "simple"
        elif state == "quoted":
            if c == '"':
                state = "quoted_quote1"
            elif c == "\\":
                state = "quoted_escaped"
            else:
                field.append(c)
        elif state == "quoted_quote1":
            if c == "\n":
                fields.append("".join(field))
                field = []
                records.append(fields)
                fields = []
                state = "delim"
            elif c == '"':
                field.append(c)
                state = "quoted"
            elif c == "\r":
                state = "simple"
            elif c == delimiter:
                fields.append("".join(field))
                field = []
                state = "delim"
            else:
                field.append(c)
                state = "simple"
        elif state in ("quoted_escaped", "simple_escaped"):
            field.append("\n" if c == "n" else "\t" if c == "t" else c)
            state = "quoted" if state == "quoted_escaped" else "simple"
        elif state == "simple":
            if c == "\n":
                fields.append("".join(field))
                field = []
                records.append(fields)
                fields = []
                state = "delim"
            elif c == "\r":
                pass
            elif c == "\\":
                state = "simple_escaped"
            elif c == delimiter:
                fields.append("".join(field))
                field = []
                state = "delim"
            else:
                field.append(c)
    if state != "delim":
        fields.append("".join(field))
    if fields:
        records.append(fields)
    # A blank line is one empty field; it holds no record.
    return [record for record in records if record != [""]]


def escape_value(value: str, delimiter: str) -> str:
    """Write a value so parse_text (and gLabels) reads it back unchanged."""
    out = []
    for index, c in enumerate(value):
        if c == "\\":
            out.append("\\\\")
        elif c == "\n":
            out.append("\\n")
        elif c == "\t":
            out.append("\\t")
        elif c == "\r":
            continue
        elif c == delimiter or (c == '"' and index == 0):
            out.append("\\" + c)
        else:
            out.append(c)
    return "".join(out)


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

    text = data.decode("utf-8-sig", errors="replace")
    rows = parse_text(text, delimiter)
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
