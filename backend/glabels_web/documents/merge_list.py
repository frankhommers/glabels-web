"""A label's merge source as a list you build up and print from.

Every row is one label (or several: its copies). Rows can be added at any
moment, from any device, and printed later; a printed row is marked, not
removed, so it can be printed again.

The list is the merge source itself, in its own format, so the desktop app
can still open and print it. Three columns of our own are added at the end;
a label does not use them, so gLabels ignores them:

    _id       a key per row that stays the same while other rows come and go
    _copies   how many labels this row gives (1 when empty)
    _printed  when the row was printed (empty: still to print)

Only sources with field names on line 1 can be a list: a row is filled in by
field name.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass, field

from .merge import MERGE_TYPES, MergeError, escape_value, parse_text

ID, COPIES, PRINTED = "_id", "_copies", "_printed"
META = (ID, COPIES, PRINTED)
MAX_COPIES = 999

# ${field}, ${field:format} and ${field:=default}: the name ends at ':' or '}'.
_FIELD = re.compile(r"\$\{([^}:]+)")


def fields_in_text(text: str) -> list[str]:
    return [name.strip() for name in _FIELD.findall(text) if name.strip()]


@dataclass
class Row:
    id: str
    values: dict[str, str]
    copies: int = 1
    printed: str = ""  # ISO time, empty while still to print


@dataclass
class MergeList:
    keys: list[str]  # the fields, in file order, without our own columns
    rows: list[Row] = field(default_factory=list)

    def row(self, row_id: str) -> Row | None:
        return next((row for row in self.rows if row.id == row_id), None)

    def add_keys(self, names: list[str]) -> None:
        for name in names:
            if name and name not in self.keys and name not in META:
                self.keys.append(name)


def _delimiter(merge_type: str) -> str:
    entry = MERGE_TYPES.get(merge_type)
    if entry is None:
        raise MergeError(f"unknown merge type: {merge_type!r}")
    _label, delimiter, line1_keys = entry
    if not delimiter or not line1_keys:
        raise MergeError("a list needs a text source with the field names on line 1")
    return delimiter


def new_id() -> str:
    return secrets.token_hex(4)


def _copies(value: str) -> int:
    try:
        return max(1, min(MAX_COPIES, int(value)))
    except ValueError:
        return 1


class ListShapeError(MergeError):
    """The file has data a list would drop when it saves: a column without a
    name, two columns with the same name, or values past the last name."""


def _check_shape(header: list[str], rows: list[list[str]]) -> None:
    named = [name for name in header if name]
    if len(set(named)) != len(named):
        raise ListShapeError("two columns have the same name")
    for values in rows:
        for index, value in enumerate(values):
            if value and (index >= len(header) or not header[index]):
                raise ListShapeError("a column with values has no name")


def line_id(index: int, values: list[str]) -> str:
    """The id of a row that has none in the file yet.

    The same every time the file is read, so a change made on one screen
    finds the row again; built from the row's place and its content, so a
    row that moved or changed in the meantime is not found rather than
    another row changed. The id is written to the file at the next save.
    """
    digest = hashlib.sha1("\x1f".join(values).encode("utf-8")).hexdigest()[:6]
    return f"n{index}{digest}"


def parse(data: bytes, merge_type: str) -> MergeList:
    """Read a source as a list; rows without an id get a stable one."""
    delimiter = _delimiter(merge_type)
    lines = parse_text(data.decode("utf-8-sig", errors="replace"), delimiter)
    if not lines:
        return MergeList(keys=[])
    header = [name.strip() for name in lines[0]]
    _check_shape(header, lines[1:])
    keys = [name for name in header if name and name not in META]
    rows = []
    for index, values in enumerate(lines[1:], start=1):
        record = {header[i]: value for i, value in enumerate(values) if i < len(header) and header[i]}
        rows.append(
            Row(
                id=record.get(ID) or line_id(index, values),
                values={key: record.get(key, "") for key in keys},
                copies=_copies(record.get(COPIES, "1")),
                printed=record.get(PRINTED, ""),
            )
        )
    return MergeList(keys=keys, rows=rows)


def serialize(merge_list: MergeList, merge_type: str, *, rows: list[Row] | None = None) -> bytes:
    """One record per line. A line break in a value is written as \\n, which
    gLabels turns back into a line break when it prints."""
    delimiter = _delimiter(merge_type)

    def line(values: list[str]) -> str:
        return delimiter.join(escape_value(value, delimiter) for value in values)

    lines = [line([*merge_list.keys, *META])]
    for row in merge_list.rows if rows is None else rows:
        lines.append(
            line([*(row.values.get(key, "") for key in merge_list.keys), row.id, str(row.copies), row.printed])
        )
    return ("\n".join(lines) + "\n").encode("utf-8")


def pending(merge_list: MergeList, busy: set[str]) -> list[Row]:
    """Rows still to print, apart from those a running job is printing."""
    return [row for row in merge_list.rows if not row.printed and row.id not in busy]


def printable(merge_list: MergeList, rows: list[Row], merge_type: str) -> bytes:
    """A source for the renderer with these rows, each as often as its copies."""
    repeated = [row for row in rows for _ in range(row.copies)]
    return serialize(merge_list, merge_type, rows=repeated)
