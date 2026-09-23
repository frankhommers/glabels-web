"""The shared folder: confinement, browsing and merge sources."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.documents import merge as merge_backends
from glabels_web.files import FileArea, FileAreaError
from glabels_web.main import create_app

CSV = "name,city\nAnna,Utrecht\nBram,Leiden\nCarla,Almere\n"


@pytest.fixture()
def area(tmp_path):
    root = tmp_path / "shared"
    root.mkdir()
    return FileArea(root)


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


# ----------------------------------------------------------------- confinement
@pytest.mark.parametrize("path", ["../secret", "folder/../../secret", "folder/../..", "../"])
def test_paths_outside_the_folder_are_refused(area, path):
    with pytest.raises(FileAreaError):
        area.resolve(path)


def test_symlink_pointing_outside_is_refused(area, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_text("secret")
    (area.root / "shortcut").symlink_to(outside)

    with pytest.raises(FileAreaError):
        area.read("shortcut")


def test_absolute_path_stays_inside_the_folder(area):
    """A path with a leading slash counts as a path inside the shared folder.

    So ``/etc/passwd`` refers to ``<shared folder>/etc/passwd`` and never to
    the real system file.
    """
    area.write("", "note.txt", b"hello")
    assert area.read("/note.txt") == b"hello"
    assert area.resolve("/etc/passwd") == area.root.resolve() / "etc" / "passwd"


# -------------------------------------------------------------------- browsing
def test_browsing_sorts_folders_first(area):
    area.make_directory("", "fonts")
    area.write("", "b.csv", b"x")
    area.write("", "a.glabels", b"x")

    names = [entry.name for entry in area.list()]
    assert names == ["fonts", "a.glabels", "b.csv"]

    kinds = {entry.name: entry.kind for entry in area.list()}
    assert kinds == {"fonts": "folder", "a.glabels": "document", "b.csv": "data"}


def test_fonts_are_recognised(area):
    area.write("", "custom.ttf", b"x")
    assert area.list()[0].kind == "font"


def test_existing_name_gets_a_sequence_number(area):
    first = area.write("", "list.csv", b"one")
    second = area.write("", "list.csv", b"two")
    assert first.name == "list.csv"
    assert second.name == "list-1.csv"


def test_non_empty_folder_cannot_be_deleted(area):
    area.make_directory("", "stuff")
    area.write("stuff", "thing.txt", b"x")
    with pytest.raises(FileAreaError):
        area.delete("stuff")


# ----------------------------------------------------------------------- merge
def test_merge_preview_with_field_names():
    preview = merge_backends.preview(CSV.encode(), "Text/Comma/Line1Keys")
    assert preview.keys == ["name", "city"]
    assert preview.record_count == 3
    assert preview.records[0] == {"name": "Anna", "city": "Utrecht"}


def test_merge_preview_without_field_names_uses_column_numbers():
    preview = merge_backends.preview(CSV.encode(), "Text/Comma")
    assert preview.keys == ["1", "2"]
    assert preview.record_count == 4  # the header line counts as data here
    assert preview.records[0] == {"1": "name", "2": "city"}


# ------------------------------------------------------------------------- API
def test_api_browse_upload_and_delete(client):
    listing = client.get("/api/files").json()
    assert listing["available"] is True
    # The fonts folder is created automatically.
    assert any(entry["name"] == "fonts" for entry in listing["entries"])

    upload = client.post(
        "/api/files/upload", data={"path": ""}, files={"file": ("addresses.csv", CSV.encode(), "text/csv")}
    )
    assert upload.status_code == 201, upload.text
    assert upload.json()["kind"] == "data"

    download = client.get("/api/files/download", params={"path": "addresses.csv"})
    assert download.status_code == 200
    assert download.content == CSV.encode()

    assert client.delete("/api/files", params={"path": "addresses.csv"}).status_code == 204


def test_api_refuses_escape(client):
    assert client.get("/api/files", params={"path": "../.."}).status_code == 400
    assert client.get("/api/files/download", params={"path": "../../etc/passwd"}).status_code == 404


def test_font_in_the_shared_folder_is_picked_up(client, templates_dir):
    source = next((templates_dir.parent / "fonts").rglob("DejaVuSerif.ttf"), None)
    if source is None:
        pytest.skip("bundled fonts missing")

    before = {item["family"] for item in client.get("/api/fonts").json()}
    upload = client.post(
        "/api/files/upload",
        data={"path": "fonts"},
        files={"file": ("extra.ttf", source.read_bytes(), "font/ttf")},
    )
    assert upload.status_code == 201, upload.text
    assert upload.json()["kind"] == "font"

    after = client.get("/api/fonts").json()
    assert any(item["source"] == "uploaded" for item in after)
    assert len(after) >= len(before)


def test_open_and_save_document_in_the_folder(client, fixtures_dir):
    raw = (fixtures_dir / "simple-shapes.glabels").read_bytes()
    client.post(
        "/api/files/upload", data={"path": ""}, files={"file": ("shapes.glabels", raw, "application/xml")}
    )

    opened = client.post("/api/documents/import-from-file", json={"path": "shapes.glabels"})
    assert opened.status_code == 201, opened.text
    doc = opened.json()
    assert doc["name"] == "shapes"
    assert len(doc["content"]["objects"]) == 3

    exported = client.post(
        f"/api/documents/{doc['id']}/export-to-file", json={"path": "", "name": "copy"}
    )
    assert exported.status_code == 200, exported.text
    listing = client.get("/api/files").json()
    assert any(entry["name"] == "copy.glabels" for entry in listing["entries"])


def test_set_merge_and_preview(client):
    client.post(
        "/api/files/upload", data={"path": ""}, files={"file": ("addresses.csv", CSV.encode(), "text/csv")}
    )
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()

    updated = client.put(
        f"/api/documents/{doc['id']}/merge",
        json={"type": "Text/Comma/Line1Keys", "source_path": "addresses.csv"},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["merge"]["type"] == "Text/Comma/Line1Keys"
    assert body["merge"]["src"] == "addresses.csv"
    assert body["merge"]["available"] is True

    # Relative to the document's folder, so it stays usable on a desktop.
    export = client.get(f"/api/documents/{doc['id']}/file").content
    assert b'<Merge type="Text/Comma/Line1Keys" src="addresses.csv"/>' in export

    preview = client.get(f"/api/documents/{doc['id']}/merge").json()
    assert preview["keys"] == ["name", "city"]
    assert preview["record_count"] == 3


def test_missing_merge_source_is_reported(client):
    client.post(
        "/api/files/upload", data={"path": ""}, files={"file": ("temporary.csv", CSV.encode(), "text/csv")}
    )
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()
    client.put(
        f"/api/documents/{doc['id']}/merge",
        json={"type": "Text/Comma/Line1Keys", "source_path": "temporary.csv"},
    )
    client.delete("/api/files", params={"path": "temporary.csv"})

    detail = client.get(f"/api/documents/{doc['id']}").json()
    assert detail["merge"]["available"] is False
    assert any(item["code"] == "merge-source-missing" for item in detail["limitations"])
