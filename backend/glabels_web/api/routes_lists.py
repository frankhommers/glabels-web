"""A label's list: rows added from any device, printed when you like.

The list is the label's merge source (see `documents.merge_list`). A label
with fields but no source yet gets one in `merges/` as soon as the first row
is added. Printing only the rows still to print goes through the ordinary
print call with `pending_only`; the rows are marked printed once the printer
reports the job completed.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import threading
from dataclasses import replace
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..documents import Document
from ..documents import merge as merge_backends
from ..documents import merge_list as merge_lists
from ..documents.models import BarcodeObject, ImageObject, TextObject
from ..files import FileAreaError
from ..files.store import safe_name
from .deps import AppState, state
from ..render import RenderError
from ..xml_safe import XmlError
from .routes_documents import PrintSettings, _load, _merge_src, _write_through

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["lists"])

# Rows come in from several devices at once; one change at a time keeps
# them all (the server runs in one process).
_lock = threading.Lock()

LIST_TYPE = "Text/Tab/Line1Keys"
LIST_FOLDER = "merges"


class RowOut(BaseModel):
    id: str
    values: dict[str, str]
    copies: int
    printed: str = ""
    # A job with this row is on its way to the printer.
    printing: bool = False


class ListOut(BaseModel):
    available: bool
    # Why there is no list: "no-fields" (the label has no ${field}) or
    # "needs-field-names" (the source has no field names on line 1).
    reason: str | None = None
    source_path: str | None = None
    # The fields the label uses, in the order they appear on it.
    fields: list[str] = Field(default_factory=list)
    # All columns of the source (the label's fields and any others).
    keys: list[str] = Field(default_factory=list)
    rows: list[RowOut] = Field(default_factory=list)
    pending_rows: int = 0
    pending_labels: int = 0


class RowIn(BaseModel):
    values: dict[str, str] = Field(default_factory=dict)
    copies: int = Field(default=1, ge=1, le=merge_lists.MAX_COPIES)


class RowChange(BaseModel):
    values: dict[str, str] | None = None
    copies: int | None = Field(default=None, ge=1, le=merge_lists.MAX_COPIES)
    printed: bool | None = None


class MarkPrinted(BaseModel):
    printed: bool = True
    # Empty: every row.
    ids: list[str] | None = None


def label_fields(doc: Document) -> list[str]:
    """The ${field}s a label uses, in the order of its objects.

    A ${name} can also be one of the label's variables (a counter, say);
    those fill themselves in and are no field to ask for.
    """
    names: list[str] = []
    variables = {variable.name for variable in doc.variables()}

    def add(found: list[str]) -> None:
        for name in found:
            if name not in names and name not in variables:
                names.append(name)

    for obj in doc.content().objects:
        if isinstance(obj, TextObject):
            add(merge_lists.fields_in_text("\n".join(obj.lines)))
        elif isinstance(obj, BarcodeObject):
            add(merge_lists.fields_in_text(obj.data))
        elif isinstance(obj, ImageObject) and obj.src_field:
            add([obj.src_field])
        for attribute in ("color", "line_color", "fill_color"):
            spec = getattr(obj, attribute, None)
            if spec is not None and spec.field:
                add([spec.field])
    return names


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read(app: AppState, doc_id: str):
    """Document, its fields, and its list (None while it has no source)."""
    info, doc = _load(app, doc_id)
    fields = label_fields(doc)
    spec = doc.merge()
    if spec is None or spec.type == "None" or not info.merge_source_path:
        return info, doc, fields, None, None
    try:
        raw = app.files.read(info.merge_source_path, max_bytes=app.settings.max_upload_bytes)
        return info, doc, fields, merge_lists.parse(raw, spec.type), spec.type
    except FileAreaError as exc:
        raise HTTPException(status_code=422, detail=f"the merge source is not available: {exc}") from exc
    except merge_backends.MergeError as exc:
        raise HTTPException(status_code=409, detail="needs-field-names") from exc


def _out(app: AppState, doc_id: str, info, fields, merge_list) -> ListOut:
    if merge_list is None:
        if not fields:
            return ListOut(available=False, reason="no-fields")
        return ListOut(available=True, fields=fields, keys=list(fields))
    busy = {row for record in app.store.unfinished_list_prints(doc_id) for row in record.list_rows}
    waiting = merge_lists.pending(merge_list, busy)
    return ListOut(
        available=True,
        source_path=info.merge_source_path,
        fields=fields or list(merge_list.keys),
        keys=list(merge_list.keys),
        rows=[
            RowOut(id=row.id, values=row.values, copies=row.copies, printed=row.printed, printing=row.id in busy)
            for row in merge_list.rows
        ],
        pending_rows=len(waiting),
        pending_labels=sum(row.copies for row in waiting),
    )


def _save(app: AppState, info, merge_list, merge_type: str) -> None:
    try:
        app.files.write_file(info.merge_source_path, merge_lists.serialize(merge_list, merge_type))
    except FileAreaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _create_source(app: AppState, doc_id: str, info, doc: Document, fields: list[str]):
    """A new list for a label with fields but no source: merges/<label>.tsv,
    linked to the label as desktop gLabels would link it."""
    try:
        if not app.files.resolve(LIST_FOLDER).is_dir():
            app.files.make_directory("", LIST_FOLDER)
        merge_list = merge_lists.MergeList(keys=list(fields))
        entry = app.files.write(
            LIST_FOLDER,
            f"{safe_name(info.name) or 'list'}.tsv",
            merge_lists.serialize(merge_list, LIST_TYPE),
        )
    except FileAreaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    doc.set_merge(LIST_TYPE, _merge_src(entry.path, info.file_path))
    app.store.save_revision(doc_id, doc.to_bytes(), object_ids=doc.object_ids())
    info = app.store.set_merge_source(doc_id, entry.path)
    _write_through(app, doc_id)
    log.info("list for %s created at %s", info.name, entry.path)
    return info, merge_list, LIST_TYPE


@router.get("/{doc_id}/list", response_model=ListOut)
def get_list(doc_id: str, app: AppState = Depends(state)) -> ListOut:
    try:
        info, _doc, fields, merge_list, _type = _read(app, doc_id)
    except HTTPException as exc:
        if exc.detail == "needs-field-names":
            return ListOut(available=False, reason="needs-field-names")
        raise
    return _out(app, doc_id, info, fields, merge_list)


@router.post("/{doc_id}/list/rows", response_model=ListOut, status_code=201)
def add_row(doc_id: str, request: RowIn, app: AppState = Depends(state)) -> ListOut:
    with _lock:
        info, doc, fields, merge_list, merge_type = _read(app, doc_id)
        if merge_list is None:
            if not fields:
                raise HTTPException(status_code=409, detail="no-fields")
            info, merge_list, merge_type = _create_source(app, doc_id, info, doc, fields)
        merge_list.add_keys(fields)
        merge_list.add_keys(list(request.values))
        merge_list.rows.append(
            merge_lists.Row(id=merge_lists.new_id(), values=dict(request.values), copies=request.copies)
        )
        _save(app, info, merge_list, merge_type)
        return _out(app, doc_id, info, fields, merge_list)


@router.put("/{doc_id}/list/rows/{row_id}", response_model=ListOut)
def change_row(doc_id: str, row_id: str, request: RowChange, app: AppState = Depends(state)) -> ListOut:
    with _lock:
        info, _doc, fields, merge_list, merge_type = _read(app, doc_id)
        row = merge_list.row(row_id) if merge_list else None
        if row is None:
            raise HTTPException(status_code=404, detail="unknown row")
        if request.values is not None:
            merge_list.add_keys(list(request.values))
            row.values.update(request.values)
        if request.copies is not None:
            row.copies = request.copies
        if request.printed is not None:
            row.printed = _now() if request.printed else ""
        _save(app, info, merge_list, merge_type)
        return _out(app, doc_id, info, fields, merge_list)


@router.delete("/{doc_id}/list/rows/{row_id}", response_model=ListOut)
def delete_row(doc_id: str, row_id: str, app: AppState = Depends(state)) -> ListOut:
    with _lock:
        info, _doc, fields, merge_list, merge_type = _read(app, doc_id)
        row = merge_list.row(row_id) if merge_list else None
        if row is None:
            raise HTTPException(status_code=404, detail="unknown row")
        merge_list.rows.remove(row)
        _save(app, info, merge_list, merge_type)
        return _out(app, doc_id, info, fields, merge_list)


@router.post("/{doc_id}/list/printed", response_model=ListOut)
def mark_printed(doc_id: str, request: MarkPrinted, app: AppState = Depends(state)) -> ListOut:
    """Mark rows printed (or to print again); without ids, all of them."""
    with _lock:
        info, _doc, fields, merge_list, merge_type = _read(app, doc_id)
        if merge_list is None:
            return _out(app, doc_id, info, fields, merge_list)
        stamp = _now() if request.printed else ""
        for row in merge_list.rows:
            if request.ids is None or row.id in request.ids:
                if request.printed and row.printed:
                    continue
                row.printed = stamp
        _save(app, info, merge_list, merge_type)
        return _out(app, doc_id, info, fields, merge_list)


@router.post("/{doc_id}/list/clear-printed", response_model=ListOut)
def clear_printed(doc_id: str, app: AppState = Depends(state)) -> ListOut:
    """Remove the rows that have been printed."""
    with _lock:
        info, _doc, fields, merge_list, merge_type = _read(app, doc_id)
        if merge_list is None:
            return _out(app, doc_id, info, fields, merge_list)
        merge_list.rows = [row for row in merge_list.rows if not row.printed]
        _save(app, info, merge_list, merge_type)
        return _out(app, doc_id, info, fields, merge_list)


def rows_printed(app: AppState, doc_id: str, ids: tuple[str, ...]) -> None:
    """A list job completed: mark its rows. Called when its final state comes in."""
    with _lock:
        try:
            info, _doc, _fields, merge_list, merge_type = _read(app, doc_id)
        except HTTPException as exc:
            log.warning("list rows of %s could not be marked printed: %s", doc_id, exc.detail)
            return
        if merge_list is None:
            return
        stamp = _now()
        for row in merge_list.rows:
            if row.id in ids and not row.printed:
                row.printed = stamp
        _save(app, info, merge_list, merge_type)
        log.info("%d list rows of %s marked printed", len(ids), info.name)


def _one_row(values: str | None, row_id: str | None, merge_list) -> dict[str, str] | None:
    """The record to show: typed values, a row of the list, or none."""
    if values is not None:
        try:
            record = json.loads(values)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="values must be a JSON object") from exc
        if not isinstance(record, dict) or not all(isinstance(v, str) for v in record.values()):
            raise HTTPException(status_code=422, detail="values must map field names to text")
        return {str(k): v for k, v in record.items()}
    if row_id is not None:
        row = merge_list.row(row_id) if merge_list else None
        if row is None:
            raise HTTPException(status_code=404, detail="unknown row")
        return row.values
    return None


@router.get("/{doc_id}/label.png")
async def label_preview(
    doc_id: str,
    row: str | None = Query(None, max_length=64),
    values: str | None = Query(None, max_length=20000),
    dpi: int = Query(150, ge=24, le=600),
    app: AppState = Depends(state),
) -> FileResponse:
    """One label, cut out of the page: for one row of the list, for values
    still being typed, or (without either) as the label stands.

    Rendered by the renderer like any print, so it shows what will come out;
    only the single label is kept, not the sheet around it.
    """
    try:
        info, doc, fields, merge_list, merge_type = _read(app, doc_id)
    except HTTPException as exc:
        if exc.detail != "needs-field-names":
            raise
        # A source without field names: no list, but the label still shows.
        info, doc = _load(app, doc_id)
        fields, merge_list = label_fields(doc), None
        merge_type = doc.merge().type if doc.merge() else None
    try:
        doc.validate_for_render()
    except XmlError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not app.renderer.available():
        raise HTTPException(status_code=503, detail="the renderer is not available")

    record = _one_row(values, row, merge_list)
    app.fonts.refresh_if_changed()
    folder = app.store.render_path(doc_id, info.revision, "label").parent / "labels"
    folder.mkdir(parents=True, exist_ok=True)

    source = app.store.revision_path(doc_id, info.revision)
    merge_source = None
    key = [str(info.revision), app.fonts.stamp, str(dpi)]
    if record is not None:
        # A source with just this record. A label without a list yet gets a
        # copy linked to it, so the renderer fills in the fields.
        keys = list(dict.fromkeys([*fields, *record]))
        one = merge_lists.MergeList(keys=keys, rows=[merge_lists.Row(id="preview", values=record)])
        data = merge_lists.serialize(one, LIST_TYPE)
        if merge_type != LIST_TYPE or merge_list is None:
            doc.set_merge(LIST_TYPE, "preview.tsv")
            linked = doc.to_bytes()
            key.append(hashlib.sha256(linked).hexdigest()[:16])
            source = folder / f"doc-{hashlib.sha256(linked).hexdigest()[:16]}.glabels"
            if not source.exists():
                source.write_bytes(linked)
        digest = hashlib.sha256(data).hexdigest()[:16]
        merge_source = folder / f"row-{digest}" / "preview.tsv"
        merge_source.parent.mkdir(exist_ok=True)
        if not merge_source.exists():
            merge_source.write_bytes(data)
        key.append(digest)
    elif merge_type not in (None, "None") and info.merge_source_path:
        # As the label stands: with its source, so the first record shows.
        try:
            entry = app.files.entry(info.merge_source_path)
            merge_source = app.files.resolve(info.merge_source_path)
            key += [entry.modified_at, str(entry.size_bytes)]
        except FileAreaError:
            merge_source = None

    name = hashlib.sha256("|".join(key).encode()).hexdigest()[:24]
    image = folder / f"{name}.png"
    if not image.exists():
        pdf = folder / f"{name}.pdf"
        request = PrintSettings(copies=1).to_request()
        if merge_source is not None:
            request = replace(request, merge_source=merge_source)
        template = app.templates.parse_template_element(doc.template_element)
        if template is None:
            raise HTTPException(status_code=422, detail="the document contains no usable product definition")
        frame = template.frame
        width, height = frame.bounding_size_pt
        x0 = frame.layouts[0].x0_pt if frame.layouts else 0.0
        y0 = frame.layouts[0].y0_pt if frame.layouts else 0.0
        scale = dpi / 72
        crop = (
            math.floor(x0 * scale),
            math.floor(y0 * scale),
            max(1, math.ceil(width * scale)),
            max(1, math.ceil(height * scale)),
        )
        try:
            await app.renderer.render_pdf(source, pdf, request)
            await app.renderer.rasterize(pdf, image, page=1, dpi=dpi, crop=crop)
        except RenderError as exc:
            log.warning("label preview failed for %s: %s", doc_id, exc)
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return FileResponse(image, media_type="image/png", headers={"Cache-Control": "no-cache"})
