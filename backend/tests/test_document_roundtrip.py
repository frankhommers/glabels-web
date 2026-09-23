"""Round trip: desktop file -> projection -> file, without semantic loss."""

from __future__ import annotations

import math

import pytest
from lxml import etree

from glabels_web.documents import Document
from glabels_web.units import parse_length

FIXTURE_NAMES = [
    "simple-text-liberation-sans.glabels",
    "simple-text-liberation-serif.glabels",
    "simple-shapes.glabels",
    "simple-code39.glabels",
    "unknown-extras.glabels",
]

# Attributes holding a length; we compare them numerically in points.
_LENGTH_ATTRS = {
    "x", "y", "w", "h", "dx", "dy", "x0", "y0", "width", "height", "round",
    "waste", "x_waste", "y_waste", "size", "x_size", "y_size", "line_width",
    "shadow_x", "shadow_y", "radius", "hole", "min_height", "max_height",
    "default_height", "roll_width",
}
_NUMERIC_ATTRS = {"a0", "a1", "a2", "a3", "a4", "a5", "font_size", "line_spacing", "shadow_opacity"}
_COLOR_ATTRS = {"color", "line_color", "fill_color", "shadow_color"}
_BOOL_ATTRS = {
    "rotate", "lock_aspect_ratio", "shadow", "font_italic", "font_underline",
    "auto_shrink", "text", "checksum",
}


def _normalize(value: str, name: str):
    if name in _LENGTH_ATTRS:
        try:
            return ("length", round(parse_length(value), 6))
        except ValueError:
            return ("raw", value)
    if name in _NUMERIC_ATTRS:
        try:
            number = float(value)
        except ValueError:
            return ("raw", value)
        # Tiny leftovers from rounding are semantically zero.
        return ("number", 0.0 if math.isclose(number, 0.0, abs_tol=1e-12) else round(number, 6))
    if name in _COLOR_ATTRS:
        return ("color", int(value, 0))
    if name in _BOOL_ATTRS:
        return ("bool", value.strip().lower() in ("true", "1"))
    return ("raw", value)


def _semantic(node: etree._Element):
    return (
        str(node.tag),
        {str(k): _normalize(v, str(k)) for k, v in node.attrib.items()},
        (node.text or "").strip(),
        [_semantic(child) for child in node if isinstance(child.tag, str)],
    )


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_round_trip_keeps_content(fixtures_dir, name):
    original = (fixtures_dir / name).read_bytes()
    doc = Document.from_bytes(original)

    # Read and write back unchanged, exactly as the editor would.
    doc.apply_content(doc.content())
    written = doc.to_bytes()

    before = _semantic(etree.fromstring(original))
    after = _semantic(etree.fromstring(written))
    assert before == after


def test_unknown_things_are_kept(fixtures_dir):
    doc = Document.from_bytes((fixtures_dir / "unknown-extras.glabels").read_bytes())
    content = doc.content()

    types = [obj.type for obj in content.objects]
    assert types == ["text", "unsupported"]

    # Edit the text object; the unknown object is left alone.
    content.objects[0].lines = ["Changed"]
    doc.apply_content(content)
    written = doc.to_bytes().decode("utf-8")

    assert "future_attribute=\"keep-me\"" in written
    assert "<Object-future" in written
    assert "do not touch" in written
    assert "<Future-section" in written
    assert "<p>Changed</p>" in written


def test_unsupported_object_reports_limitation(fixtures_dir):
    doc = Document.from_bytes((fixtures_dir / "unknown-extras.glabels").read_bytes())
    doc.content()
    codes = {limit.code for limit in doc.limitations()}
    assert "unsupported-object" in codes
    assert any(limit.blocks_editing for limit in doc.limitations())


def test_gzip_document_is_read(fixtures_dir):
    import gzip

    raw = (fixtures_dir / "simple-shapes.glabels").read_bytes()
    doc = Document.from_bytes(gzip.compress(raw))
    assert len(doc.content().objects) == 3


def test_gzip_bomb_is_limited(fixtures_dir):
    import gzip

    from glabels_web.xml_safe import XmlError

    raw = (fixtures_dir / "simple-shapes.glabels").read_bytes()
    with pytest.raises(XmlError):
        Document.from_bytes(gzip.compress(raw), max_uncompressed_bytes=10)


def test_external_entities_are_refused():
    from glabels_web.xml_safe import XmlError

    malicious = b"""<?xml version="1.0"?>
    <!DOCTYPE Glabels-document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
    <Glabels-document version="4.0"><Objects id="0" rotate="false">
    <Object-text x="0pt" y="0pt" w="1pt" h="1pt" align="left" valign="top"><p>&xxe;</p></Object-text>
    </Objects></Glabels-document>"""
    try:
        doc = Document.from_bytes(malicious)
    except XmlError:
        return  # fine too: the parser refuses the document
    lines = doc.content().objects[0].lines
    assert lines == [""] or "root:" not in "".join(lines)


@pytest.mark.parametrize(
    ("align", "valign", "expected"),
    [
        ("hcenter", "vcenter", ("center", "center")),
        ("right", "bottom", ("right", "bottom")),
        # Earlier versions of this application wrote it like this; read it too.
        ("center", "center", ("center", "center")),
        ("nonsense", "", ("left", "top")),
    ],
)
def test_alignment_like_gLabels_Qt(align, valign, expected):
    """gLabels writes "hcenter"/"vcenter"; the renderer does not know "center".

    Upstream reads unknown values as left/top, so centred text ended up top
    left in the print while the editor drew it in the middle.
    """
    raw = f"""<?xml version="1.0"?>
    <Glabels-document version="4.0"><Objects id="0" rotate="false">
    <Object-text x="0pt" y="0pt" w="10pt" h="10pt" align="{align}" valign="{valign}"><p>x</p></Object-text>
    </Objects></Glabels-document>""".encode()
    doc = Document.from_bytes(raw)
    content = doc.content()
    text_object = content.objects[0]
    assert (text_object.align, text_object.valign) == expected

    doc.apply_content(content)
    node = etree.fromstring(doc.to_bytes()).find(".//Object-text")
    written = {"left": "left", "center": "hcenter", "right": "right"}[expected[0]]
    assert node.get("align") == written
    assert node.get("valign") == {"top": "top", "center": "vcenter", "bottom": "bottom"}[expected[1]]
