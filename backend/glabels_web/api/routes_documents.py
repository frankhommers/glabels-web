"""Documents: creating, importing, editing, exporting and print preview."""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import replace

from anyio import to_thread
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..documents import Document
from ..documents import merge as merge_backends
from ..documents.models import (
    DocumentContent,
    DocumentDetail,
    DocumentInfo,
    DocumentListItem,
    Limitation,
)
from ..documents.store import DocumentNotFound
from ..files import FileAreaError
from ..files.store import safe_name
from ..printing import PrintingError, PrintingUnavailable
from ..render import RenderError, RenderRequest
from ..xml_safe import XmlError
from .deps import AppState, state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])

_SAFE_NAME = re.compile(r"[^\w .()\-]+", re.UNICODE)


class NewDocumentRequest(BaseModel):
    name: str = Field(default="Untitled", max_length=200)
    brand: str
    part: str
    rotate: bool = False


class SaveDocumentRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    content: DocumentContent


def _merge_spec(app: AppState, info: DocumentInfo, doc: Document, limitations: list[Limitation]):
    """Complete the merge data with what we know about the source in the folder."""
    spec = doc.merge()
    if spec is None:
        return None

    spec.source_path = info.merge_source_path
    if info.merge_source_path:
        try:
            app.files.entry(info.merge_source_path)
            spec.available = True
        except FileAreaError:
            limitations.append(
                Limitation(
                    code="merge-source-missing",
                    message=(
                        f"The merge source {info.merge_source_path!r} is no longer in the shared "
                        "folder. Choose a new source or restore the file."
                    ),
                    params={"path": info.merge_source_path},
                )
            )
    elif spec.src:
        limitations.append(
            Limitation(
                code="merge-source-unlinked",
                message=(
                    f"This document refers to the merge source {spec.src!r}, but no file is "
                    "linked to it here. The reference is kept; choose a source in the shared "
                    "folder to be able to print."
                ),
                params={"src": spec.src or ""},
            )
        )
    return spec


def _detail(app: AppState, info: DocumentInfo, doc: Document) -> DocumentDetail:
    content = doc.content()
    limitations_extra: list[Limitation] = []
    merge = _merge_spec(app, info, doc, limitations_extra)
    template = app.templates.parse_template_element(doc.template_element)
    limitations: list[Limitation] = list(doc.limitations()) + limitations_extra

    if template is None:
        raise HTTPException(status_code=422, detail="the document contains no usable product definition")

    frame = template.frame
    width, height = frame.bounding_size_pt

    return DocumentDetail(
        **info.model_dump(),
        file_state=_file_state(app, info.id),
        label_width_pt=width,
        label_height_pt=height,
        label_shape=frame.shape,
        label_round_pt=frame.round_pt or 0.0,
        label_radius_pt=frame.radius_pt,
        label_hole_pt=frame.hole_pt,
        markups=[m.model_dump() for m in frame.markups],
        content=content,
        merge=merge,
        variables=doc.variables(),
        embedded_files=doc.embedded_files(),
        limitations=limitations,
    )


# ----------------------------------------------------------- file in the folder
#
# Once it has a name, a project lives in a .glabels file in the shared folder.
# Every save updates that file. The revisions in the database remain the
# history and the source for preview and printing.


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_state(app: AppState, doc_id: str) -> str:
    path, known = app.store.file_link(doc_id)
    if not path:
        return "none"
    try:
        current = app.files.sha256(path)
    except FileAreaError:
        return "missing"
    if current is None:
        return "missing"
    return "linked" if current == known else "conflict"


