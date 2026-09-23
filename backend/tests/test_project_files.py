"""A project lives in a .glabels file in the shared folder."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app


@pytest.fixture()
def folder(tmp_path):
    return tmp_path / "shared-folder"


@pytest.fixture()
def client(tmp_path, templates_dir, monkeypatch, folder):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(templates_dir.parent / "fonts"))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_FILES_DIR", str(folder))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


def _new(client):
    body = client.post(
        "/api/documents", json={"name": "Avery 5095", "brand": "Avery", "part": "5095"}
    ).json()
    assert body["file_state"] == "none"
    assert body["file_path"] is None
    return body


def _text(content: str) -> dict:
    return {
        "type": "text", "x_pt": 10, "y_pt": 10, "w_pt": 100, "h_pt": 20,
        "lines": [content],
    }


def _save(client, doc, *objects):
    response = client.put(
        f"/api/documents/{doc['id']}",
        json={"content": {"rotate": False, "objects": list(objects)}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_save_as_creates_the_file_and_every_save_updates_it(client, folder):
    doc = _new(client)
    (folder / "labels").mkdir(parents=True)

    saved = client.post(
        f"/api/documents/{doc['id']}/save-as", json={"path": "labels", "name": "Cellar"}
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["file_path"] == "labels/Cellar.glabels"
    assert body["name"] == "Cellar"
    assert body["file_state"] == "linked"
    file = folder / "labels" / "Cellar.glabels"
    assert file.is_file()

    _save(client, doc, _text("Jam 2026"))
    assert b"Jam 2026" in file.read_bytes()
    # No temporary files left behind.
    assert sorted(p.name for p in (folder / "labels").iterdir()) == ["Cellar.glabels"]


def test_save_as_does_not_overwrite_without_permission(client, folder):
    doc = _new(client)
    folder.mkdir(exist_ok=True)
    (folder / "Existing.glabels").write_text("old")

    refused = client.post(f"/api/documents/{doc['id']}/save-as", json={"name": "Existing"})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "file-exists"
    assert (folder / "Existing.glabels").read_text() == "old"

    allowed = client.post(
        f"/api/documents/{doc['id']}/save-as", json={"name": "Existing", "overwrite": True}
    )
    assert allowed.status_code == 200
    assert (folder / "Existing.glabels").read_bytes().startswith(b"<?xml")


def test_opening_from_the_folder_makes_no_copy(client, folder):
    doc = _new(client)
    client.post(f"/api/documents/{doc['id']}/save-as", json={"name": "Cellar"})

    opened = client.post("/api/documents/import-from-file", json={"path": "Cellar.glabels"})
    assert opened.json()["id"] == doc["id"]
    assert len(client.get("/api/documents").json()) == 1


def test_change_outside_the_app_comes_in_on_open(client, folder):
    doc = _new(client)
    client.post(f"/api/documents/{doc['id']}/save-as", json={"name": "Cellar"})
    revision = client.get(f"/api/documents/{doc['id']}").json()["revision"]

    file = folder / "Cellar.glabels"
    file.write_bytes(file.read_bytes().replace(b"<Objects", b"<!-- desktop --><Objects"))

    opened = client.post("/api/documents/import-from-file", json={"path": "Cellar.glabels"}).json()
    assert opened["id"] == doc["id"]
    assert opened["revision"] == revision + 1
    assert opened["file_state"] == "linked"


def test_conflict_is_not_overwritten_and_the_user_chooses(client, folder):
    doc = _new(client)
    client.post(f"/api/documents/{doc['id']}/save-as", json={"name": "Cellar"})
    file = folder / "Cellar.glabels"
    from_desktop = file.read_bytes().replace(b"<Objects", b"<!-- desktop --><Objects")
    file.write_bytes(from_desktop)

    # Saving in the app goes ahead, but the file stays the desktop's.
    body = _save(client, doc, _text("from the app"))
    assert body["file_state"] == "conflict"
    assert file.read_bytes() == from_desktop

    # Choose the version from the file: it becomes a new revision.
    chosen = client.post(f"/api/documents/{doc['id']}/file/resolve", json={"keep": "file"}).json()
    assert chosen["file_state"] == "linked"
    assert chosen["content"]["objects"] == []

    # And the other way round: the app wins.
    file.write_bytes(from_desktop.replace(b"desktop", b"desktop again"))
    _save(client, doc, _text("the app after all"))
    chosen = client.post(f"/api/documents/{doc['id']}/file/resolve", json={"keep": "app"}).json()
    assert chosen["file_state"] == "linked"
    assert b"the app after all" in file.read_bytes()


def test_missing_file_comes_back_on_save(client, folder):
    doc = _new(client)
    client.post(f"/api/documents/{doc['id']}/save-as", json={"name": "Cellar"})
    (folder / "Cellar.glabels").unlink()
    assert client.get(f"/api/documents/{doc['id']}").json()["file_state"] == "missing"

    body = _save(client, doc, _text("back"))
    assert body["file_state"] == "linked"
    assert (folder / "Cellar.glabels").is_file()


def test_renaming_renames_the_file(client, folder):
    doc = _new(client)
    client.post(f"/api/documents/{doc['id']}/save-as", json={"name": "Cellar"})

    info = client.put(f"/api/documents/{doc['id']}/name", json={"name": "Attic"}).json()
    assert info["file_path"] == "Attic.glabels"
    assert (folder / "Attic.glabels").is_file()
    assert not (folder / "Cellar.glabels").exists()

    (folder / "Garage.glabels").write_text("another file")
    clash = client.put(f"/api/documents/{doc['id']}/name", json={"name": "Garage"})
    assert clash.status_code == 409
    assert (folder / "Garage.glabels").read_text() == "another file"


def test_renaming_a_project_without_file_leaves_the_folder_alone(client, folder):
    doc = _new(client)
    info = client.put(f"/api/documents/{doc['id']}/name", json={"name": "Loose"}).json()
    assert info["name"] == "Loose"
    assert info["file_path"] is None


def test_the_list_shows_the_state_of_each_file(client, folder):
    kept = _new(client)
    changed = _new(client)
    gone = _new(client)
    internal = _new(client)
    folder.mkdir(parents=True, exist_ok=True)
    for doc, name in ((kept, "Kept"), (changed, "Changed"), (gone, "Gone")):
        response = client.post(
            f"/api/documents/{doc['id']}/save-as", json={"path": "", "name": name}
        )
        assert response.status_code == 200, response.text
    (folder / "Changed.glabels").write_bytes(b"<Glabels-document/>")
    (folder / "Gone.glabels").unlink()

    states = {item["id"]: item["file_state"] for item in client.get("/api/documents").json()}
    assert states == {
        kept["id"]: "linked",
        changed["id"]: "conflict",
        gone["id"]: "missing",
        internal["id"]: "none",
    }


def test_merge_source_is_relative_to_the_document_file(client, folder):
    (folder / "merges").mkdir(parents=True)
    (folder / "merges" / "addresses.csv").write_text("name,city\nAda,London\n")
    (folder / "labels").mkdir()
    doc = _new(client)
    client.post(f"/api/documents/{doc['id']}/save-as", json={"path": "labels", "name": "Post"})

    chosen = client.put(
        f"/api/documents/{doc['id']}/merge",
        json={"type": "Text/Comma/Line1Keys", "source_path": "merges/addresses.csv"},
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["merge"]["src"] == "../merges/addresses.csv"
    # The file in the folder follows right away, as with every other change.
    assert b'src="../merges/addresses.csv"' in (folder / "labels" / "Post.glabels").read_bytes()
    assert chosen.json()["file_state"] == "linked"

    # Saved into another folder, the document reaches the source another way.
    moved = client.post(f"/api/documents/{doc['id']}/save-as", json={"path": "", "name": "Post"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["merge"]["src"] == "merges/addresses.csv"
    assert moved.json()["merge"]["available"] is True
    assert b'src="merges/addresses.csv"' in (folder / "Post.glabels").read_bytes()
