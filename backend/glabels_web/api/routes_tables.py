"""A text merge source (.csv, .tsv, .txt) as a table you can edit.

Read and written with the same rules gLabels uses (`documents.merge`), so
what the editor shows is what a label gets, and the file stays readable for
gLabels on the desktop.

Saving names the version it started from (`sha256`): when the file changed
in the meantime, for example because a phone added a row to the list, the
save is refused with 409 rather than silently undoing that change.
"""

from __future__ import annotations

import hashlib
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..documents import merge_list as merge_lists
from ..documents.merge import escape_value, parse_text
from ..files import FileAreaError
from ..files.store import DATA_SUFFIXES
from .deps import AppState, state

# The list's rows change under the same lock, so a save never lands halfway
# through a row added from a phone.
from .routes_lists import _lock

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/files", tags=["files"])

DELIMITERS = (",", "\t", ";", ":")
BOM = b"\xef\xbb\xbf"


class Table(BaseModel):
    path: str
    delimiter: str
    # Every line of the file, line 1 included; rows can differ in length.
    rows: list[list[str]]
    sha256: str


class TableIn(BaseModel):
    path: str = Field(min_length=1, max_length=1024)
    delimiter: str = Field(pattern="^(,|\t|;|:)$")
    rows: list[list[str]]
    # The version the editor started from; empty overwrites whatever is there.
    sha256: str | None = None


def guess_delimiter(name: str, text: str) -> str:
    """The delimiter of a file: .tsv is tabs, otherwise whatever line 1 has most of."""
    if name.casefold().endswith(".tsv"):
        return "\t"
    first = next((line for line in text.splitlines() if line.strip()), "")
    counts = {delimiter: first.count(delimiter) for delimiter in DELIMITERS}
    best = max(DELIMITERS, key=lambda delimiter: counts[delimiter])
    if counts[best] > 0:
        return best
    return "\t" if name.casefold().endswith(".txt") else ","


def serialize(rows: list[list[str]], delimiter: str) -> str:
    lines = [delimiter.join(escape_value(value, delimiter) for value in row) for row in rows]
    return "".join(line + "\n" for line in lines)


def _fill_ids(rows: list[list[str]]) -> list[list[str]]:
    """Rows added to a list here get their `_id` now, so the phone and the
    desktop keep pointing at the same row."""
    if not rows or merge_lists.ID not in rows[0]:
        return rows
    column = rows[0].index(merge_lists.ID)
    filled = [rows[0]]
    for row in rows[1:]:
        if len(row) <= column:
            row = [*row, *[""] * (column + 1 - len(row))]
        if not row[column].strip():
            row = [*row[:column], merge_lists.new_id(), *row[column + 1 :]]
        filled.append(row)
    return filled


def _check_kind(path: str) -> None:
    """Only merge sources: a project or a font is not a table."""
    if not any(path.casefold().endswith(suffix) for suffix in DATA_SUFFIXES):
        raise HTTPException(status_code=400, detail="only .csv, .tsv and .txt files can be edited as a table")


def _read(app: AppState, path: str, delimiter: str | None) -> Table:
    _check_kind(path)
    try:
        raw = app.files.read(path, max_bytes=app.settings.max_upload_bytes)
    except FileAreaError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    text = raw.decode("utf-8-sig", errors="replace")
    used = delimiter or guess_delimiter(path, text)
    return Table(
        path=path.strip("/"),
        delimiter=used,
        rows=parse_text(text, used),
        sha256=hashlib.sha256(raw).hexdigest(),
    )


@router.get("/table", response_model=Table)
def read_table(
    path: str = Query(..., max_length=1024),
    delimiter: str | None = Query(None, pattern="^(,|\t|;|:)$"),
    app: AppState = Depends(state),
) -> Table:
    return _read(app, path, delimiter)


@router.put("/table", response_model=Table)
def write_table(request: TableIn, app: AppState = Depends(state)) -> Table:
    # A line without anything in it is skipped by gLabels; leave it out.
    _check_kind(request.path)
    rows = [row for row in request.rows if any(value != "" for value in row)]
    rows = _fill_ids(rows)
    with _lock:
        try:
            raw = app.files.read(request.path, max_bytes=app.settings.max_upload_bytes)
        except FileAreaError:
            raw = None  # a new file
        if request.sha256 and (raw is None or hashlib.sha256(raw).hexdigest() != request.sha256):
            raise HTTPException(status_code=409, detail="changed-elsewhere")
        data = serialize(rows, request.delimiter).encode("utf-8")
        if raw is not None and raw.startswith(BOM):
            data = BOM + data
        if len(data) > app.settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail="the file is larger than allowed")
        try:
            app.files.write_file(request.path, data)
        except FileAreaError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    log.info("table %s saved: %d lines", request.path, len(rows))
    return _read(app, request.path, request.delimiter)
