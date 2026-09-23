"""The renderer must never silently succeed without a valid PDF."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from glabels_web import settings as settings_module
from glabels_web.render import RenderError, RenderRequest, Renderer

IMAGE = "glabels-web/renderer:dev"


def _image_available() -> bool:
    if shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "image", "inspect", IMAGE], capture_output=True).returncode == 0


pytestmark = pytest.mark.skipif(not _image_available(), reason=f"renderer image {IMAGE} is missing")


@pytest.fixture()
def renderer(monkeypatch):
    monkeypatch.setenv("GLW_BATCH_DOCKER_IMAGE", IMAGE)
    monkeypatch.setenv("GLW_RENDER_TIMEOUT", "60")
    settings_module.reset_settings_cache()
    yield Renderer(settings_module.get_settings())
    settings_module.reset_settings_cache()


def test_valid_fixture_gives_pdf(renderer, fixtures_dir, tmp_path):
    import asyncio

    output = tmp_path / "out.pdf"
    result = asyncio.run(
        renderer.render_pdf(
            fixtures_dir / "simple-shapes.glabels", output, RenderRequest(copies=1)
        )
    )
    assert result.pdf_path.read_bytes().startswith(b"%PDF-")


def test_renderer_crash_is_reported(renderer, tmp_path):
    import asyncio

    # Without a Template section the upstream renderer crashes. We expect a
    # clear error, not half a file.
    broken = tmp_path / "broken.glabels"
    broken.write_bytes(b'<?xml version="1.0"?>\n<Glabels-document version="4.0"></Glabels-document>\n')

    with pytest.raises(RenderError) as excinfo:
        asyncio.run(renderer.render_pdf(broken, tmp_path / "out.pdf", RenderRequest(copies=1)))
    assert "code" in str(excinfo.value)
    assert not (tmp_path / "out.pdf").exists()


def test_unreadable_file_gives_no_silent_empty_pdf(renderer, tmp_path):
    import asyncio

    # The CLI exits with 0 here without writing anything; we must not pass
    # that on as success.
    broken = tmp_path / "broken.glabels"
    broken.write_bytes(b"this is not xml")

    with pytest.raises(RenderError) as excinfo:
        asyncio.run(renderer.render_pdf(broken, tmp_path / "out.pdf", RenderRequest(copies=1)))
    assert "no PDF" in str(excinfo.value)
    assert not (tmp_path / "out.pdf").exists()
