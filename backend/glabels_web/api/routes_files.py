"""The shared folder: browsing, uploading, downloading and deleting.

This folder is mounted into the container as a volume. Everything stays inside
it; a path from a request is always checked against the base folder first.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..files import FileAreaError, FileEntry
from .deps import AppState, state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/files", tags=["files"])


class FileEntryOut(BaseModel):
    path: str
    name: str
    is_dir: bool
    size_bytes: int
    modified_at: str
    kind: str


class DirectoryListing(BaseModel):
    path: str
    parent: str | None
    available: bool
    entries: list[FileEntryOut]


class MakeDirectoryRequest(BaseModel):
    path: str = ""
    name: str = Field(min_length=1, max_length=180)


def _out(entry: FileEntry) -> FileEntryOut:
    return FileEntryOut(**entry.__dict__)


def _parent(path: str) -> str | None:
    cleaned = path.strip("/")
    if not cleaned:
        return None
    return cleaned.rsplit("/", 1)[0] if "/" in cleaned else ""


@router.get("", response_model=DirectoryListing)
def list_directory(path: str = Query("", max_length=1024), app: AppState = Depends(state)) -> DirectoryListing:
    if not app.files.available:
        return DirectoryListing(path="", parent=None, available=False, entries=[])
    try:
        entries = app.files.list(path)
    except FileAreaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DirectoryListing(
        path=path.strip("/"),
        parent=_parent(path),
        available=True,
        entries=[_out(entry) for entry in entries],
    )


@router.post("/upload", response_model=FileEntryOut, status_code=201)
async def upload(
    path: str = Form(""),
    file: UploadFile = File(...),
    app: AppState = Depends(state),
) -> FileEntryOut:
    raw = await file.read(app.settings.max_upload_bytes + 1)
    if len(raw) > app.settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="the file is larger than allowed")
    try:
        entry = app.files.write(path, file.filename or "file", raw)
    except FileAreaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # A font in the fonts folder must be usable right away.
    app.fonts.refresh_if_changed()
    return _out(entry)


@router.post("/directory", response_model=FileEntryOut, status_code=201)
def make_directory(request: MakeDirectoryRequest, app: AppState = Depends(state)) -> FileEntryOut:
    try:
        return _out(app.files.make_directory(request.path, request.name))
    except FileAreaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/download")
def download(path: str = Query(..., max_length=1024), app: AppState = Depends(state)) -> FileResponse:
    try:
        entry = app.files.entry(path)
        resolved = app.files.resolve(path)
    except FileAreaError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if entry.is_dir:
        raise HTTPException(status_code=400, detail="a folder cannot be downloaded")
    return FileResponse(
        resolved,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(entry.name)}"},
    )


@router.delete("", status_code=204)
def delete(path: str = Query(..., max_length=1024), app: AppState = Depends(state)) -> Response:
    try:
        app.files.delete(path)
    except FileAreaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    app.fonts.refresh_if_changed()
    return Response(status_code=204)
