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


def read_names(data: bytes) -> FontNames:
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
    name_offset = name_length = None
    for index in range(num_tables):
        record = offset + 12 + index * 16
        if len(data) < record + 16:
            raise FontError("incomplete table directory")
        table_tag, _checksum, table_offset, table_length = struct.unpack_from(">4sIII", data, record)
        if table_tag == b"name":
            name_offset, name_length = table_offset, table_length
            break

    if name_offset is None or name_length is None or len(data) < name_offset + 6:
        raise FontError("font without a name table")

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
