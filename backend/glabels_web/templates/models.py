"""Typed view of the gLabels template database.

Sizes are always in points here. The source XML stays authoritative; these
models are a projection for the API and the editor.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PaperSize(BaseModel):
    id: str
    name: str
    width_pt: float
    height_pt: float
    pwg_class: str | None = None


class Category(BaseModel):
    id: str
    name: str


class Vendor(BaseModel):
    name: str
    url: str | None = None


class Layout(BaseModel):
    """Grid of labels on the sheet."""

    nx: int
    ny: int
    x0_pt: float = 0.0
    y0_pt: float = 0.0
    dx_pt: float = 0.0
    dy_pt: float = 0.0


class Markup(BaseModel):
    """Guide lines on the label; not printed."""

    type: Literal["margin", "line", "circle", "rect", "ellipse"]
    values: dict[str, float] = Field(default_factory=dict)


class Frame(BaseModel):
    """Shape and size of one label on the sheet."""

    id: str = "0"
    shape: Literal["rectangle", "round", "ellipse", "cd", "continuous"]
    width_pt: float | None = None
    height_pt: float | None = None
    radius_pt: float | None = None
    hole_pt: float | None = None
    round_pt: float | None = None
    x_waste_pt: float = 0.0
    y_waste_pt: float = 0.0
    min_height_pt: float | None = None
    max_height_pt: float | None = None
    default_height_pt: float | None = None
    markups: list[Markup] = Field(default_factory=list)
    layouts: list[Layout] = Field(default_factory=list)

    @property
    def bounding_size_pt(self) -> tuple[float, float]:
        """Bounding rectangle size, whatever the shape."""
        if self.shape in ("round", "cd"):
            r = self.radius_pt or 0.0
            return (self.width_pt or 2 * r, self.height_pt or 2 * r)
        if self.shape == "continuous":
            return (self.width_pt or 0.0, self.height_pt or self.default_height_pt or 0.0)
        return (self.width_pt or 0.0, self.height_pt or 0.0)


class Template(BaseModel):
    brand: str
    part: str
    description: str = ""
    # Paper size id (A4, US-Letter, ...) or "roll"/"Other".
    size: str | None = None
    page_width_pt: float | None = None
    page_height_pt: float | None = None
    roll_width_pt: float | None = None
    categories: list[str] = Field(default_factory=list)
    product_url: str | None = None
    frames: list[Frame] = Field(default_factory=list)
    # Filled in when this template is derived from another through equiv.
    equiv_part: str | None = None
    source: Literal["system", "user"] = "system"

    @property
    def key(self) -> str:
        return f"{self.brand}␟{self.part}"

    @property
    def frame(self) -> Frame:
        return self.frames[0]
