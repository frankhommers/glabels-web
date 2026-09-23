"""FastAPI application for gLabels Web."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .api import (
    routes_documents,
    routes_files,
    routes_fonts,
    routes_preferences,
    routes_printers,
    routes_templates,
)
from .api.deps import AppState
from .settings import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)


class Health(BaseModel):
    status: str
    version: str
    templates: int
    brands: int
    renderer_mode: str
    renderer_available: bool
    fonts: int
    files_dir: str
    files_available: bool
    printing_available: bool
    printers: int
    upstream_commit: str | None = None
    # GLW_PUBLIC_URL, when set: the address links to this installation use.
    public_url: str | None = None


def _upstream_commit(settings) -> str | None:
    for candidate in (
        Path("/opt/glabels/share/glabels-web/upstream-commit.txt"),
        Path(settings.system_templates_dir).parent.parent / "glabels-web" / "upstream-commit.txt",
        Path(settings.system_templates_dir).parent / "upstream-commit.txt",
    ):
        try:
            return candidate.read_text().strip()
        except OSError:
            continue
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.app_state = AppState.create()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.public_url_raw.strip() and settings.public_url is None:
        log.warning(
            "GLW_PUBLIC_URL=%r is not an absolute http(s) address; it is ignored",
            settings.public_url_raw,
        )
    app = FastAPI(
        title="gLabels Web",
        version=__version__,
        summary="Web interface for gLabels labels, with the existing Qt renderer producing the output.",
        lifespan=lifespan,
    )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(routes_templates.router)
    app.include_router(routes_documents.router)
    app.include_router(routes_fonts.router)
    app.include_router(routes_files.router)
    app.include_router(routes_printers.router)
    app.include_router(routes_preferences.router)

    @app.get("/api/health", response_model=Health, tags=["status"])
    def health() -> Health:
        app_state: AppState = app.state.app_state
        return Health(
            status="ok",
            version=__version__,
            templates=len(app_state.templates.templates),
            brands=len(app_state.templates.brands()),
            renderer_mode=app_state.renderer.mode,
            renderer_available=app_state.renderer.available(),
            fonts=len(app_state.fonts.families()),
            files_dir=str(app_state.settings.files_dir),
            files_available=app_state.files.available,
            printing_available=app_state.printers.available(),
            printers=len(app_state.registry.list()),
            upstream_commit=_upstream_commit(app_state.settings),
            public_url=app_state.settings.public_url,
        )

    # In the container the built frontend sits next to the API.
    web_root = Path(settings.web_root)
    if web_root.is_dir():
        app.mount("/assets", StaticFiles(directory=web_root / "assets"), name="assets")
        app.mount("/icons", StaticFiles(directory=web_root / "icons"), name="icons")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str) -> FileResponse:
            # An unknown API path is a mistake, not a page: answering with
            # index.html would hide it behind a 200.
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="unknown endpoint")
            # Only files inside the web root: the path may hold encoded "..".
            root = web_root.resolve()
            candidate = (root / full_path).resolve()
            if full_path and candidate.is_relative_to(root) and candidate.is_file():
                return FileResponse(candidate)
            # The page names the current build's assets, so the browser must
            # ask for it again after an update instead of keeping an old one.
            return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
