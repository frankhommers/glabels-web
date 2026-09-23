"""Fonts: listing, uploading, deleting and serving them to the browser."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..fonts import FontError
from ..fonts.library import MAX_FONT_BYTES
from .deps import AppState, state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/fonts", tags=["fonts"])


class FontFaceOut(BaseModel):
    id: str
    family: str
    subfamily: str
    full_name: str
    source: str
    bold: bool
    italic: bool
    size_bytes: int
    url: str
    media_type: str


class FontFamilyOut(BaseModel):
    family: str
    source: str
    faces: list[FontFaceOut]


def _face_out(face) -> FontFaceOut:
    return FontFaceOut(
        id=face.id,
        family=face.family,
        subfamily=face.subfamily,
        full_name=face.full_name,
        source=face.source,
        bold=face.bold,
        italic=face.italic,
        size_bytes=face.size_bytes,
        url=f"/api/fonts/{face.id}/file",
        media_type=face.media_type,
    )


@router.get("", response_model=list[FontFamilyOut])
def list_fonts(app: AppState = Depends(state)) -> list[FontFamilyOut]:
    """All fonts the renderer can use, grouped by family.

    The fonts folder lives in the shared folder, so something may have been
    added outside the web interface; we pick that up here.
    """
    app.fonts.refresh_if_changed()
    families: dict[str, list] = {}
    for face in app.fonts.faces():
        families.setdefault(face.family, []).append(face)

    result = []
    for family, faces in families.items():
        source = "uploaded" if any(face.source == "uploaded" for face in faces) else "builtin"
        result.append(
            FontFamilyOut(family=family, source=source, faces=[_face_out(face) for face in faces])
        )
    result.sort(key=lambda item: item.family.casefold())
    return result


@router.post("", response_model=FontFaceOut, status_code=201)
async def upload_font(file: UploadFile = File(...), app: AppState = Depends(state)) -> FontFaceOut:
    raw = await file.read(MAX_FONT_BYTES + 1)
    if len(raw) > MAX_FONT_BYTES:
        raise HTTPException(status_code=413, detail="the font file is too large")
    try:
        face = app.fonts.add_upload(file.filename or "font.ttf", raw)
    except FontError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    log.info("font added: %s (%s)", face.full_name, face.path.name)
    return _face_out(face)


@router.delete("/{face_id}", status_code=204)
def delete_font(face_id: str, app: AppState = Depends(state)) -> Response:
    try:
        app.fonts.remove_upload(face_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="font not found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return Response(status_code=204)


@router.get("/{face_id}/file")
def font_file(face_id: str, app: AppState = Depends(state)) -> FileResponse:
    face = app.fonts.face(face_id)
    if face is None:
        raise HTTPException(status_code=404, detail="font not found")
    return FileResponse(
        face.path,
        media_type=face.media_type,
        headers={"Cache-Control": "public, max-age=604800"},
    )
