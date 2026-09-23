"""A ``.glabels`` document that keeps the original XML tree.

Principle from the handover: the XML is authoritative. We edit known
attributes precisely and leave everything else untouched, so a document the
desktop app made never silently loses information.
"""

from __future__ import annotations

import base64
import gzip
import logging
from typing import Iterator

from lxml import etree

from ..colors import Rgba
from ..units import format_length, format_number, parse_length
from ..xml_safe import XmlError, make_parser
from .models import (
    BarcodeObject,
    BoxObject,
    ColorSpec,
    DocumentContent,
    DocumentObject,
    EllipseObject,
    EmbeddedFile,
    ImageObject,
    Limitation,
    LineObject,
    MergeSpec,
    Shadow,
    TextObject,
    UnsupportedObject,
    VariableSpec,
)

log = logging.getLogger(__name__)

SUPPORTED_VERSION = "4.0"

_TAG_BY_TYPE = {
    "text": "Object-text",
    "box": "Object-box",
    "ellipse": "Object-ellipse",
    "line": "Object-line",
    "image": "Object-image",
    "barcode": "Object-barcode",
}
_TYPE_BY_TAG = {v: k for k, v in _TAG_BY_TYPE.items()}


# -------------------------------------------------------------------- helpers
def _bool_attr(node: etree._Element, name: str, default: bool = False) -> bool:
    raw = node.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("true", "1")


def _set_bool(node: etree._Element, name: str, value: bool) -> None:
    node.set(name, "true" if value else "false")


def _float_attr(node: etree._Element, name: str, default: float) -> float:
    raw = node.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        log.warning("unreadable number %s=%r in <%s>", name, raw, node.tag)
        return default


def _length_attr(node: etree._Element, name: str, default: float) -> float:
    raw = node.get(name)
    if raw is None or raw == "":
        return default
    try:
        return parse_length(raw)
    except ValueError:
        log.warning("unreadable length %s=%r in <%s>", name, raw, node.tag)
        return default


def _read_color(node: etree._Element, attr: str, field_attr: str, default: int = 0xFF) -> ColorSpec:
    field = node.get(field_attr)
    if field:
        return ColorSpec(field=field)
    raw = node.get(attr)
    value = default if raw in (None, "") else int(raw, 0)
    return ColorSpec(color=Rgba.from_uint(value).to_css())


def _write_color(node: etree._Element, attr: str, field_attr: str, spec: ColorSpec) -> None:
    if spec.field:
        node.set(field_attr, spec.field)
        node.attrib.pop(attr, None)
    else:
        node.set(attr, Rgba.from_css(spec.color or "#000000ff").to_attr())
        node.attrib.pop(field_attr, None)


def _read_affine(node: etree._Element) -> list[float]:
    defaults = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    return [_float_attr(node, f"a{i}", defaults[i]) for i in range(6)]


def _write_affine(node: etree._Element, affine: list[float]) -> None:
    values = (affine + [1.0, 0.0, 0.0, 1.0, 0.0, 0.0][len(affine) :])[:6]
    for i, value in enumerate(values):
        node.set(f"a{i}", format_number(value))


def _read_shadow(node: etree._Element) -> Shadow:
    return Shadow(
        enabled=_bool_attr(node, "shadow", False),
        x_pt=_length_attr(node, "shadow_x", 0.0),
        y_pt=_length_attr(node, "shadow_y", 0.0),
        opacity=_float_attr(node, "shadow_opacity", 1.0),
        color=_read_color(node, "shadow_color", "shadow_color_field"),
    )


def _write_shadow(node: etree._Element, shadow: Shadow) -> None:
    _set_bool(node, "shadow", shadow.enabled)
    node.set("shadow_x", format_length(shadow.x_pt))
    node.set("shadow_y", format_length(shadow.y_pt))
    node.set("shadow_opacity", format_number(shadow.opacity))
    _write_color(node, "shadow_color", "shadow_color_field", shadow.color)


