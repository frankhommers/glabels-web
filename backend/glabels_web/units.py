"""Length units, identical to upstream ``model/Units``.

Internally everything is in points: 72 pt = 1 inch. The desktop app writes
lengths as ``<number><unit>`` without a space, using ``QString::number``
(format 'g', 6 significant digits). We follow that format exactly, so written
files do not needlessly differ from desktop output.
"""

from __future__ import annotations

import re

PT_PER_UNIT: dict[str, float] = {
    "pt": 1.0,
    "in": 72.0,
    "mm": 72.0 / 25.4,
    "cm": 72.0 / 2.54,
    "pc": 12.0,
}

_LENGTH_RE = re.compile(r"^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$")


class UnitError(ValueError):
    """Unknown unit or unreadable length."""


def parse_length(value: str, *, default_units: str = "pt") -> float:
    """Convert a length attribute to points."""
    match = _LENGTH_RE.match(value)
    if not match:
        raise UnitError(f"unreadable length: {value!r}")
    number, units = match.group(1), match.group(2) or default_units
    if units not in PT_PER_UNIT:
        raise UnitError(f"unknown unit: {units!r}")
    return float(number) * PT_PER_UNIT[units]


def format_number(value: float) -> str:
    """Same text form as ``QString::number(double)``."""
    text = f"{value:.6g}"
    # Qt writes 'e-17'; Python may give the exponent with at least two digits.
    return re.sub(r"e([+-])0(\d\d+)", r"e\1\2", text.replace("e-0", "e-").replace("e+0", "e+"))


def format_length(points: float, units: str = "pt") -> str:
    if units not in PT_PER_UNIT:
        raise UnitError(f"unknown unit: {units!r}")
    return format_number(points / PT_PER_UNIT[units]) + units


def to_units(points: float, units: str) -> float:
    if units not in PT_PER_UNIT:
        raise UnitError(f"unknown unit: {units!r}")
    return points / PT_PER_UNIT[units]
