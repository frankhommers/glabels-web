"""API tests with temporary storage and the real template database."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app


@pytest.fixture()
def client(tmp_path, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["templates"] > 1000
    assert body["brands"] > 10


def test_template_search(client):
    body = client.get("/api/templates", params={"q": "avery 5095"}).json()
    assert body["total"] == 1
    assert body["items"][0]["part"] == "5095"
    assert body["items"][0]["page_width_pt"] == pytest.approx(612.0)


def test_new_document_and_edit(client):
    created = client.post(
        "/api/documents", json={"name": "Test label", "brand": "Avery", "part": "5095"}
    )
    assert created.status_code == 201, created.text
    doc = created.json()
    assert doc["label_width_pt"] == pytest.approx(243.0)
    assert doc["content"]["objects"] == []
    doc_id = doc["id"]

    doc["content"]["objects"] = [
        {
            "type": "text",
            "x_pt": 18,
            "y_pt": 20,
            "w_pt": 150,
            "h_pt": 30,
            "lines": ["Hello", "gLabels"],
            "font_family": "Liberation Sans",
            "font_size": 12,
        }
    ]
    saved = client.put(f"/api/documents/{doc_id}", json={"content": doc["content"]})
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["revision"] == 2
    assert body["content"]["objects"][0]["lines"] == ["Hello", "gLabels"]

    export = client.get(f"/api/documents/{doc_id}/file")
    assert export.status_code == 200
    assert b"<p>Hello</p>" in export.content
    assert b'<Glabels-document version="4.0">' in export.content
    assert b'font_family="Liberation Sans"' in export.content


def test_import_keeps_unknown_content(client, fixtures_dir):
    raw = (fixtures_dir / "unknown-extras.glabels").read_bytes()
    response = client.post(
        "/api/documents/import",
        files={"file": ("unknown-extras.glabels", raw, "application/x-glabels")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "unknown-extras"
    assert [o["type"] for o in body["content"]["objects"]] == ["text", "unsupported"]
    assert any(limit["code"] == "unsupported-object" for limit in body["limitations"])

    # Editing and exporting must not remove the unknown content.
    content = body["content"]
    content["objects"][0]["lines"] = ["Changed"]
    saved = client.put(f"/api/documents/{body['id']}", json={"content": content})
    assert saved.status_code == 200, saved.text
    export = client.get(f"/api/documents/{body['id']}/file").content
    assert b"<Object-future" in export
    assert b'future_attribute="keep-me"' in export
    assert b"<Future-section" in export


def test_unknown_document_gives_404(client):
    assert client.get("/api/documents/00000000-0000-0000-0000-000000000000").status_code == 404
    assert client.get("/api/documents/../etc/passwd").status_code == 404


def test_rename_project(client):
    created = client.post(
        "/api/documents", json={"name": "Avery 5095", "brand": "Avery", "part": "5095"}
    ).json()
    revision = created["revision"]

    renamed = client.put(
        f"/api/documents/{created['id']}/name", json={"name": "  Labels   for the  cellar "}
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Labels for the cellar"
    # A name is not content: no revision is added.
    assert renamed.json()["revision"] == revision
    assert client.get(f"/api/documents/{created['id']}").json()["name"] == "Labels for the cellar"

    assert client.put(f"/api/documents/{created['id']}/name", json={"name": "   "}).status_code == 422
    unknown = "00000000-0000-0000-0000-000000000000"
    assert client.put(f"/api/documents/{unknown}/name", json={"name": "x"}).status_code == 404


def test_unknown_api_path_gives_404(client):
    """The SPA catch-all must not answer an API mistake with index.html."""
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert "text/html" not in response.headers.get("content-type", "")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("", None),
        ("https://labels.home.lan/", "https://labels.home.lan"),
        ("http://192.168.1.10:8000", "http://192.168.1.10:8000"),
        ("labels.home.lan", None),  # no scheme: not usable as a link base
        ("https://labels.home.lan/?x=1", None),
    ],
)
def test_public_url_in_health(tmp_path, templates_dir, monkeypatch, value, expected):
    """GLW_PUBLIC_URL reaches the interface, cleaned up, or not at all."""
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_PUBLIC_URL", value)
    settings_module.reset_settings_cache()
    try:
        with TestClient(create_app()) as client:
            assert client.get("/api/health").json()["public_url"] == expected
    finally:
        settings_module.reset_settings_cache()


def _with_embedded(fixtures_dir, files: str) -> bytes:
    raw = (fixtures_dir / "simple-shapes.glabels").read_text(encoding="utf-8")
    return raw.replace("<Data/>", f"<Data>{files}</Data>").encode("utf-8")


def test_embedded_images_are_served_for_the_editor(client, fixtures_dir):
    import base64

    png = b"\x89PNG\r\n\x1a\n" + b"not really a picture"
    svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    raw = _with_embedded(
        fixtures_dir,
        f'<File name="%image_1%" mimetype="image/png" encoding="base64">'
        f"{base64.b64encode(png).decode()}</File>"
        f'<File name="C:/drawings/ruler.svg" mimetype="image/svg+xml" encoding="cdata">'
        f"<![CDATA[{svg}]]></File>"
        f'<File name="notes.txt" mimetype="text/html" encoding="base64">'
        f"{base64.b64encode(b'<b>hi</b>').decode()}</File>",
    )
    doc = client.post(
        "/api/documents/import", files={"file": ("pictures.glabels", raw, "application/x-glabels")}
    ).json()
    url = f"/api/documents/{doc['id']}/embedded"

    image = client.get(url, params={"name": "%image_1%"})
    assert image.status_code == 200
    assert image.content == png
    assert image.headers["content-type"] == "image/png"
    assert client.get(url, params={"name": "%image_1%"}, headers={"If-None-Match": image.headers["etag"]}).status_code == 304

    # An SVG may hold a script: it must never be allowed to run.
    drawing = client.get(url, params={"name": "C:/drawings/ruler.svg"})
    assert drawing.status_code == 200
    assert drawing.headers["content-type"].startswith("image/svg+xml")
    assert "sandbox" in drawing.headers["content-security-policy"]
    assert "default-src 'none'" in drawing.headers["content-security-policy"]

    # Only images; other embedded content is not handed out.
    assert client.get(url, params={"name": "notes.txt"}).status_code == 415
    assert client.get(url, params={"name": "missing"}).status_code == 404


@pytest.fixture()
def web_client(tmp_path, templates_dir, monkeypatch):
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "icons").mkdir()
    (web / "index.html").write_text("<html>app</html>")
    (web / "manifest.json").write_text("{}")
    (tmp_path / "secret.txt").write_text("not for you")
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_WEB_ROOT", str(web))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


def test_pages_are_served_and_never_cached(web_client):
    page = web_client.get("/m/some-label")
    assert page.status_code == 200
    assert page.text == "<html>app</html>"
    assert page.headers["cache-control"] == "no-cache"
    assert web_client.get("/manifest.json").text == "{}"
    assert web_client.get("/api/does-not-exist").status_code == 404


@pytest.mark.parametrize(
    "path",
    ["/..%2Fsecret.txt", "/%2E%2E/secret.txt", "/..%2F..%2F..%2F..%2Fetc%2Fpasswd", "/assets%2F..%2F..%2Fsecret.txt"],
)
def test_pages_never_leave_the_web_root(web_client, path):
    response = web_client.get(path)
    assert "not for you" not in response.text
    assert "root:" not in response.text


def test_the_list_says_which_designs_are_turned(client):
    upright = client.post("/api/documents", json={"name": "a", "brand": "Avery", "part": "5095"}).json()
    turned = client.post(
        "/api/documents", json={"name": "b", "brand": "Avery", "part": "5095", "rotate": True}
    ).json()
    listed = {item["id"]: item["rotate"] for item in client.get("/api/documents").json()}
    assert listed == {upright["id"]: False, turned["id"]: True}