def _write_through(app: AppState, doc_id: str, *, force: bool = False) -> None:
    """Write the current revision to the linked file.

    If the file was changed outside the app, we leave it alone: the user
    chooses which version stays (see `resolve_file_conflict`).
    """
    path, _ = app.store.file_link(doc_id)
    if not path:
        return
    if not force and _file_state(app, doc_id) == "conflict":
        log.warning("file %s was changed outside the app; not overwritten", path)
        return
    raw = app.store.read_revision(doc_id)
    try:
        app.files.write_file(path, raw)
    except (FileAreaError, OSError) as exc:
        # The revision is saved; only the file lags behind.
        log.warning("file %s could not be updated: %s", path, exc)
        return
    app.store.set_file_link(doc_id, path, _sha(raw))


def _document_filename(name: str) -> str:
    filename = safe_name(name.strip())
    if not filename.lower().endswith(".glabels"):
        filename += ".glabels"
    return filename


def _stem(filename: str) -> str:
    for suffix in (".glabels", ".glabels.gz", ".gz"):
        if filename.lower().endswith(suffix):
            return filename[: -len(suffix)]
    return filename


def _load(app: AppState, doc_id: str) -> tuple[DocumentInfo, Document]:
    try:
        info = app.store.info(doc_id)
        raw = app.store.read_revision(doc_id)
    except (DocumentNotFound, ValueError) as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc
    try:
        doc = Document.from_bytes(
            raw,
            max_uncompressed_bytes=app.settings.max_upload_bytes,
            object_ids=app.store.object_ids(doc_id),
        )
    except XmlError as exc:
        raise HTTPException(status_code=422, detail=f"the stored document is unusable: {exc}") from exc
    return info, doc


@router.get("", response_model=list[DocumentListItem])
def list_documents(app: AppState = Depends(state)) -> list[DocumentListItem]:
    # With the state of each file, so the list can show which ones are gone
    # or were changed outside the app.
    return [
        DocumentListItem(**info.model_dump(), file_state=_file_state(app, info.id))
        for info in app.store.list()
    ]


@router.post("", response_model=DocumentDetail, status_code=201)
def create_document(request: NewDocumentRequest, app: AppState = Depends(state)) -> DocumentDetail:
    try:
        element = app.templates.document_template_element(request.brand, request.part)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    template = app.templates.get(request.brand, request.part)
    doc = Document.new_from_template(element, rotate=request.rotate)
    info = app.store.create(
        name=request.name.strip() or "Untitled",
        xml_bytes=doc.to_bytes(),
        template_brand=request.brand,
        template_part=request.part,
        template_description=template.description if template else "",
    )
    app.store.set_object_ids(info.id, doc.object_ids())
    return _detail(app, info, doc)


@router.post("/import", response_model=DocumentDetail, status_code=201)
async def import_document(
    file: UploadFile = File(...), app: AppState = Depends(state)
) -> DocumentDetail:
    raw = await file.read(app.settings.max_upload_bytes + 1)
    if len(raw) > app.settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="the file is larger than allowed")

    try:
        doc = Document.from_bytes(raw, max_uncompressed_bytes=app.settings.max_upload_bytes)
        template_node = doc.template_element
    except XmlError as exc:
        raise HTTPException(status_code=422, detail=f"unusable file: {exc}") from exc

    name = (file.filename or "Imported").rsplit("/", 1)[-1]
    for suffix in (".glabels", ".glabels.gz", ".gz"):
        if name.lower().endswith(suffix):
            name = name[: -len(suffix)]
            break

    info = app.store.create(
        name=name or "Imported",
        # Keep the original XML unchanged; we only rewrite the file on the
        # first edit.
        xml_bytes=raw if raw[:2] != b"\x1f\x8b" else doc.to_bytes(),
        template_brand=template_node.get("brand") or "",
        template_part=template_node.get("part") or "",
        template_description=template_node.get("description") or "",
    )
    app.store.set_object_ids(info.id, doc.object_ids())
    return _detail(app, info, doc)


@router.get("/{doc_id}", response_model=DocumentDetail)
def get_document(doc_id: str, app: AppState = Depends(state)) -> DocumentDetail:
    info, doc = _load(app, doc_id)
    return _detail(app, info, doc)


