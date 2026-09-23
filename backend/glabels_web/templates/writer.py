"""Writing user product definitions.

A definition is stored as a separate XML file in the shared folder, in the
same shape as the bundled database. That makes such a file usable in the
desktop app too: put it in ``~/.glabels`` and gLabels Qt reads it.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from lxml import etree

from ..units import format_length
from .models import Template

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")

# Supported shapes and the matching element from the DTD.
SHAPE_TAGS = {
    "rectangle": "Label-rectangle",
    "round": "Label-round",
    "ellipse": "Label-ellipse",
    "cd": "Label-cd",
    "continuous": "Label-continuous",
}


class TemplateWriteError(ValueError):
    """The definition cannot be written."""


def safe_filename(brand: str, part: str) -> str:
    raw = f"{brand}-{part}"
    normalized = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    cleaned = _SAFE.sub("-", normalized).strip("-._")
    if not cleaned:
        raise TemplateWriteError("brand and part do not make a usable file name")
    return f"{cleaned[:120]}.xml"


def _length(value: float | None) -> str:
    return format_length(value or 0.0)


def build_template_element(template: Template) -> etree._Element:
    """Turn a product definition into a ``<Template>`` element."""
    if not template.frames:
        raise TemplateWriteError("a definition needs at least one label shape")

    node = etree.Element("Template")
    node.set("brand", template.brand)
    node.set("part", template.part)
    node.set("size", template.size or "Other")
    if (template.size or "Other") == "Other":
        node.set("width", _length(template.page_width_pt))
        node.set("height", _length(template.page_height_pt))
    if template.roll_width_pt:
        node.set("roll_width", _length(template.roll_width_pt))
    node.set("description", template.description or f"{template.brand} {template.part}")

    if template.product_url:
        meta = etree.SubElement(node, "Meta")
        meta.set("product_url", template.product_url)
    for category in template.categories:
        meta = etree.SubElement(node, "Meta")
        meta.set("category", category)

    frame = template.frames[0]
    tag = SHAPE_TAGS.get(frame.shape)
    if tag is None:
        raise TemplateWriteError(f"unknown label shape: {frame.shape}")

    label = etree.SubElement(node, tag)
    label.set("id", frame.id or "0")

    if frame.shape in ("rectangle", "ellipse", "continuous"):
        label.set("width", _length(frame.width_pt))
    if frame.shape in ("rectangle", "ellipse"):
        label.set("height", _length(frame.height_pt))
    if frame.shape == "rectangle":
        label.set("round", _length(frame.round_pt))
        label.set("x_waste", _length(frame.x_waste_pt))
        label.set("y_waste", _length(frame.y_waste_pt))
    if frame.shape == "ellipse":
        label.set("waste", _length(frame.x_waste_pt))
    if frame.shape in ("round", "cd"):
        label.set("radius", _length(frame.radius_pt))
        label.set("waste", _length(frame.x_waste_pt))
    if frame.shape == "cd":
        label.set("hole", _length(frame.hole_pt))
        if frame.width_pt:
            label.set("width", _length(frame.width_pt))
        if frame.height_pt:
            label.set("height", _length(frame.height_pt))
    if frame.shape == "continuous":
        label.set("min_height", _length(frame.min_height_pt))
        label.set("max_height", _length(frame.max_height_pt))
        label.set("default_height", _length(frame.default_height_pt))

    for markup in frame.markups:
        if markup.type != "margin":
            # Other markup cannot be edited yet; it does not belong in a
            # self-made definition either.
            continue
        element = etree.SubElement(label, "Markup-margin")
        if "size" in markup.values:
            element.set("size", _length(markup.values["size"]))
        else:
            element.set("x_size", _length(markup.values.get("x_size")))
            element.set("y_size", _length(markup.values.get("y_size")))

    if not frame.layouts:
        raise TemplateWriteError("a definition needs a sheet layout")
    for layout in frame.layouts:
        element = etree.SubElement(label, "Layout")
        element.set("nx", str(layout.nx))
        element.set("ny", str(layout.ny))
        element.set("x0", _length(layout.x0_pt))
        element.set("y0", _length(layout.y0_pt))
        element.set("dx", _length(layout.dx_pt))
        element.set("dy", _length(layout.dy_pt))

    return node


def write_template_file(template: Template, directory: Path) -> Path:
    """Write one definition to a file of its own in ``directory``."""
    directory.mkdir(parents=True, exist_ok=True)
    root = etree.Element("Glabels-templates")
    root.append(build_template_element(template))

    tree = etree.ElementTree(root)
    etree.indent(tree, space="  ")
    body = etree.tostring(root, encoding="utf-8", xml_declaration=False)

    path = directory / safe_filename(template.brand, template.part)
    path.write_bytes(b'<?xml version="1.0"?>\n' + body + b"\n")
    return path
