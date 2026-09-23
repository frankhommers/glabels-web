"""Read names from a TrueType or OpenType file.

We read the family name straight from the ``name`` table. That tells us under
which name a user can pick the font in a label, and under which name the
renderer finds it again through fontconfig.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

# Accepted sfnt versions: TrueType, the old Apple variant and CFF/OpenType.
_SFNT_VERSIONS = {b"\x00\x01\x00\x00", b"true", b"OTTO"}
_COLLECTION = b"ttcf"

NAME_FAMILY = 1
NAME_SUBFAMILY = 2
NAME_FULL = 4
NAME_TYPOGRAPHIC_FAMILY = 16
NAME_TYPOGRAPHIC_SUBFAMILY = 17


class FontError(ValueError):
    """The file is not a usable TrueType/OpenType font."""


@dataclass(frozen=True)
class FontNames:
    family: str
    subfamily: str
    full_name: str


def _decode(raw: bytes, platform_id: int, encoding_id: int) -> str | None:
    try:
        if platform_id == 3 and encoding_id in (0, 1, 10):
            return raw.decode("utf-16-be")
        if platform_id == 0:
            return raw.decode("utf-16-be")
        if platform_id == 1:
            return raw.decode("mac-roman")
    except UnicodeDecodeError:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _tables(data: bytes) -> dict[bytes, tuple[int, int]]:
    """Offset and length of each table of the (first) font in the file."""
    if len(data) < 12:
        raise FontError("file too small for a font")

    tag = data[:4]
    if tag == _COLLECTION:
        # For a collection we take the first font; splitting several fonts
        # out of one file is not done (yet).
        count = struct.unpack_from(">I", data, 8)[0]
        if count == 0:
            raise FontError("empty font collection")
        offset = struct.unpack_from(">I", data, 12)[0]
    elif tag in _SFNT_VERSIONS:
        offset = 0
    else:
        raise FontError("unknown file format; expected TTF, OTF or TTC")

    if len(data) < offset + 12:
        raise FontError("incomplete font file")

    num_tables = struct.unpack_from(">H", data, offset + 4)[0]
    tables: dict[bytes, tuple[int, int]] = {}
    for index in range(num_tables):
        record = offset + 12 + index * 16
        if len(data) < record + 16:
            raise FontError("incomplete table directory")
        table_tag, _checksum, table_offset, table_length = struct.unpack_from(">4sIII", data, record)
        if len(data) >= table_offset + table_length:
            tables[table_tag] = (table_offset, table_length)
    return tables


def read_names(data: bytes) -> FontNames:
    name = _tables(data).get(b"name")
    if name is None or len(data) < name[0] + 6:
        raise FontError("font without a name table")
    name_offset = name[0]

    count, string_offset = struct.unpack_from(">HH", data, name_offset + 2)
    found: dict[int, str] = {}
    for index in range(count):
        record = name_offset + 6 + index * 12
        if len(data) < record + 12:
            break
        platform_id, encoding_id, _language_id, name_id, length, value_offset = struct.unpack_from(
            ">HHHHHH", data, record
        )
        start = name_offset + string_offset + value_offset
        raw = data[start : start + length]
        if len(raw) != length:
            continue
        value = _decode(raw, platform_id, encoding_id)
        if not value:
            continue
        # Windows names (platform 3) win; they are the most reliable.
        if name_id not in found or platform_id == 3:
            found[name_id] = value.strip()

    family = found.get(NAME_TYPOGRAPHIC_FAMILY) or found.get(NAME_FAMILY)
    if not family:
        raise FontError("font without a family name")

    subfamily = found.get(NAME_TYPOGRAPHIC_SUBFAMILY) or found.get(NAME_SUBFAMILY) or "Regular"
    full_name = found.get(NAME_FULL) or f"{family} {subfamily}".strip()
    return FontNames(family=family, subfamily=subfamily, full_name=full_name)


@dataclass(frozen=True)
class FontMetrics:
    """Vertical metrics in font units, as the renderer's text layout uses them.

    The editor places text with these, so a line sits where gLabels puts it:
    the first baseline one ascent below the top, lines one line spacing apart.
    """

    units_per_em: int
    ascender: int
    descender: int  # negative: below the baseline
    line_gap: int


# OS/2 fsSelection bit 7: the typographic metrics are the ones to use.
_USE_TYPO_METRICS = 1 << 7


def read_metrics(data: bytes) -> FontMetrics | None:
    """The vertical metrics, or None when the tables are missing or odd."""
    tables = _tables(data)
    head, hhea, os2 = tables.get(b"head"), tables.get(b"hhea"), tables.get(b"OS/2")
    if head is None or hhea is None or head[1] < 20 or hhea[1] < 12:
        return None
    units_per_em = struct.unpack_from(">H", data, head[0] + 18)[0]
    if not 16 <= units_per_em <= 16384:
        return None
    ascender, descender, line_gap = struct.unpack_from(">hhh", data, hhea[0] + 4)

    if os2 is not None and os2[1] >= 78:
        fs_selection = struct.unpack_from(">H", data, os2[0] + 62)[0]
        typo_ascender, typo_descender, typo_gap = struct.unpack_from(">hhh", data, os2[0] + 68)
        win_ascent, win_descent = struct.unpack_from(">HH", data, os2[0] + 74)
        if fs_selection & _USE_TYPO_METRICS and typo_ascender:
            ascender, descender, line_gap = typo_ascender, typo_descender, typo_gap
        elif ascender == 0 and descender == 0:
            # FreeType falls back like this when hhea says nothing.
            if typo_ascender or typo_descender:
                ascender, descender, line_gap = typo_ascender, typo_descender, typo_gap
            else:
                ascender, descender, line_gap = win_ascent, -win_descent, 0

    if ascender <= 0:
        return None
    return FontMetrics(units_per_em, ascender, -abs(descender), max(0, line_gap))
