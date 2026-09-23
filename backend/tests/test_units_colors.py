from glabels_web.colors import Rgba
from glabels_web.units import format_length, format_number, parse_length


def test_length_units_to_points():
    assert parse_length("72pt") == 72
    assert parse_length("1in") == 72
    assert parse_length("8.5 in") == 612
    assert round(parse_length("25.4mm"), 9) == 72
    assert round(parse_length("2.54cm"), 9) == 72
    assert parse_length("1pc") == 12
    # Without a unit it is points, just like upstream.
    assert parse_length("10") == 10


def test_writing_lengths_follows_qt_notation():
    assert format_length(254.636) == "254.636pt"
    assert format_length(0) == "0pt"
    assert format_number(-9.59164e-17) == "-9.59164e-17"
    # Six significant digits, like QString::number.
    assert format_number(1 / 3) == "0.333333"


def test_colour_is_rgba_integer():
    assert Rgba.from_attr("0xff") == Rgba(0, 0, 0, 255)
    assert Rgba.from_attr("0xff00ff") == Rgba(0, 255, 0, 255)
    assert Rgba(0, 0, 0, 255).to_attr() == "0xff"
    assert Rgba.from_css("#ff0000").to_attr() == "0xff0000ff"
    assert Rgba.from_attr("0x0").to_css() == "#00000000"
