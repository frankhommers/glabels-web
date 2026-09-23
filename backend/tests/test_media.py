"""Which of the printer's media sizes matches a PDF page."""

import pytest

from glabels_web.printing.media import choose_media, parse_media

MM = 72 / 25.4

# Part of what a DYMO LabelWriter 450 reports through CUPS.
DYMO = [
    "custom_54.19x22.27mm_54.19x22.27mm",
    "custom_25.4x54.02mm_25.4x54.02mm",
    "custom_1x1in_1x1in",
    "custom_41.32x88.9mm_41.32x88.9mm",
    "custom_27.86x88.9mm_27.86x88.9mm",
    "custom_58.67x88.9mm_58.67x88.9mm",
    "custom_58.76x101.6mm_58.76x101.6mm",
    "custom_28.62x87.29mm_28.62x87.29mm",
    "custom_35.73x88.56mm_35.73x88.56mm",
]


def test_reads_pwg_names():
    assert parse_media("custom_27.86x88.9mm_27.86x88.9mm").width_mm == pytest.approx(27.86)
    letter = parse_media("na_letter_8.5x11in")
    assert (letter.width_mm, letter.height_mm) == pytest.approx((215.9, 279.4))
    assert parse_media("iso_a4_210x297mm").height_mm == pytest.approx(297)
    assert parse_media("roll_max") is None


def test_dymo_address_label_gets_its_own_size():
    # Dymo 30252: 28 × 89 mm. The printer defaults to 58.76 × 101.6 mm;
    # without media the server scaled the label up to that.
    assert choose_media(DYMO, (28 * MM, 89 * MM)) == "custom_27.86x88.9mm_27.86x88.9mm"


def test_other_orientation_counts_too():
    assert choose_media(DYMO, (89 * MM, 28 * MM)) == "custom_27.86x88.9mm_27.86x88.9mm"


def test_nothing_matching_gives_none():
    assert choose_media(DYMO, (210 * MM, 297 * MM)) is None
    assert choose_media([], (28 * MM, 89 * MM)) is None
    assert choose_media(["nonsense", "roll_max"], (28 * MM, 89 * MM)) is None


def test_a4_sheet():
    media = ["na_letter_8.5x11in", "iso_a4_210x297mm", "iso_a5_148x210mm"]
    assert choose_media(media, (595.28, 841.89)) == "iso_a4_210x297mm"
    assert choose_media(media, (612, 792)) == "na_letter_8.5x11in"
