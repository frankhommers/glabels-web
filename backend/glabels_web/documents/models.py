"""API projection of a gLabels document.

This is a projection, not a replacement: the original XML tree is kept in
``Document`` and is authoritative when saving. Anything that does not appear
here stays in the file unchanged.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class ColorSpec(BaseModel):
    """A fixed colour or a reference to a merge/variable field."""

    color: str | None = None  # "#rrggbbaa"
    field: str | None = None


class Shadow(BaseModel):
    enabled: bool = False
    x_pt: float = 0.0
    y_pt: float = 0.0
    opacity: float = 1.0
    color: ColorSpec = Field(default_factory=ColorSpec)


class BaseObject(BaseModel):
    id: str | None = None
    x_pt: float = 0.0
    y_pt: float = 0.0
    # Affine transformation a0..a5 as in the file format.
    affine: list[float] = Field(default_factory=lambda: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    shadow: Shadow = Field(default_factory=Shadow)


class SizedObject(BaseObject):
    w_pt: float = 0.0
    h_pt: float = 0.0
    lock_aspect_ratio: bool = False


class TextObject(SizedObject):
    type: Literal["text"] = "text"
    lines: list[str] = Field(default_factory=list)
    font_family: str = "Sans"
    font_size: float = 10.0
    font_weight: Literal["normal", "bold"] = "normal"
    font_italic: bool = False
    font_underline: bool = False
    color: ColorSpec = Field(default_factory=lambda: ColorSpec(color="#000000ff"))
    line_spacing: float = 1.0
    align: Literal["left", "center", "right"] = "left"
    valign: Literal["top", "center", "bottom"] = "top"
    wrap: Literal["word", "anywhere", "none"] = "word"
    auto_shrink: bool = False


class BoxObject(SizedObject):
    type: Literal["box"] = "box"
    line_width_pt: float = 1.0
    line_color: ColorSpec = Field(default_factory=lambda: ColorSpec(color="#000000ff"))
    fill_color: ColorSpec = Field(default_factory=lambda: ColorSpec(color="#00000000"))


class EllipseObject(SizedObject):
    type: Literal["ellipse"] = "ellipse"
    line_width_pt: float = 1.0
    line_color: ColorSpec = Field(default_factory=lambda: ColorSpec(color="#000000ff"))
    fill_color: ColorSpec = Field(default_factory=lambda: ColorSpec(color="#00000000"))


class LineObject(BaseObject):
    type: Literal["line"] = "line"
    dx_pt: float = 0.0
    dy_pt: float = 0.0
    line_width_pt: float = 1.0
    line_color: ColorSpec = Field(default_factory=lambda: ColorSpec(color="#000000ff"))


class ImageObject(SizedObject):
    type: Literal["image"] = "image"
    # Reference to an embedded file in the Data section or an external path.
    src: str | None = None
    src_field: str | None = None
    # Derived, read-only: is the source inside this file?
    embedded: bool = False


class BarcodeObject(SizedObject):
    type: Literal["barcode"] = "barcode"
    # An empty backend means the built-in backend in the file format. Never
    # fill it in silently: that changes the chosen barcode output.
    backend: str = ""
    style: str = "code128"
    show_text: bool = True
    checksum: bool = True
    data: str = ""
    color: ColorSpec = Field(default_factory=lambda: ColorSpec(color="#000000ff"))


class UnsupportedObject(BaseObject):
    """An object we keep but cannot edit.

    The XML element stays unchanged. The editor shows it as locked.
    """

    type: Literal["unsupported"] = "unsupported"
    tag: str = ""
    reason: str = ""


DocumentObject = Annotated[
    Union[
        TextObject,
        BoxObject,
        EllipseObject,
        LineObject,
        ImageObject,
        BarcodeObject,
        UnsupportedObject,
    ],
    Field(discriminator="type"),
]


class MergeSpec(BaseModel):
    type: str
    src: str | None = None
    # Was the source found in the shared folder?
    available: bool = False
    # Path inside the shared folder, if known.
    source_path: str | None = None


class VariableSpec(BaseModel):
    type: Literal["numeric", "string"]
    name: str
    value: str
    increment: Literal["never", "per_copy", "per_merge_record", "per_page"]
    step_size: str


class EmbeddedFile(BaseModel):
    name: str
    mimetype: str
    size_bytes: int


class Limitation(BaseModel):
    """An explicitly reported limitation of this document in the web app.

    ``code`` and ``params`` are meant for the interface, which builds the
    message in the user's language. ``message`` comes along as a fallback and
    for whoever talks to the API directly.
    """

    code: str
    message: str
    params: dict[str, str] = Field(default_factory=dict)
    blocks_editing: bool = False


class DocumentContent(BaseModel):
    """Editable content; this is what the editor sends back."""

    rotate: bool = False
    objects: list[DocumentObject] = Field(default_factory=list)


class DocumentInfo(BaseModel):
    id: str
    name: str
    revision: int
    created_at: str
    updated_at: str
    template_brand: str
    template_part: str
    template_description: str = ""
    # Path inside the shared folder to the merge source, if one was chosen.
    merge_source_path: str | None = None
    # The .glabels file in the shared folder this project lives in. Empty
    # until the project has been saved under a name.
    file_path: str | None = None


class DocumentDetail(DocumentInfo):
    # State of the linked file in the folder:
    #   none      not saved under a name yet
    #   linked    the file equals what we last wrote
    #   conflict  someone changed the file outside the app
    #   missing   the file is gone; the next save puts it back
    file_state: str = "none"
    # Geometry of the label the editor draws on.
    label_width_pt: float
    label_height_pt: float
    label_shape: str
    label_round_pt: float = 0.0
    label_radius_pt: float | None = None
    label_hole_pt: float | None = None
    markups: list[dict] = Field(default_factory=list)
    content: DocumentContent
    merge: MergeSpec | None = None
    variables: list[VariableSpec] = Field(default_factory=list)
    embedded_files: list[EmbeddedFile] = Field(default_factory=list)
    limitations: list[Limitation] = Field(default_factory=list)