@router.put("/{doc_id}", response_model=DocumentDetail)
def save_document(
    doc_id: str, request: SaveDocumentRequest, app: AppState = Depends(state)
) -> DocumentDetail:
    info, doc = _load(app, doc_id)

    doc.content()  # fills in the limitations list
    blocking = [limit for limit in doc.limitations() if limit.blocks_editing]
    if any(limit.code == "document-version" for limit in blocking):
        raise HTTPException(
            status_code=409,
            detail="this document has an unsupported version and cannot be saved",
        )

    try:
        doc.apply_content(request.content)
    except XmlError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    info = app.store.save_revision(
        doc_id, doc.to_bytes(), name=request.name, object_ids=doc.object_ids()
    )
    _write_through(app, doc_id)
    return _detail(app, info, doc)


class RenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


@router.put("/{doc_id}/name", response_model=DocumentInfo)
def rename_document(
    doc_id: str, request: RenameRequest, app: AppState = Depends(state)
) -> DocumentInfo:
    """Give a project a name of its own; the content stays unchanged."""
    name = " ".join(request.name.split())
    if not name:
        raise HTTPException(status_code=422, detail="a name must not be empty")
    try:
        path, known = app.store.file_link(doc_id)
    except (DocumentNotFound, ValueError) as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc

    # If the project lives in a file, the file is renamed along with it.
    if path:
        filename = _document_filename(name)
        folder = path.rsplit("/", 1)[0] if "/" in path else ""
        new_path = f"{folder}/{filename}" if folder else filename
        if new_path != path:
            try:
                if app.files.sha256(path) is not None:
                    app.files.rename(path, filename)
                elif app.files.sha256(new_path) is not None:
                    raise FileAreaError("a file with that name already exists")
            except FileAreaError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            app.store.set_file_link(doc_id, new_path, known)
    return app.store.rename(doc_id, name)


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str, app: AppState = Depends(state)) -> Response:
    try:
        app.store.delete(doc_id)
    except (DocumentNotFound, ValueError) as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc
    return Response(status_code=204)


@router.get("/{doc_id}/file")
def download_document(doc_id: str, app: AppState = Depends(state)) -> Response:
    info, _ = _load(app, doc_id)
    raw = app.store.read_revision(doc_id)
    filename = (_SAFE_NAME.sub("_", info.name) or "document") + ".glabels"
    return Response(
        content=raw,
        media_type="application/x-glabels",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


class PrintSettings(BaseModel):
    """Print settings; preview and printing use exactly the same values."""

    sheets: int | None = Field(default=None, ge=1, le=1000)
    copies: int | None = Field(default=None, ge=1, le=10000)
    first: int = Field(default=1, ge=1)
    outlines: bool = False
    crop_marks: bool = False
    reverse: bool = False
    collate: bool = False
    group_per_page: bool = False

    def key(self) -> str:
        return "|".join(
            str(value)
            for value in (
                self.sheets,
                self.copies,
                self.first,
                self.outlines,
                self.crop_marks,
                self.reverse,
                self.collate,
                self.group_per_page,
            )
        )

    def to_request(self) -> RenderRequest:
        return RenderRequest(
            sheets=self.sheets,
            copies=self.copies,
            first=self.first,
            outlines=self.outlines,
            crop_marks=self.crop_marks,
            reverse=self.reverse,
            collate=self.collate,
            group_per_page=self.group_per_page,
        )


class PreviewInfo(BaseModel):
    revision: int
    pages: int
    page_width_pt: float
    page_height_pt: float


_PDF_COUNT = re.compile(rb"/Count\s+(\d+)")
_PDF_MEDIABOX = re.compile(rb"/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)")


def _pdf_pages(path: Path) -> int:
    raw = path.read_bytes()
    counts = [int(match) for match in _PDF_COUNT.findall(raw)]
    return max(counts) if counts else 1


def _pdf_page_size(path: Path) -> tuple[float, float]:
    match = _PDF_MEDIABOX.search(path.read_bytes())
    if not match:
        return (0.0, 0.0)
    x0, y0, x1, y1 = (float(value) for value in match.groups())
    return (abs(x1 - x0), abs(y1 - y0))


async def _ensure_pdf(app: AppState, doc_id: str, settings: PrintSettings) -> tuple[DocumentInfo, Path]:
    info, doc = _load(app, doc_id)
    try:
        doc.validate_for_render()
    except XmlError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not app.renderer.available():
        raise HTTPException(status_code=503, detail="the renderer is not available")

    # Send the merge source from the shared folder along. Its modification
    # time is part of the cache key, so an updated CSV gives a new preview.
    merge_source = None
    cache_key = settings.key()
    spec = doc.merge()
    if spec is not None and spec.type != "None" and info.merge_source_path:
        try:
            entry = app.files.entry(info.merge_source_path)
            merge_source = app.files.resolve(info.merge_source_path)
            cache_key = f"{cache_key}|{info.merge_source_path}|{entry.modified_at}|{entry.size_bytes}"
        except FileAreaError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"the merge source is not available: {exc}",
            ) from exc

    output = app.store.render_path(doc_id, info.revision, cache_key)
    if not output.exists():
        source = app.store.revision_path(doc_id, info.revision)
        request = settings.to_request()
        if merge_source is not None:
            request = replace(request, merge_source=merge_source)
        try:
            await app.renderer.render_pdf(source, output, request)
        except RenderError as exc:
            log.warning("rendering failed for %s: %s (%s)", doc_id, exc, exc.stderr.strip()[-500:])
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return info, output


