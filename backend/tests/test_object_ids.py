"""Object ids stay the same across saves.

Without stable ids the editor would get different references back after
every save, and a second save of the same content would duplicate objects.
That is what autosave builds on.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app


@pytest.fixture()
def client(tmp_path, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(templates_dir.parent / "fonts"))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


def _text(x: float = 10, lines: list[str] | None = None) -> dict:
    return {
        "type": "text",
        "x_pt": x,
        "y_pt": 10,
        "w_pt": 100,
        "h_pt": 20,
        "lines": lines or ["Text"],
        "font_family": "Liberation Sans",
        "font_size": 10,
    }


def test_ids_stay_the_same_after_saving(client):
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()
    content = doc["content"]
    content["objects"] = [_text(10), _text(50)]

    first = client.put(f"/api/documents/{doc['id']}", json={"content": content}).json()
    ids = [obj["id"] for obj in first["content"]["objects"]]
    assert len(set(ids)) == 2

    # Saving again with the same ids must not duplicate anything.
    second = client.put(
        f"/api/documents/{doc['id']}", json={"content": first["content"]}
    ).json()
    assert [obj["id"] for obj in second["content"]["objects"]] == ids
    assert len(second["content"]["objects"]) == 2

    # And fetching again gives the same ids.
    again = client.get(f"/api/documents/{doc['id']}").json()
    assert [obj["id"] for obj in again["content"]["objects"]] == ids


def test_id_stays_with_the_object_after_reordering(client):
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()
    content = doc["content"]
    content["objects"] = [_text(10, ["first"]), _text(50, ["second"])]
    saved = client.put(f"/api/documents/{doc['id']}", json={"content": content}).json()

    objects = saved["content"]["objects"]
    first_id = next(o["id"] for o in objects if o["lines"] == ["first"])

    # Reverse: the id belongs to the object, not to the position.
    reversed_content = {"rotate": False, "objects": list(reversed(objects))}
    after = client.put(f"/api/documents/{doc['id']}", json={"content": reversed_content}).json()

    assert after["content"]["objects"][0]["lines"] == ["second"]
    assert next(o["id"] for o in after["content"]["objects"] if o["lines"] == ["first"]) == first_id


def test_unchanged_save_makes_no_new_revision(client):
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()
    content = doc["content"]
    content["objects"] = [_text()]

    first = client.put(f"/api/documents/{doc['id']}", json={"content": content}).json()
    second = client.put(
        f"/api/documents/{doc['id']}", json={"content": first["content"]}
    ).json()

    assert second["revision"] == first["revision"]


def test_new_object_gets_a_free_id(client):
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()
    content = doc["content"]
    content["objects"] = [_text(10)]
    saved = client.put(f"/api/documents/{doc['id']}", json={"content": content}).json()

    # For a new object the editor sends an id it made up itself; that must
    # not clash with an existing object.
    objects = saved["content"]["objects"]
    objects.append({**_text(80), "id": objects[0]["id"]})
    after = client.put(
        f"/api/documents/{doc['id']}", json={"content": {"rotate": False, "objects": objects}}
    ).json()

    ids = [obj["id"] for obj in after["content"]["objects"]]
    assert len(after["content"]["objects"]) == 2
    assert len(set(ids)) == 2
