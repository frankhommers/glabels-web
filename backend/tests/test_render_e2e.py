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


def test_an_embedded_picture_is_printed(client):
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    rows = b"".join(b"\x00" + b"\x00\x00\x00" * 8 for _ in range(8))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )
    doc = client.post("/api/documents", json={"name": "Picture", "brand": "Avery", "part": "5095"}).json()
    picture = client.post(f"/api/documents/{doc['id']}/images", files={"file": ("black.png", png, "image/png")}).json()
    content = client.get(f"/api/documents/{doc['id']}").json()["content"]
    content["objects"] = [
        {"type": "image", "x_pt": 20, "y_pt": 20, "w_pt": 60, "h_pt": 60, "src": picture["name"]}
    ]
    assert client.put(f"/api/documents/{doc['id']}", json={"content": content}).status_code == 200

    pdf = client.get(f"/api/documents/{doc['id']}/print.pdf", params={"copies": 1})
    assert pdf.status_code == 200, pdf.text
    # The renderer found the picture in the document and drew it.
    assert b"/Subtype /Image" in pdf.content or b"/Subtype/Image" in pdf.content


def test_only_the_rows_still_to_print_are_printed(client):
    doc = client.post("/api/documents", json={"name": "Books", "brand": "Dymo", "part": "30252"}).json()
    content = doc["content"]
    content["objects"] = [{"type": "text", "x_pt": 5, "y_pt": 5, "w_pt": 200, "h_pt": 30, "lines": ["${name}"]}]
    client.put(f"/api/documents/{doc['id']}", json={"content": content})
    rows = [
        client.post(f"/api/documents/{doc['id']}/list/rows", json={"values": {"name": name}, "copies": copies}).json()
        for name, copies in (("Ada", 1), ("Bob", 3), ("Cy", 1))
    ][-1]["rows"]
    client.put(f"/api/documents/{doc['id']}/list/rows/{rows[0]['id']}", json={"printed": True})

    # Bob three times and Cy once; Ada was printed already. One label per page on a roll.
    info = client.get(f"/api/documents/{doc['id']}/preview", params={"copies": 1, "pending_only": True})
    assert info.status_code == 200, info.text
    assert info.json()["pages"] == 4
    everything = client.get(f"/api/documents/{doc['id']}/preview", params={"copies": 1})
    assert everything.json()["pages"] == 3

    client.post(f"/api/documents/{doc['id']}/list/printed", json={"printed": True})
    nothing = client.get(f"/api/documents/{doc['id']}/preview", params={"copies": 1, "pending_only": True})
    assert (nothing.status_code, nothing.json()["detail"]) == (409, "nothing-to-print")


def test_one_label_is_cut_out_of_the_sheet(client):
    import struct

    def png_size(data: bytes) -> tuple[int, int]:
        return struct.unpack(">II", data[16:24])

    # Avery 5095: 2 × 4 badges of 3.375 × 2.333 in on a letter sheet.
    doc = client.post("/api/documents", json={"name": "Badges", "brand": "Avery", "part": "5095"}).json()
    content = doc["content"]
    content["objects"] = [{"type": "text", "x_pt": 20, "y_pt": 20, "w_pt": 200, "h_pt": 40, "lines": ["${name}"]}]
    client.put(f"/api/documents/{doc['id']}", json={"content": content})

    # Values still being typed: the label has no list yet, and shows them all the same.
    typed = client.get(f"/api/documents/{doc['id']}/label.png", params={"values": '{"name": "Ada"}', "dpi": 72})
    assert typed.status_code == 200, typed.text
    assert png_size(typed.content) == (243, 168)  # one badge, not the sheet

    rows = client.post(f"/api/documents/{doc['id']}/list/rows", json={"values": {"name": "Bob"}}).json()["rows"]
    one = client.get(f"/api/documents/{doc['id']}/label.png", params={"row": rows[0]["id"], "dpi": 72})
    assert one.status_code == 200 and png_size(one.content) == (243, 168)
    assert one.content != typed.content  # Bob, not Ada
    assert client.get(f"/api/documents/{doc['id']}/label.png", params={"row": "nope"}).status_code == 404
    # The label as it stands, without a row.
    assert client.get(f"/api/documents/{doc['id']}/label.png", params={"dpi": 72}).status_code == 200


def test_our_own_settings_and_line_breaks_reach_the_print(client):
    doc = client.post("/api/documents", json={"name": "Address", "brand": "Dymo", "part": "30252"}).json()
    content = doc["content"]
    content["objects"] = [{"type": "text", "x_pt": 5, "y_pt": 5, "w_pt": 220, "h_pt": 60, "lines": ["${address}"], "font_size": 14}]
    client.put(f"/api/documents/{doc['id']}", json={"content": content})
    # The renderer is gLabels itself: it must pass over our element.
    client.put(f"/api/documents/{doc['id']}/list/fields/address", json={"lines": "multi"})
    client.post(f"/api/documents/{doc['id']}/list/rows", json={"values": {"address": "Main street 1\nVillage"}})

    pdf = client.get(f"/api/documents/{doc['id']}/print.pdf", params={"copies": 1})
    assert pdf.status_code == 200, pdf.text
    one_line = client.get(f"/api/documents/{doc['id']}/label.png", params={"values": '{"address": "Main street 1 Village"}', "dpi": 72})
    two_lines = client.get(f"/api/documents/{doc['id']}/label.png", params={"values": '{"address": "Main street 1\\nVillage"}', "dpi": 72})
    assert one_line.status_code == two_lines.status_code == 200
    assert one_line.content != two_lines.content