def _settings_from_query(
    sheets: int | None,
    copies: int | None,
    first: int,
    outlines: bool,
    crop_marks: bool,
    reverse: bool,
    collate: bool = False,
    group_per_page: bool = False,
) -> PrintSettings:
    return PrintSettings(
        sheets=sheets,
        copies=copies,
        first=first,
        outlines=outlines,
        crop_marks=crop_marks,
        reverse=reverse,
        collate=collate,
        group_per_page=group_per_page,
    )


@router.get("/{doc_id}/preview", response_model=PreviewInfo)
async def preview_info(
    doc_id: str,
    sheets: int | None = Query(None, ge=1, le=1000),
    copies: int | None = Query(None, ge=1, le=10000),
    first: int = Query(1, ge=1),
    outlines: bool = False,
    crop_marks: bool = False,
    reverse: bool = False,
    collate: bool = False,
    group_per_page: bool = False,
    app: AppState = Depends(state),
) -> PreviewInfo:
    """How many pages does this print make, and how large is a page?"""
    settings = _settings_from_query(
        sheets, copies, first, outlines, crop_marks, reverse, collate, group_per_page
    )
    info, pdf = await _ensure_pdf(app, doc_id, settings)
    width, height = _pdf_page_size(pdf)
    return PreviewInfo(
        revision=info.revision, pages=_pdf_pages(pdf), page_width_pt=width, page_height_pt=height
    )


@router.get("/{doc_id}/preview.png")
async def preview_png(
    doc_id: str,
    page: int = Query(1, ge=1, le=1000),
    dpi: int = Query(96, ge=24, le=600),
    sheets: int | None = Query(None, ge=1, le=1000),
    copies: int | None = Query(None, ge=1, le=10000),
    first: int = Query(1, ge=1),
    outlines: bool = False,
    crop_marks: bool = False,
    reverse: bool = False,
    collate: bool = False,
    group_per_page: bool = False,
    app: AppState = Depends(state),
) -> FileResponse:
    """Page preview: a rasterisation of exactly the PDF that gets printed."""
    settings = _settings_from_query(
        sheets, copies, first, outlines, crop_marks, reverse, collate, group_per_page
    )
    info, pdf = await _ensure_pdf(app, doc_id, settings)

    image = pdf.with_name(f"{pdf.stem}-p{page:03d}-{dpi}.png")
    if not image.exists():
        try:
            await app.renderer.rasterize(pdf, image, page=page, dpi=dpi)
        except RenderError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return FileResponse(image, media_type="image/png")


