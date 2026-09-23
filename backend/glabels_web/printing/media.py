"""Choose the printer's media size that matches a PDF page.

Without `media` in the job, the print server prints on its default size and
scales the page to it. For a label printer that is nearly always wrong: a
Dymo defaulting to a shipping label blows an address label up to twice its
size, and the narrow label on the roll loses half of it. So we send the size
the printer itself reports that is closest to the page.

Media sizes follow the PWG names from PWG 5101.1 (`class_name_WxHunit`), for
example `custom_27.86x88.9mm_27.86x88.9mm` or `na_letter_8.5x11in`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

POINTS_PER_MM = 72 / 25.4

# How far a size may differ from the page. Label makers and printer drivers
# round differently (28 mm versus 27.86 mm), but the next size in a range is
# usually a few mm away.
TOLERANCE_MM = 1.5

_SIZE = re.compile(r"(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|in)$")


@dataclass(frozen=True)
class MediaSize:
    keyword: str
    width_mm: float
    height_mm: float


def parse_media(keyword: str) -> MediaSize | None:
    """Read the size from a PWG media name; `None` if it has none."""
    for part in reversed(keyword.split("_")):
        match = _SIZE.fullmatch(part)
        if match:
            factor = 25.4 if match.group(3) == "in" else 1.0
            return MediaSize(keyword, float(match.group(1)) * factor, float(match.group(2)) * factor)
    return None


def choose_media(supported: list[str], page_pt: tuple[float, float]) -> str | None:
    """The supported size that best matches the page, or `None`.

    A size in the other orientation counts too: label printers do not always
    describe their labels in the same orientation as the product definition.
    """
    width_mm, height_mm = (value / POINTS_PER_MM for value in page_pt)
    if width_mm <= 0 or height_mm <= 0:
        return None

    best: tuple[float, str] | None = None
    for keyword in supported:
        size = parse_media(keyword)
        if size is None:
            continue
        for w, h in ((size.width_mm, size.height_mm), (size.height_mm, size.width_mm)):
            error = max(abs(w - width_mm), abs(h - height_mm))
            if error <= TOLERANCE_MM and (best is None or error < best[0]):
                best = (error, keyword)
    return best[1] if best else None
