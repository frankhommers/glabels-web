"""Product definitions: searching, choosing and managing user definitions."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from ..templates.models import Category, PaperSize, Template
from ..templates.writer import TemplateWriteError
from .deps import AppState, state

router = APIRouter(prefix="/api/templates", tags=["templates"])


class TemplateSearchResult(BaseModel):
    total: int
    items: list[Template]


def _refresh(app: AppState) -> None:
    """Pick up definitions put directly into the shared folder."""
    app.templates.refresh_if_changed()


@router.get("/brands", response_model=list[str])
def brands(app: AppState = Depends(state)) -> list[str]:
    _refresh(app)
    return app.templates.brands()


@router.get("/categories", response_model=list[Category])
def categories(app: AppState = Depends(state)) -> list[Category]:
    return list(app.templates.categories.values())


@router.get("/paper-sizes", response_model=list[PaperSize])
def paper_sizes(app: AppState = Depends(state)) -> list[PaperSize]:
    return list(app.templates.paper_sizes.values())


@router.get("", response_model=TemplateSearchResult)
def search(
    q: str = "",
    brand: str | None = None,
    category: str | None = None,
    paper_size: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    app: AppState = Depends(state),
) -> TemplateSearchResult:
    _refresh(app)
    items, total = app.templates.search(
        text=q, brand=brand, category=category, paper_size=paper_size, limit=limit, offset=offset
    )
    return TemplateSearchResult(total=total, items=items)


@router.post("", response_model=Template, status_code=201)
def save_template(template: Template, app: AppState = Depends(state)) -> Template:
    """Store a user product definition, or update one.

    The definition becomes a separate XML file in the shared folder, in the
    same shape as the bundled database. Such a file is usable in the desktop
    app too.
    """
    _refresh(app)
    for problem in _validate(template):
        raise HTTPException(status_code=422, detail=problem)

    try:
        return app.templates.save_user_template(template.model_copy(update={"source": "user"}))
    except TemplateWriteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/{brand}/{part}", status_code=204)
def delete_template(brand: str, part: str, app: AppState = Depends(state)) -> Response:
    try:
        app.templates.delete_user_template(brand, part)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"unknown template: {brand} {part}") from exc
    except TemplateWriteError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return Response(status_code=204)


@router.get("/{brand}/{part}", response_model=Template)
def detail(brand: str, part: str, app: AppState = Depends(state)) -> Template:
    _refresh(app)
    template = app.templates.get(brand, part)
    if template is None:
        raise HTTPException(status_code=404, detail=f"unknown template: {brand} {part}")
    return template


def _validate(template: Template) -> list[str]:
    """Check a definition for things that make an unusable sheet."""
    problems: list[str] = []
    if not template.brand.strip():
        problems.append("a brand is required")
    if not template.part.strip():
        problems.append("a part number is required")
    if not template.frames:
        problems.append("a definition needs a label shape")
        return problems

    frame = template.frames[0]
    width, height = frame.bounding_size_pt
    if width <= 0 or height <= 0:
        problems.append("the label must have a width and height greater than zero")

    page_w = template.page_width_pt or 0
    page_h = template.page_height_pt or 0
    if page_w <= 0 or page_h <= 0:
        problems.append("the paper size must have a width and height greater than zero")

    if not frame.layouts:
        problems.append("a definition needs a sheet layout")
        return problems

    layout = frame.layouts[0]
    if layout.nx < 1 or layout.ny < 1:
        problems.append("the sheet layout needs at least one label in both directions")
    elif page_w > 0 and page_h > 0:
        # Do the last row and column still fit on the sheet? Half a millimetre
        # of slack so rounding in the input is not reported as an error.
        right = layout.x0_pt + layout.dx_pt * (layout.nx - 1) + width
        bottom = layout.y0_pt + layout.dy_pt * (layout.ny - 1) + height
        slack = 72 / 25.4 * 0.5
        if right > page_w + slack or bottom > page_h + slack:
            problems.append(
                "the labels do not fit on the sheet; check the sizes, the start position "
                "and the pitch"
            )
    return problems