@router.get("/{doc_id}/print.pdf")
async def print_pdf(
    doc_id: str,
    sheets: int | None = Query(None, ge=1, le=1000),
    copies: int | None = Query(None, ge=1, le=10000),
    first: int = Query(1, ge=1),
    outlines: bool = False,
    crop_marks: bool = False,
    reverse: bool = False,
    collate: bool = False,
    group_per_page: bool = False,
    app: AppState = Depends(state),
) -> FileResponse:
    """The print as a PDF, to keep or to send yourself.

    Printing to a printer happens in the backend; this route is the fallback
    and the evidence, not the regular print path.
    """
    settings = _settings_from_query(
        sheets, copies, first, outlines, crop_marks, reverse, collate, group_per_page
    )
    info, pdf = await _ensure_pdf(app, doc_id, settings)
    filename = (_SAFE_NAME.sub("_", info.name) or "document") + ".pdf"
    return FileResponse(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8\'\'{quote(filename)}"},
    )


# ---------------------------------------------------------- shared folder
class ImportFromFileRequest(BaseModel):
    path: str = Field(max_length=1024)


class ExportToFileRequest(BaseModel):
    path: str = Field(default="", max_length=1024)
    name: str | None = Field(default=None, max_length=180)
    overwrite: bool = False


class MergeSettingsRequest(BaseModel):
    type: str = Field(max_length=64)
    source_path: str | None = Field(default=None, max_length=1024)


class MergePreviewOut(BaseModel):
    type: str
    label: str
    source_path: str | None = None
    keys: list[str] = Field(default_factory=list)
    records: list[dict[str, str]] = Field(default_factory=list)
    record_count: int = 0
    truncated: bool = False


@router.post("/import-from-file", response_model=DocumentDetail, status_code=201)
def import_from_file(request: ImportFromFileRequest, app: AppState = Depends(state)) -> DocumentDetail:
    """Open a .glabels file from the shared folder as a project."""
    try:
        raw = app.files.read(request.path, max_bytes=app.settings.max_upload_bytes)
        entry = app.files.entry(request.path)
    except FileAreaError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        doc = Document.from_bytes(raw, max_uncompressed_bytes=app.settings.max_upload_bytes)
        template_node = doc.template_element
    except XmlError as exc:
        raise HTTPException(status_code=422, detail=f"unusable file: {exc}") from exc

    path = entry.path
    sha = _sha(raw)
    xml_bytes = raw if raw[:2] != b"\x1f\x8b" else doc.to_bytes()

    # If this file already is a project, we open that one instead of making a
    # copy. If it was changed outside the app in the meantime (with gLabels
    # on the desktop, for example), that version becomes a new revision.
    existing = app.store.find_by_file(path)
    if existing is not None:
        _, known = app.store.file_link(existing.id)
        if sha != known:
            existing = app.store.save_revision(
                existing.id, xml_bytes, object_ids=doc.object_ids()
            )
            app.store.set_file_link(existing.id, path, sha)
        info, current = _load(app, existing.id)
        return _detail(app, info, current)

    name = _stem(entry.name)

    info = app.store.create(
        name=name or "Imported",
        xml_bytes=xml_bytes,
        template_brand=template_node.get("brand") or "",
        template_part=template_node.get("part") or "",
        template_description=template_node.get("description") or "",
    )
    app.store.set_object_ids(info.id, doc.object_ids())
    info = app.store.set_file_link(info.id, path, sha)

    # If the merge source sits next to the file, we link it right away.
    spec = doc.merge()
    if spec is not None and spec.src:
        folder = request.path.rsplit("/", 1)[0] if "/" in request.path else ""
        candidate = f"{folder}/{spec.src}" if folder else spec.src
        try:
            app.files.entry(candidate)
            info = app.store.set_merge_source(info.id, candidate)
        except FileAreaError:
            pass

    return _detail(app, info, doc)


