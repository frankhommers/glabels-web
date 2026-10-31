"""Product definitions glabels-web ships next to upstream's database."""

from __future__ import annotations

from pathlib import Path

import pytest

from glabels_web.templates.database import EXTRA_DIR, TemplateDatabase
from glabels_web.units import parse_length


@pytest.fixture(scope="module")
def database(templates_dir) -> TemplateDatabase:
    return TemplateDatabase.load(templates_dir)


def test_niimbot_rolls_are_products(database):
    items, total = database.search(brand="NIIMBOT")
    assert total > 100
    assert all(item.source == "system" and item.size == "roll" for item in items)


def test_cable_label_shows_its_faces_and_tail(database):
    cable = database.get("NIIMBOT", "12.5x74+35")
    assert cable is not None
    frame = cable.frame
    # The tail follows the printable part along the roll.
    assert frame.width_pt == pytest.approx(parse_length("12.5mm"))
    assert frame.height_pt == pytest.approx(parse_length("109mm"))
    kinds = [markup.type for markup in frame.markups]
    assert kinds.count("line") == 1
    assert kinds.count("rect") == 2
    line = next(m for m in frame.markups if m.type == "line")
    assert line.values["y1"] == pytest.approx(parse_length("74mm"))


def test_found_by_printer_and_box_name(database):
    _, by_printer = database.search(text="D110 cable")
    assert by_printer >= 1
    found, _ = database.search(text="T12.5*74+35")
    assert any(item.part == "12.5x74+35" for item in found)


def test_without_the_extra_folder_nothing_breaks(templates_dir):
    database = TemplateDatabase.load(templates_dir, extra_dir=Path("/nonexistent"))
    assert database.search(brand="NIIMBOT")[1] == 0
    assert database.templates


def test_every_extra_file_is_readable():
    files = sorted(EXTRA_DIR.glob("*.xml"))
    assert files
    for path in files:
        assert path.read_text(encoding="utf-8").lstrip().startswith("<?xml")
