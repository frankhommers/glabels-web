"""The length of a label on a continuous roll (tape)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app
from glabels_web.units import parse_length

MM = 72 / 25.4


@pytest.fixture()
def client(tmp_path, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(templates_dir.parent / "fonts"))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_FILES_DIR", str(tmp_path / "shared-folder"))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


def _new(client, part):
    response = client.post("/api/documents", json={"name": "tape", "brand": "Brother", "part": part})
    assert response.status_code == 201, response.text
    return response.json()


def test_a_roll_starts_at_its_default_length(client):
    doc = _new(client, "DK-22205")
    assert doc["content"]["length_pt"] == pytest.approx(100 * MM)
    assert doc["label_height_pt"] == pytest.approx(100 * MM)
    assert doc["label_min_length_pt"] == pytest.approx(25 * MM)
    assert doc["label_max_length_pt"] == pytest.approx(1000 * MM)


def test_the_length_is_saved_in_the_template_like_glabels_does(client):
    doc = _new(client, "DK-22205")
    saved = client.put(
        f"/api/documents/{doc['id']}",
        json={"content": {"rotate": False, "objects": [], "length_pt": 40 * MM}},
    ).json()
    assert saved["content"]["length_pt"] == pytest.approx(40 * MM)
    assert saved["label_height_pt"] == pytest.approx(40 * MM)

    xml = client.get(f"/api/documents/{doc['id']}/file").content.decode()
    node = xml[xml.index("<Label-continuous") : xml.index(">", xml.index("<Label-continuous"))]
    height = node.split(' height="')[1].split('"')[0]
    assert parse_length(height) == pytest.approx(40 * MM)


def test_the_length_stays_within_the_roll(client):
    doc = _new(client, "DK-22205")
    short = client.put(
        f"/api/documents/{doc['id']}", json={"content": {"rotate": False, "objects": [], "length_pt": 5 * MM}}
    ).json()
    assert short["content"]["length_pt"] == pytest.approx(25 * MM)


def test_saving_without_a_length_leaves_it(client):
    doc = _new(client, "DK-22205")
    client.put(f"/api/documents/{doc['id']}", json={"content": {"rotate": False, "objects": [], "length_pt": 60 * MM}})
    # The phone sends only the objects.
    again = client.put(f"/api/documents/{doc['id']}", json={"content": {"rotate": False, "objects": []}}).json()
    assert again["content"]["length_pt"] == pytest.approx(60 * MM)


def test_a_sheet_label_has_no_length(client):
    response = client.post("/api/documents", json={"name": "sheet", "brand": "Avery", "part": "5160"})
    assert response.json()["content"]["length_pt"] is None
