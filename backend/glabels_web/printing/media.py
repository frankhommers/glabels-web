"""Choose the printer's media size that matches a PDF page.

Without `media` in the job, the print server prints on its default size and
scales the page to it. For a label printer that is nearly always wrong: a
Dymo defaulting to a shipping label blows an address label up to twice its
size, and the narrow label on the roll loses half of it. So we send the size
the printer itself reports that is closest to the page.

Media sizes follow the PWG names from PWG 5101.1 (`class_name_WxHunit`), for
example `custom_27.86x88.9mm_27.86x88.9mm` or `na_letter_8.5x11in`. Besides
fixed sizes a printer can report a range it accepts any size within, as a
pair `custom_min_WxHunit` / `custom_max_WxHunit` (or `roll_min_` /
`roll_max_`). A tape printer reports its tapes that way; an office printer
its manual feed.

The same choice tells whether a label fits a printer at all: a label no
size or range matches comes out scaled or cut off.
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
_RANGE = re.compile(r"^(custom|roll)_(min|max)_")

# What a printer takes, when what it reports cannot be trusted:
#   auto        go by the sizes the printer reports
#   continuous  only labels on a continuous roll (tape)
#   fixed       only labels of a fixed size and sheets
#   any         everything; the printer sorts it out
TAKES = ("auto", "continuous", "fixed", "any")


@dataclass(frozen=True)
class MediaSize:
    keyword: str
    width_mm: float
    height_mm: float


@dataclass(frozen=True)
class MediaRange:
    min_mm: tuple[float, float]
    max_mm: tuple[float, float]

    def holds(self, width_mm: float, height_mm: float) -> bool:
        return (
            self.min_mm[0] - TOLERANCE_MM <= width_mm <= self.max_mm[0] + TOLERANCE_MM
            and self.min_mm[1] - TOLERANCE_MM <= height_mm <= self.max_mm[1] + TOLERANCE_MM
        )


def parse_media(keyword: str) -> MediaSize | None:
    """Read the size from a PWG media name; `None` if it has none."""
    for part in reversed(keyword.split("_")):
        match = _SIZE.fullmatch(part)
        if match:
            factor = 25.4 if match.group(3) == "in" else 1.0
            return MediaSize(keyword, float(match.group(1)) * factor, float(match.group(2)) * factor)
    return None


def media_ranges(supported: list[str]) -> list[MediaRange]:
    """The ranges a printer accepts any size within."""
    ends: dict[str, dict[str, MediaSize]] = {}
    for keyword in supported:
        match = _RANGE.match(keyword)
        size = parse_media(keyword) if match else None
        if match and size:
            ends.setdefault(match.group(1), {})[match.group(2)] = size
    return [
        MediaRange((pair["min"].width_mm, pair["min"].height_mm), (pair["max"].width_mm, pair["max"].height_mm))
        for pair in ends.values()
        if "min" in pair and "max" in pair
    ]


def _number(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def custom_media(width_mm: float, height_mm: float) -> str:
    """The PWG name of a size of our own, within a printer's range."""
    size = f"{_number(width_mm)}x{_number(height_mm)}mm"
    return f"custom_{size}_{size}"


def choose_media(supported: list[str], page_pt: tuple[float, float]) -> str | None:
    """The supported size that best matches the page, or `None`.

    A fixed size comes first. Otherwise a range the page fits in gives a size
    of its own. A size in the other orientation counts too: label printers do
    not always describe their labels in the same orientation as the product
    definition.
    """
    width_mm, height_mm = (value / POINTS_PER_MM for value in page_pt)
    if width_mm <= 0 or height_mm <= 0:
        return None
    turns = ((width_mm, height_mm), (height_mm, width_mm))

    best: tuple[float, str] | None = None
    for keyword in supported:
        size = None if _RANGE.match(keyword) else parse_media(keyword)
        if size is None:
            continue
        for w, h in ((size.width_mm, size.height_mm), (size.height_mm, size.width_mm)):
            error = max(abs(w - width_mm), abs(h - height_mm))
            if error <= TOLERANCE_MM and (best is None or error < best[0]):
                best = (error, keyword)
    if best:
        return best[1]

    for media_range in media_ranges(supported):
        for w, h in turns:
            if media_range.holds(w, h):
                return custom_media(w, h)
    return None


def fits(supported: list[str], page_pt: tuple[float, float], *, continuous: bool, takes: str = "auto") -> bool | None:
    """Can this printer print the page as it is? `None`: we cannot tell,
    because the printer reported no sizes."""
    if takes == "any":
        return True
    if takes == "continuous":
        return continuous
    if takes == "fixed":
        return not continuous
    if not supported:
        return None
    return choose_media(supported, page_pt) is not None
