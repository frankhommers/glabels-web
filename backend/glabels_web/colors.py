"""gLabels colour attributes.

Upstream stores colours as a 32-bit integer in RGBA order (``ColorNode``:
``r = rgba >> 24``), written as ``0x`` plus hexadecimal without leading zeros,
so ``0xff`` is opaque black.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Rgba:
    r: int
    g: int
    b: int
    a: int = 255

    @classmethod
    def from_uint(cls, value: int) -> "Rgba":
        value &= 0xFFFFFFFF
        return cls((value >> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF)

    @classmethod
    def from_attr(cls, text: str) -> "Rgba":
        return cls.from_uint(int(text, 0))

    @classmethod
    def from_css(cls, text: str) -> "Rgba":
        """``#rrggbb`` or ``#rrggbbaa``."""
        raw = text.lstrip("#")
        if len(raw) == 6:
            raw += "ff"
        if len(raw) != 8:
            raise ValueError(f"unreadable colour: {text!r}")
        return cls(int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16), int(raw[6:8], 16))

    def to_uint(self) -> int:
        return (self.r << 24) | (self.g << 16) | (self.b << 8) | self.a

    def to_attr(self) -> str:
        return "0x" + format(self.to_uint(), "x")

    def to_css(self) -> str:
        return "#%02x%02x%02x%02x" % (self.r, self.g, self.b, self.a)
