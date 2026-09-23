"""Fonts: reading, uploading and serving."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.fonts import FontError, FontLibrary, read_names
from glabels_web.main import create_app


@pytest.fixture(scope="session")
def fonts_dir(templates_dir):
    directory = templates_dir.parent / "fonts"
    if not directory.is_dir():
        pytest.skip("bundled fonts missing; run scripts/sync-vendor.sh")
    return directory


@pytest.fixture()
def client(tmp_path, templates_dir, fonts_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(fonts_dir))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


def test_family_name_from_the_file(fonts_dir):
    path = next(fonts_dir.rglob("LiberationSans-Regular.ttf"))
    names = read_names(path.read_bytes())
    assert names.family == "Liberation Sans"
    assert names.subfamily in ("Regular", "Normal")


def test_non_font_is_refused():
    with pytest.raises(FontError):
        read_names(b"this is not a font" * 10)


def test_library_reads_the_bundled_families(fonts_dir, tmp_path):
    library = FontLibrary(fonts_dir, tmp_path / "uploads")
    assert "Liberation Sans" in library.families()
    assert library.has_family("liberation sans")  # case insensitive
    assert not library.has_family("Nonexistent Font")


def test_upload_and_delete(fonts_dir, tmp_path):
    library = FontLibrary(fonts_dir, tmp_path / "uploads")
    source = next(fonts_dir.rglob("DejaVuSerif.ttf"))
    face = library.add_upload("custom.ttf", source.read_bytes())

    assert face.source == "uploaded"
    assert face.family == "DejaVu Serif"
    assert face.path.parent == tmp_path / "uploads"

    library.remove_upload(face.id)
    assert library.face(face.id) is None


def test_bundled_fonts_cannot_be_deleted(fonts_dir, tmp_path):
    library = FontLibrary(fonts_dir, tmp_path / "uploads")
    builtin = next(face for face in library.faces() if face.source == "builtin")
    with pytest.raises(PermissionError):
        library.remove_upload(builtin.id)
    assert builtin.path.exists()


def test_api_serves_families_and_files(client, fonts_dir):
    families = client.get("/api/fonts").json()
    assert any(item["family"] == "Liberation Sans" for item in families)

    face = next(item for item in families if item["family"] == "Liberation Sans")["faces"][0]
    response = client.get(face["url"])
    assert response.status_code == 200
    assert response.headers["content-type"] == "font/ttf"
    assert response.content[:4] in (b"\x00\x01\x00\x00", b"true", b"OTTO")


def test_api_upload_and_delete(client, fonts_dir):
    source = next(fonts_dir.rglob("DejaVuSansMono.ttf"))
    response = client.post(
        "/api/fonts", files={"file": ("my-font.ttf", source.read_bytes(), "font/ttf")}
    )
    assert response.status_code == 201, response.text
    face = response.json()
    assert face["source"] == "uploaded"

    assert client.delete(f"/api/fonts/{face['id']}").status_code == 204
    assert client.get(f"/api/fonts/{face['id']}/file").status_code == 404


def test_api_refuses_a_file_that_is_not_a_font(client):
    response = client.post(
        "/api/fonts", files={"file": ("fake.ttf", b"just some text", "font/ttf")}
    )
    assert response.status_code == 422