@router.post("/{doc_id}/export-to-file", response_model=DocumentInfo)
def export_to_file(
    doc_id: str, request: ExportToFileRequest, app: AppState = Depends(state)
) -> DocumentInfo:
    """Write the document as .glabels into the shared folder."""
    info, _ = _load(app, doc_id)
    raw = app.store.read_revision(doc_id)

    filename = (request.name or info.name or "document").strip()
    if not filename.lower().endswith(".glabels"):
        filename += ".glabels"

    try:
        app.files.write(request.path, filename, raw, overwrite=request.overwrite)
    except FileAreaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return info


class SaveAsRequest(BaseModel):
    # Folder inside the shared folder; empty is the base folder.
    path: str = Field(default="", max_length=1024)
    name: str = Field(min_length=1, max_length=180)
    overwrite: bool = False


@router.post("/{doc_id}/save-as", response_model=DocumentDetail)
def save_as(doc_id: str, request: SaveAsRequest, app: AppState = Depends(state)) -> DocumentDetail:
    """Give the project a file in the shared folder.

    From now on every save updates that file. The project takes the name of
    the file.
    """
    _load(app, doc_id)
    filename = _document_filename(request.name)
    folder = request.path.strip().strip("/")
    target = f"{folder}/{filename}" if folder else filename

    try:
        # Same spelling as when opening, so the project can be found again.
        target = app.files.relative(app.files.resolve(target))
        exists = app.files.sha256(target) is not None
    except FileAreaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if exists and not request.overwrite:
        # A fixed code, so the interface can ask for confirmation.
        raise HTTPException(status_code=409, detail="file-exists")

    raw = app.store.read_revision(doc_id)
    try:
        app.files.write_file(target, raw)
    except FileAreaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # If another project was linked to this file, it no longer is.
    other = app.store.find_by_file(target)
    while other is not None and other.id != doc_id:
        app.store.set_file_link(other.id, None)
        other = app.store.find_by_file(target)

    app.store.set_file_link(doc_id, target, _sha(raw))
    app.store.rename(doc_id, _stem(filename))
    info, doc = _load(app, doc_id)
    return _detail(app, info, doc)


class ResolveFileRequest(BaseModel):
    # "app": the version in the app overwrites the file.
    # "file": the version in the file becomes a new revision.
    keep: str = Field(pattern="^(app|file)$")


@router.post("/{doc_id}/file/resolve", response_model=DocumentDetail)
def resolve_file_conflict(
    doc_id: str, request: ResolveFileRequest, app: AppState = Depends(state)
) -> DocumentDetail:
    """Choose which version stays when the file was changed outside the app."""
    _load(app, doc_id)
    path, _ = app.store.file_link(doc_id)
    if not path:
        raise HTTPException(status_code=409, detail="this project has no file in the folder")

    if request.keep == "app":
        _write_through(app, doc_id, force=True)
    else:
        try:
            raw = app.files.read(path, max_bytes=app.settings.max_upload_bytes)
            doc = Document.from_bytes(raw, max_uncompressed_bytes=app.settings.max_upload_bytes)
        except FileAreaError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except XmlError as exc:
            raise HTTPException(status_code=422, detail=f"unusable file: {exc}") from exc
        xml_bytes = raw if raw[:2] != b"\x1f\x8b" else doc.to_bytes()
        app.store.save_revision(doc_id, xml_bytes, object_ids=doc.object_ids())
        app.store.set_file_link(doc_id, path, _sha(raw))

    info, doc = _load(app, doc_id)
    return _detail(app, info, doc)


