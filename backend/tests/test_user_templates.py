"""User product definitions: saving, finding and deleting."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app


@pytest.fixture()
def client(tmp_path, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(templates_dir.parent / "fonts"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_FILES_DIR", str(tmp_path / "shared"))
    monkeypatch.delenv("GLW_USER_TEMPLATES_DIR", raising=False)
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


def _derived(client, brand="Custombrand", part="CUSTOM-1", **changes) -> dict:
    """Take an existing product as a starting point, like the interface does."""
    base = client.get("/api/templates/Avery/5395").json()
    return {**base, "brand": brand, "part": part, "source": "user", **changes}


def test_save_and_find_definition(client, tmp_path):
    definition = _derived(client, description="Own name badge")
    response = client.post("/api/templates", json=definition)
    assert response.status_code == 201, response.text

    saved = response.json()
    assert saved["source"] == "user"
    assert saved["description"] == "Own name badge"

    # The file sits in the shared folder, so it can be downloaded or copied.
    files = client.get("/api/files", params={"path": "templates"}).json()["entries"]
    assert [entry["name"] for entry in files] == ["Custombrand-CUSTOM-1.xml"]
    assert files[0]["kind"] == "definition"

    # And it shows up in the product picker.
    found = client.get("/api/templates", params={"q": "custombrand"}).json()
    assert found["total"] == 1
    assert found["items"][0]["part"] == "CUSTOM-1"


def test_sizes_are_taken_over(client):
    definition = _derived(client)
    definition["frames"][0]["width_pt"] = 200.0
    definition["frames"][0]["height_pt"] = 100.0
    definition["frames"][0]["layouts"][0] = {
        "nx": 2,
        "ny": 3,
        "x0_pt": 20.0,
        "y0_pt": 20.0,
        "dx_pt": 280.0,
        "dy_pt": 240.0,
    }
    saved = client.post("/api/templates", json=definition).json()

    frame = saved["frames"][0]
    assert frame["width_pt"] == pytest.approx(200.0)
    assert frame["height_pt"] == pytest.approx(100.0)
    assert frame["layouts"][0]["nx"] == 2
    assert frame["layouts"][0]["ny"] == 3


def test_labels_that_do_not_fit_the_sheet_are_refused(client):
    definition = _derived(client)
    definition["frames"][0]["layouts"][0]["nx"] = 9
    response = client.post("/api/templates", json=definition)
    assert response.status_code == 422
    assert "do not fit on the sheet" in response.json()["detail"]


def test_bundled_definition_cannot_be_overwritten(client):
    definition = _derived(client, brand="Avery", part="5395")
    response = client.post("/api/templates", json=definition)
    assert response.status_code == 422
    assert "bundled" in response.json()["detail"]


def test_bundled_definition_cannot_be_deleted(client):
    assert client.delete("/api/templates/Avery/5395").status_code == 403


def test_delete_user_definition(client):
    client.post("/api/templates", json=_derived(client))
    assert client.delete("/api/templates/Custombrand/CUSTOM-1").status_code == 204
    assert client.get("/api/templates/Custombrand/CUSTOM-1").status_code == 404
    assert client.get("/api/files", params={"path": "templates"}).json()["entries"] == []


def test_definition_from_the_folder_is_picked_up(client, tmp_path):
    """An XML file put directly on the volume counts too."""
    target = tmp_path / "shared" / "templates" / "by-hand.xml"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        '<?xml version="1.0"?>\n'
        "<Glabels-templates>\n"
        '  <Template brand="Byhand" part="XYZ" size="A4" description="Made by hand">\n'
        '    <Label-rectangle id="0" width="100pt" height="50pt" round="0pt">\n'
        '      <Layout nx="1" ny="1" x0="10pt" y0="10pt" dx="0pt" dy="0pt"/>\n'
        "    </Label-rectangle>\n"
        "  </Template>\n"
        "</Glabels-templates>\n"
    )

    found = client.get("/api/templates", params={"q": "byhand"}).json()
    assert found["total"] == 1
    assert found["items"][0]["source"] == "user"


def test_empty_name_is_refused(client):
    response = client.post("/api/templates", json=_derived(client, brand="  ", part="X"))
    assert response.status_code == 422
