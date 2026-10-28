"""A merge source edited as a table."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.api.routes_tables import guess_delimiter
from glabels_web.main import create_app


@pytest.fixture()
def shared(tmp_path):
    folder = tmp_path / "shared-folder"
    folder.mkdir()
    return folder


@pytest.fixture()
def client(tmp_path, shared, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(templates_dir.parent / "fonts"))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_FILES_DIR", str(shared))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


@pytest.mark.parametrize(
    ("name", "text", "expected"),
    [
        ("a.tsv", "name,city\n", "\t"),
        ("a.csv", "name,city\n", ","),
        ("a.csv", "name;city;street\n", ";"),
        ("a.txt", "name\tcity\n", "\t"),
        ("a.csv", "name\n", ","),
        ("a.txt", "name\n", "\t"),
    ],
)
def test_delimiter_is_guessed(name, text, expected):
    assert guess_delimiter(name, text) == expected


def test_reads_rows_the_way_glabels_does(client, shared):
    (shared / "people.csv").write_text('name,note\nAnna,"one, two"\nBram,first\\nsecond\n')

    table = client.get("/api/files/table", params={"path": "people.csv"}).json()

    assert table["delimiter"] == ","
    assert table["rows"] == [["name", "note"], ["Anna", "one, two"], ["Bram", "first\nsecond"]]
    assert len(table["sha256"]) == 64


def test_saves_and_reads_back_unchanged(client, shared):
    (shared / "people.tsv").write_text("name\tnote\n")
    start = client.get("/api/files/table", params={"path": "people.tsv"}).json()
    rows = [["name", "note"], ["Anna", "two\nlines"], ["Bram", 'with\ttab and "quote"'], ["", ""]]

    saved = client.put(
        "/api/files/table",
        json={"path": "people.tsv", "delimiter": "\t", "rows": rows, "sha256": start["sha256"]},
    )

    assert saved.status_code == 200
    # The empty line is left out: gLabels skips it anyway.
    assert saved.json()["rows"] == rows[:3]
    assert (shared / "people.tsv").read_text().splitlines()[1] == "Anna\ttwo\\nlines"


def test_refuses_to_save_over_a_change_made_elsewhere(client, shared):
    (shared / "people.csv").write_text("name\nAnna\n")
    start = client.get("/api/files/table", params={"path": "people.csv"}).json()
    (shared / "people.csv").write_text("name\nAnna\nBram\n")  # a phone added a row

    refused = client.put(
        "/api/files/table",
        json={"path": "people.csv", "delimiter": ",", "rows": [["name"], ["Carla"]], "sha256": start["sha256"]},
    )
    assert refused.status_code == 409
    assert (shared / "people.csv").read_text() == "name\nAnna\nBram\n"

    # Without a version it overwrites, when that is what you want.
    forced = client.put(
        "/api/files/table", json={"path": "people.csv", "delimiter": ",", "rows": [["name"], ["Carla"]]}
    )
    assert forced.status_code == 200
    assert (shared / "people.csv").read_text() == "name\nCarla\n"


def test_keeps_a_byte_order_mark(client, shared):
    (shared / "excel.csv").write_bytes(b"\xef\xbb\xbfname\nAnna\n")
    start = client.get("/api/files/table", params={"path": "excel.csv"}).json()
    assert start["rows"] == [["name"], ["Anna"]]

    client.put(
        "/api/files/table",
        json={"path": "excel.csv", "delimiter": ",", "rows": [["name"], ["Bram"]], "sha256": start["sha256"]},
    )
    assert (shared / "excel.csv").read_bytes() == b"\xef\xbb\xbfname\nBram\n"


def test_new_rows_of_a_list_get_an_id(client, shared):
    (shared / "list.tsv").write_text("name\t_id\t_copies\t_printed\nAnna\tabc\t1\t\n")
    start = client.get("/api/files/table", params={"path": "list.tsv"}).json()
    rows = [*start["rows"], ["Bram"]]

    saved = client.put(
        "/api/files/table", json={"path": "list.tsv", "delimiter": "\t", "rows": rows, "sha256": start["sha256"]}
    ).json()

    assert saved["rows"][1][1] == "abc"
    assert saved["rows"][2][0] == "Bram"
    assert len(saved["rows"][2][1]) == 8


@pytest.mark.parametrize("path", ["label.glabels", "fonts/a.ttf", "../outside.csv"])
def test_only_data_files_inside_the_folder(client, path):
    assert client.get("/api/files/table", params={"path": path}).status_code in (400, 404)
    response = client.put("/api/files/table", json={"path": path, "delimiter": ",", "rows": [["a"]]})
    assert response.status_code == 400