# Alignment as gLabels Qt writes it (XmlUtil::setAlignmentAttr): "hcenter"
# and "vcenter", not "center". Upstream reads an unknown value as left/top,
# so writing "center" shifts the text in the print. When reading we accept
# "center" too; earlier versions of this application wrote that.
_H_ALIGN_READ = {"left": "left", "hcenter": "center", "center": "center", "right": "right"}
_V_ALIGN_READ = {"top": "top", "vcenter": "center", "center": "center", "bottom": "bottom"}
_H_ALIGN_WRITE = {"left": "left", "center": "hcenter", "right": "right"}
_V_ALIGN_WRITE = {"top": "top", "center": "vcenter", "bottom": "bottom"}


class Document:
    """Wrapper around the XML tree of one ``.glabels`` file."""

    def __init__(self, tree: etree._ElementTree, object_ids: list[str] | None = None):
        self._tree = tree
        self._root = tree.getroot()
        if self._root.tag != "Glabels-document":
            raise XmlError(f"not a gLabels document but <{self._root.tag}>")
        self._limitations: list[Limitation] = []
        # Stable ids per object, so the editor finds them again after a save.
        # They are not in the file — that could confuse a desktop app — but in
        # our own storage.
        self._object_ids: list[str] = list(object_ids or [])
        self._check_version()

    # ------------------------------------------------------------- reading
    @classmethod
    def from_bytes(
        cls,
        data: bytes,
        *,
        max_uncompressed_bytes: int | None = None,
        object_ids: list[str] | None = None,
    ) -> "Document":
        if data[:2] == b"\x1f\x8b":
            data = cls._gunzip(data, max_uncompressed_bytes)
        try:
            root = etree.fromstring(data, parser=make_parser())
        except etree.XMLSyntaxError as exc:
            raise XmlError(f"XML could not be read: {exc}") from exc
        return cls(etree.ElementTree(root), object_ids)

    @staticmethod
    def _gunzip(data: bytes, limit: int | None) -> bytes:
        # The desktop app accepts gzip. Limit the decompressed size, so a small
        # file cannot claim unlimited memory.
        out = bytearray()
        with gzip.GzipFile(fileobj=__import__("io").BytesIO(data)) as fh:
            while True:
                chunk = fh.read(1 << 20)
                if not chunk:
                    break
                out += chunk
                if limit is not None and len(out) > limit:
                    raise XmlError("the decompressed file exceeds the allowed size")
        return bytes(out)

    def _check_version(self) -> None:
        version = self._root.get("version", "")
        if version != SUPPORTED_VERSION:
            self._limitations.append(
                Limitation(
                    code="document-version",
                    message=(
                        f"Document version {version or 'unknown'} is not supported; "
                        f"only version {SUPPORTED_VERSION} can be edited safely."
                    ),
                    params={"version": version or "?", "supported": SUPPORTED_VERSION},
                    blocks_editing=True,
                )
            )

    # --------------------------------------------------------- construction
    @classmethod
    def new_from_template(cls, template_element: etree._Element, *, rotate: bool = False) -> "Document":
        root = etree.Element("Glabels-document", version=SUPPORTED_VERSION)
        root.append(template_element)
        objects = etree.SubElement(root, "Objects")
        objects.set("id", "0")
        _set_bool(objects, "rotate", rotate)
        etree.SubElement(root, "Data")
        return cls(etree.ElementTree(root))

    # ------------------------------------------------------------- sections
    @property
    def root(self) -> etree._Element:
        return self._root

    @property
    def template_element(self) -> etree._Element:
        node = self._root.find("Template")
        if node is None:
            raise XmlError("document without a Template section")
        return node

    @property
    def objects_element(self) -> etree._Element:
        nodes = self._root.findall("Objects")
        if not nodes:
            raise XmlError("document without an Objects section")
        if len(nodes) > 1:
            self._limitations.append(
                Limitation(
                    code="multiple-objects-sections",
                    message=(
                        "This document has several Objects sections. Only the first is "
                        "editable; the others are kept unchanged."
                    ),
                    blocks_editing=True,
                )
            )
        return nodes[0]

    def _object_elements(self) -> Iterator[tuple[str, etree._Element]]:
        index = 0
        for child in self.objects_element:
            if not isinstance(child.tag, str):  # commentaar of PI
                continue
            if index < len(self._object_ids):
                yield self._object_ids[index], child
            else:
                yield f"o{index}", child
            index += 1

    def object_ids(self) -> list[str]:
        """The ids of the objects, in document order."""
        return [oid for oid, _ in self._object_elements()]

    def _mint_object_id(self, taken: set[str]) -> str:
        """An id not yet in use in this document."""
        highest = 0
        for existing in taken:
            if existing.startswith("o") and existing[1:].isdigit():
                highest = max(highest, int(existing[1:]))
        candidate = f"o{highest + 1}"
        while candidate in taken:
            highest += 1
            candidate = f"o{highest + 1}"
        return candidate

    # ----------------------------------------------------------- projection
    @property
    def rotate(self) -> bool:
        return _bool_attr(self.objects_element, "rotate", False)

    def embedded_files(self) -> list[EmbeddedFile]:
        files = []
        for data_node in self._root.findall("Data"):
            for node in data_node.findall("File"):
                raw = (node.text or "").strip()
                encoding = node.get("encoding", "base64")
                if encoding == "base64":
                    size = (len(raw) * 3) // 4
                else:
                    size = len(raw.encode("utf-8"))
                files.append(
                    EmbeddedFile(
                        name=node.get("name") or "",
                        mimetype=node.get("mimetype") or "image/png",
                        size_bytes=size,
                    )
                )
        return files

    def merge(self) -> MergeSpec | None:
        node = self._root.find("Merge")
        if node is None:
            return None
        merge_type = node.get("type") or "None"
        src = node.get("src")
        return MergeSpec(type=merge_type, src=src, available=False)

    def variables(self) -> list[VariableSpec]:
        node = self._root.find("Variables")
        if node is None:
            return []
        out = []
        for var in node.findall("Variable"):
            try:
                out.append(
                    VariableSpec(
                        type=var.get("type") or "string",  # type: ignore[arg-type]
                        name=var.get("name") or "",
                        value=var.get("value") or "",
                        increment=var.get("increment") or "never",  # type: ignore[arg-type]
                        step_size=var.get("stepSize") or "1",
                    )
                )
            except Exception as exc:
                log.warning("variable skipped: %s", exc)
        return out

    def content(self) -> DocumentContent:
        return DocumentContent(
            rotate=self.rotate,
            objects=[self._read_object(oid, el) for oid, el in self._object_elements()],
        )

    def limitations(self) -> list[Limitation]:
        """Limitations found while reading.

        Call after ``content()``/``merge()``, because those add to the list.
        """
        seen: dict[str, Limitation] = {}
        for item in self._limitations:
            seen.setdefault(item.code + item.message, item)
        return list(seen.values())

    def _read_object(self, oid: str, node: etree._Element) -> DocumentObject:
        kind = _TYPE_BY_TAG.get(str(node.tag))
        common = dict(
            id=oid,
            x_pt=_length_attr(node, "x", 0.0),
            y_pt=_length_attr(node, "y", 0.0),
            affine=_read_affine(node),
            shadow=_read_shadow(node),
        )
        if kind is None:
            self._limitations.append(
                Limitation(
                    code="unsupported-object",
                    message=(
                        f"Object type <{node.tag}> is not supported. It is kept "
                        "unchanged, but cannot be edited."
                    ),
                    params={"tag": str(node.tag)},
                    blocks_editing=True,
                )
            )
            return UnsupportedObject(
                **common, tag=str(node.tag), reason="object type unknown to this version"
            )

        size = dict(
            w_pt=_length_attr(node, "w", 0.0),
            h_pt=_length_attr(node, "h", 0.0),
            lock_aspect_ratio=_bool_attr(node, "lock_aspect_ratio", False),
        )

        if kind == "text":
            return TextObject(
                **common,
                **size,
                lines=[p.text or "" for p in node.findall("p")],
                font_family=node.get("font_family") or "Sans",
                font_size=_float_attr(node, "font_size", 10.0),
                font_weight="bold" if (node.get("font_weight") == "bold") else "normal",
                font_italic=_bool_attr(node, "font_italic"),
                font_underline=_bool_attr(node, "font_underline"),
                color=_read_color(node, "color", "color_field"),
                line_spacing=_float_attr(node, "line_spacing", 1.0),
                align=_H_ALIGN_READ.get(node.get("align") or "", "left"),  # type: ignore[arg-type]
                valign=_V_ALIGN_READ.get(node.get("valign") or "", "top"),  # type: ignore[arg-type]
                wrap=node.get("wrap") or "word",  # type: ignore[arg-type]
                auto_shrink=_bool_attr(node, "auto_shrink"),
            )

        if kind in ("box", "ellipse"):
            cls = BoxObject if kind == "box" else EllipseObject
            return cls(
                **common,
                **size,
                line_width_pt=_length_attr(node, "line_width", 1.0),
                line_color=_read_color(node, "line_color", "line_color_field"),
                fill_color=_read_color(node, "fill_color", "fill_color_field"),
            )

        if kind == "line":
            return LineObject(
                **common,
                dx_pt=_length_attr(node, "dx", 0.0),
                dy_pt=_length_attr(node, "dy", 0.0),
                line_width_pt=_length_attr(node, "line_width", 1.0),
                line_color=_read_color(node, "line_color", "line_color_field"),
            )

        if kind == "image":
            src = node.get("src")
            embedded_names = {f.name for f in self.embedded_files()}
            if src and src not in embedded_names:
                self._limitations.append(
                    Limitation(
                        code="image-source-external",
                        message=(
                            f"The image {src!r} is not embedded in this document. "
                            "Attach the file again through an upload to print it."
                        ),
                        params={"src": src},
                    )
                )
            return ImageObject(
                **common,
                **size,
                src=src,
                src_field=node.get("src_field"),
                embedded=bool(src and src in embedded_names),
            )

        return BarcodeObject(
            **common,
            **size,
            backend=node.get("backend") or "",
            style=node.get("style") or "code128",
            show_text=_bool_attr(node, "text", True),
            checksum=_bool_attr(node, "checksum", True),
            data=node.get("data") or "",
            color=_read_color(node, "color", "color_field"),
        )

    # --------------------------------------------------------------- editing
    def apply_content(self, content: DocumentContent) -> None:
        """Update the XML from the editor's projection.

        Objects with a known id are changed in place, so unknown attributes
        are kept. Objects that no longer appear in the list are removed.
        """
        objects_el = self.objects_element
        _set_bool(objects_el, "rotate", content.rotate)

        existing = dict(self._object_elements())
        taken = set(existing)
        ordered: list[etree._Element] = []
        new_ids: list[str] = []

        for obj in content.objects:
            # Each existing element may be claimed only once; if an id appears
            # twice, the second one is a new object.
            node = existing.pop(obj.id or "", None)
            if obj.type == "unsupported":
                if node is None:
                    raise XmlError("an unsupported object cannot be created again")
                ordered.append(node)
                new_ids.append(obj.id or "")
                continue
            if node is None or _TYPE_BY_TAG.get(str(node.tag)) != obj.type:
                node = etree.Element(_TAG_BY_TYPE[obj.type])
                objects_el.append(node)
                # A new object gets an id of its own. The editor's id cannot be
                # reused: it was made up on the spot and could clash with a
                # later object.
                minted = self._mint_object_id(taken)
                taken.add(minted)
                new_ids.append(minted)
            else:
                new_ids.append(obj.id or "")
            self._write_object(node, obj)
            ordered.append(node)

        keep = {id(node) for node in ordered}
        for node in list(objects_el):
            if isinstance(node.tag, str) and id(node) not in keep:
                objects_el.remove(node)
        for node in ordered:  # reorder; append moves an existing element
            objects_el.append(node)

        self._object_ids = new_ids

    def _write_object(self, node: etree._Element, obj: DocumentObject) -> None:
        node.set("x", format_length(obj.x_pt))
        node.set("y", format_length(obj.y_pt))
        _write_affine(node, obj.affine)

        if obj.type != "barcode":
            _write_shadow(node, obj.shadow)

        if obj.type in ("text", "box", "ellipse", "image", "barcode"):
            node.set("w", format_length(obj.w_pt))  # type: ignore[union-attr]
            node.set("h", format_length(obj.h_pt))  # type: ignore[union-attr]
            _set_bool(node, "lock_aspect_ratio", obj.lock_aspect_ratio)  # type: ignore[union-attr]

        if obj.type == "text":
            _write_color(node, "color", "color_field", obj.color)
            node.set("font_family", obj.font_family)
            node.set("font_size", format_number(obj.font_size))
            node.set("font_weight", obj.font_weight)
            _set_bool(node, "font_italic", obj.font_italic)
            _set_bool(node, "font_underline", obj.font_underline)
            node.set("align", _H_ALIGN_WRITE[obj.align])
            node.set("valign", _V_ALIGN_WRITE[obj.valign])
            node.set("wrap", obj.wrap)
            node.set("line_spacing", format_number(obj.line_spacing))
            _set_bool(node, "auto_shrink", obj.auto_shrink)
            for p in node.findall("p"):
                node.remove(p)
            for line in obj.lines:
                etree.SubElement(node, "p").text = line

        elif obj.type in ("box", "ellipse"):
            node.set("line_width", format_length(obj.line_width_pt))
            _write_color(node, "line_color", "line_color_field", obj.line_color)
            _write_color(node, "fill_color", "fill_color_field", obj.fill_color)

        elif obj.type == "line":
            node.set("dx", format_length(obj.dx_pt))
            node.set("dy", format_length(obj.dy_pt))
            node.set("line_width", format_length(obj.line_width_pt))
            _write_color(node, "line_color", "line_color_field", obj.line_color)

        elif obj.type == "image":
            if obj.src_field:
                node.set("src_field", obj.src_field)
                node.attrib.pop("src", None)
            elif obj.src:
                node.set("src", obj.src)
                node.attrib.pop("src_field", None)

        elif obj.type == "barcode":
            node.set("backend", obj.backend)
            node.set("style", obj.style)
            _set_bool(node, "text", obj.show_text)
            _set_bool(node, "checksum", obj.checksum)
            node.set("data", obj.data)
            _write_color(node, "color", "color_field", obj.color)

    def add_embedded_file(self, name: str, mimetype: str, payload: bytes) -> None:
        data_node = self._root.find("Data")
        if data_node is None:
            data_node = etree.SubElement(self._root, "Data")
        for node in data_node.findall("File"):
            if node.get("name") == name:
                data_node.remove(node)
        node = etree.SubElement(data_node, "File")
        node.set("name", name)
        node.set("mimetype", mimetype)
        node.set("encoding", "base64")
        node.text = base64.b64encode(payload).decode("ascii")

    def get_embedded_file(self, name: str) -> tuple[str, bytes] | None:
        for data_node in self._root.findall("Data"):
            for node in data_node.findall("File"):
                if node.get("name") != name:
                    continue
                raw = (node.text or "").strip()
                if node.get("encoding", "base64") == "base64":
                    return node.get("mimetype") or "image/png", base64.b64decode(raw)
                return node.get("mimetype") or "image/png", raw.encode("utf-8")
        return None

    # ---------------------------------------------------------------- merging
    def set_merge(self, merge_type: str, src: str | None) -> None:
        """Set or remove the ``<Merge>`` section.

        The DTD prescribes the order: Template, Objects+, Merge?, Variables?,
        Data*. So we place the element right after the last Objects section.
        ``src`` is relative to the folder of the document file, the way the
        desktop app writes it and looks for it.
        """
        existing = self._root.find("Merge")

        if merge_type in ("", "None") and not src:
            if existing is not None:
                self._root.remove(existing)
            return

        node = existing
        if node is None:
            node = etree.Element("Merge")
            objects = self._root.findall("Objects")
            if objects:
                last = objects[-1]
                last.addnext(node)
            else:
                self._root.append(node)

        node.set("type", merge_type)
        if src:
            node.set("src", src)
        else:
            node.attrib.pop("src", None)

    # --------------------------------------------------------------- checks
    def validate_for_render(self) -> None:
        """Check whether the document can safely be given to the batch renderer.

        The upstream renderer crashes (SIGSEGV) on a document without a
        Template section. We stop such documents here, with an understandable
        message instead of a crashed process.
        """
        if self._root.find("Template") is None:
            raise XmlError("the document has no Template section and cannot be printed")
        if self._root.find("Objects") is None:
            raise XmlError("the document has no Objects section and cannot be printed")

    # ------------------------------------------------------------- serialising
    def to_bytes(self) -> bytes:
        """Write the document the way the desktop app does: plain XML, indent 2."""
        copy = etree.ElementTree(etree.fromstring(etree.tostring(self._root), parser=make_parser()))
        etree.indent(copy, space="  ")
        body = etree.tostring(copy, encoding="utf-8", xml_declaration=False)
        return b'<?xml version="1.0"?>\n' + body + b"\n"
