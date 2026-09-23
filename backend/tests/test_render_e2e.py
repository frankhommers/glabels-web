"""Vertical slice: choose a template, place text, have a PDF made.

Needs the built renderer image. Without that image the test is skipped; it
must never silently report "passed" without a real PDF.
"""

from __future__ import annotations

import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app

IMAGE = "glabels-web/renderer:dev"


def _image_available() -> bool:
    if shutil.which("docker") is None:
        return False
    result = subprocess.run(
        ["docker", "image", "inspect", IMAGE], capture_output=True, text=True, check=False
    )
    return result.returncode == 0


pytestmark = pytest.mark.skipif(
    not _image_available(), reason=f"renderer image {IMAGE} is missing; build docker/renderer.Dockerfile"
)


@pytest.fixture()
def client(tmp_path, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(templates_dir.parent / "fonts"))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_BATCH_DOCKER_IMAGE", IMAGE)
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


def test_new_document_gives_a_valid_pdf(client):
    doc = client.post(
        "/api/documents", json={"name": "Vertical slice", "brand": "Avery", "part": "5095"}
    ).json()

    doc["content"]["objects"] = [
        {
            "type": "text",
            "x_pt": 18,
            "y_pt": 30,
            "w_pt": 200,
            "h_pt": 40,
            "lines": ["gLabels Web"],
            "font_family": "Liberation Sans",
            "font_size": 18,
        }
    ]
    saved = client.put(f"/api/documents/{doc['id']}", json={"content": doc["content"]})
    assert saved.status_code == 200, saved.text

    info = client.get(f"/api/documents/{doc['id']}/preview", params={"copies": 1})
    assert info.status_code == 200, info.text
    assert info.json()["pages"] == 1
    assert info.json()["page_width_pt"] > 0

    # The preview is a rasterisation of exactly the PDF that gets printed.
    image = client.get(f"/api/documents/{doc['id']}/preview.png", params={"copies": 1, "dpi": 72})
    assert image.status_code == 200, image.text
    assert image.headers["content-type"] == "image/png"
    assert image.content[:8] == b"\x89PNG\r\n\x1a\n"

    pdf = client.get(f"/api/documents/{doc['id']}/print.pdf", params={"copies": 1})
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF-")


def test_broken_document_reports_an_error_instead_of_an_empty_pdf(client, tmp_path):
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()

    revision_file = next((tmp_path / "data" / "documents" / doc["id"]).glob("rev-*.glabels"))
    revision_file.write_bytes(b"this is not xml")

    response = client.get(f"/api/documents/{doc['id']}/preview.png", params={"copies": 1})
    assert response.status_code == 422
    assert "unusable" in response.json()["detail"]


def test_document_without_template_is_stopped(client, tmp_path):
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()

    # The upstream renderer crashes on such a document; we stop it.
    revision_file = next((tmp_path / "data" / "documents" / doc["id"]).glob("rev-*.glabels"))
    revision_file.write_bytes(
        b'<?xml version="1.0"?>\n<Glabels-document version="4.0"></Glabels-document>\n'
    )

    response = client.get(f"/api/documents/{doc['id']}/preview.png", params={"copies": 1})
    assert response.status_code == 422
    assert "Template" in response.json()["detail"]


def test_uploaded_font_ends_up_in_the_pdf(client, templates_dir):
    """An added font must really reach the renderer."""
    fonts_dir = templates_dir.parent / "fonts"
    source = next(fonts_dir.rglob("DejaVuSerif.ttf"), None)
    if source is None:
        pytest.skip("bundled fonts missing")

    # Uploading the font under another name does not change the family name;
    # we check that the renderer really sees the file.
    uploaded = client.post(
        "/api/fonts", files={"file": ("custom.ttf", source.read_bytes(), "font/ttf")}
    )
    assert uploaded.status_code == 201, uploaded.text
    family = uploaded.json()["family"]

    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()
    doc["content"]["objects"] = [
        {
            "type": "text",
            "x_pt": 18,
            "y_pt": 30,
            "w_pt": 200,
            "h_pt": 40,
            "lines": ["Font test"],
            "font_family": family,
            "font_size": 18,
        }
    ]
    assert client.put(f"/api/documents/{doc['id']}", json={"content": doc["content"]}).status_code == 200

    pdf = client.get(f"/api/documents/{doc['id']}/print.pdf", params={"copies": 1})
    assert pdf.status_code == 200, pdf.text
    assert b"DejaVuSerif" in pdf.content