@router.get("/{doc_id}/merge", response_model=MergePreviewOut)
def merge_preview(doc_id: str, app: AppState = Depends(state)) -> MergePreviewOut:
    """Fields and first rows of this document's merge source."""
    info, doc = _load(app, doc_id)
    spec = doc.merge()
    merge_type = spec.type if spec else "None"

    out = MergePreviewOut(
        type=merge_type,
        label=merge_backends.label_for(merge_type),
        source_path=info.merge_source_path,
    )
    if not info.merge_source_path or merge_type == "None":
        return out

    try:
        raw = app.files.read(info.merge_source_path, max_bytes=app.settings.max_upload_bytes)
    except FileAreaError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        preview = merge_backends.preview(raw, merge_type)
    except merge_backends.MergeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    out.keys = preview.keys
    out.records = preview.records
    out.record_count = preview.record_count
    out.truncated = preview.truncated
    return out


@router.put("/{doc_id}/merge", response_model=DocumentDetail)
def set_merge(doc_id: str, request: MergeSettingsRequest, app: AppState = Depends(state)) -> DocumentDetail:
    """Set the merge type and source; this makes a new revision."""
    info, doc = _load(app, doc_id)

    if not merge_backends.is_known_type(request.type):
        raise HTTPException(status_code=422, detail=f"unknown merge type: {request.type}")

    source_path = (request.source_path or "").strip() or None
    if source_path is not None:
        try:
            entry = app.files.entry(source_path)
        except FileAreaError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if entry.is_dir:
            raise HTTPException(status_code=400, detail="choose a file, not a folder")
        src_name = entry.name
    else:
        src_name = None

    doc.set_merge(request.type, src_name)
    info = app.store.save_revision(doc_id, doc.to_bytes(), object_ids=doc.object_ids())
    info = app.store.set_merge_source(doc_id, source_path if request.type != "None" else None)
    return _detail(app, info, doc)


# ------------------------------------------------------------------- printing
class PrintRequest(BaseModel):
    printer: str = Field(max_length=127)
    settings: PrintSettings = Field(default_factory=PrintSettings)
    # Our own id for this print action. If the same request is sent again
    # (after a retry or a flaky connection), we return the existing job
    # instead of printing again.
    request_id: str = Field(max_length=64)


class PrintResult(BaseModel):
    job_id: int
    printer: str
    document: str
    revision: int
    state: str = ""
    duplicate: bool = False


@router.post("/{doc_id}/print", response_model=PrintResult)
async def print_document(
    doc_id: str, request: PrintRequest, app: AppState = Depends(state)
) -> PrintResult:
    """Print the document to an IPP printer.

    Exactly the same PDF as in the print preview is sent; it is made once
    for this revision and these settings, and kept.
    """
    existing = app.store.find_print_request(request.request_id)
    if existing is not None:
        info = app.store.info(doc_id)
        log.info(
            "print request %s was already sent as job %s", request.request_id, existing.job_id
        )
        return PrintResult(
            job_id=existing.job_id,
            printer=existing.printer,
            document=info.name,
            revision=info.revision,
            duplicate=True,
        )

    try:
        printer = app.registry.require(request.printer)
    except PrintingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    info, pdf = await _ensure_pdf(app, doc_id, request.settings)
    title = f"{info.name} (revision {info.revision})"

    def work():
        return app.printers.print_pdf(
            printer.uri, pdf, job_name=title, page_size_pt=_pdf_page_size(pdf)
        )

    try:
        job = await to_thread.run_sync(work)
    except PrintingUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except PrintingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    app.store.record_print_request(
        request.request_id, doc_id, printer.name, printer.uri, job.job_id, title
    )
    app.store.prune_print_requests()
    log.info("job %s to %s (%s revision %s)", job.job_id, printer.name, info.name, info.revision)
    return PrintResult(
        job_id=job.job_id,
        printer=printer.name,
        document=info.name,
        revision=info.revision,
        state=job.state,
    )
