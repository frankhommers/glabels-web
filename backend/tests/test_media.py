"""Which of the printer's media sizes matches a PDF page."""

import pytest

from glabels_web.printing.media import choose_media, fits, media_ranges, parse_media

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



# What a DYMO LabelWriter 450 DUO reports for its tape side, and a colour
# office printer: both give a range besides fixed sizes.
DUO_TAPE = [
    "custom_9.03x88.9mm_9.03x88.9mm",
    "custom_12.14x50.8mm_12.14x50.8mm",
    "custom_12.14x1411.11mm_12.14x1411.11mm",
    "custom_min_1.41x5.64mm",
    "custom_max_18.06x1411.11mm",
]
OFFICE = ["iso_a4_210x297mm", "na_letter_8.5x11in", "custom_min_3x5in", "custom_max_8.5x14in"]


def test_range_ends_are_no_sizes_of_their_own():
    # 1.41 × 5.64 mm is where the range starts, not a label.
    assert choose_media(DUO_TAPE, (1.41 * MM, 5.64 * MM)) == "custom_1.41x5.64mm_1.41x5.64mm"
    assert parse_media("custom_min_3x5in").width_mm == pytest.approx(76.2)


def test_a_tape_of_any_length_gets_a_size_in_the_range():
    # 9 mm tape, 67.4 mm long: no fixed size, but inside the range.
    assert choose_media(DUO_TAPE, (26.0, 191.0)) == "custom_9.17x67.38mm_9.17x67.38mm"
    # A fixed size still wins when there is one.
    assert choose_media(DUO_TAPE, (12 * MM, 50.5 * MM)) == "custom_12.14x50.8mm_12.14x50.8mm"


def test_a_range_in_the_other_orientation():
    assert choose_media(DUO_TAPE, (67.4 * MM, 9.2 * MM)) == "custom_9.2x67.4mm_9.2x67.4mm"


def test_too_small_for_the_office_printer():
    assert choose_media(OFFICE, (62 * MM, 100 * MM)) is None
    assert choose_media(OFFICE, (100 * MM, 150 * MM)) == "custom_100x150mm_100x150mm"


def test_only_a_complete_range_counts():
    assert media_ranges(["custom_min_3x5in"]) == []
    assert len(media_ranges(OFFICE)) == 1
    assert len(media_ranges(["roll_min_10x10mm", "roll_max_60x3000mm", *OFFICE])) == 2


@pytest.mark.parametrize(
    ("supported", "page_mm", "continuous", "takes", "expected"),
    [
        (DUO_TAPE, (9, 67), True, "auto", True),
        (DYMO, (9, 67), True, "auto", False),  # a label printer has no tape
        (DUO_TAPE, (28, 89), False, "auto", False),  # nor a tape printer address labels
        (OFFICE, (210, 297), False, "auto", True),
        ([], (28, 89), False, "auto", None),  # nothing reported: we cannot tell
        ([], (9, 67), True, "continuous", True),
        (DUO_TAPE, (28, 89), False, "continuous", False),
        (DYMO, (9, 67), True, "fixed", False),
        (DYMO, (9, 67), False, "fixed", True),
        (DYMO, (500, 500), False, "any", True),
    ],
)
def test_fits(supported, page_mm, continuous, takes, expected):
    page = (page_mm[0] * MM, page_mm[1] * MM)
    assert fits(supported, page, continuous=continuous, takes=takes) is expected
