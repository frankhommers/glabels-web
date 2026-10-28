"""Shared application state."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from fastapi import Request

from ..documents.store import DocumentStore
from ..files import FileArea
from ..fonts import FontLibrary
from ..preferences import PreferenceStore
from ..printing import IppClient, PrinterRegistry
from ..render import Renderer
from ..settings import Settings, get_settings
from ..templates import TemplateDatabase

log = logging.getLogger(__name__)


@dataclass
class AppState:
    settings: Settings
    templates: TemplateDatabase
    store: DocumentStore
    renderer: Renderer
    fonts: FontLibrary
    files: FileArea
    printers: IppClient
    registry: PrinterRegistry
    preferences: PreferenceStore

    @classmethod
    def create(cls, settings: Settings | None = None) -> "AppState":
        settings = settings or get_settings()
        templates = TemplateDatabase.load(
            Path(settings.system_templates_dir), Path(settings.user_templates_dir)
        )
        log.info(
            "template database loaded: %d products, %d brands",
            len(templates.templates),
            len(templates.brands()),
        )
        store = DocumentStore(settings.database_path, settings.documents_dir)
        files = FileArea(Path(settings.files_dir))
        files.ensure()
        # The fonts folder is part of the shared folder; make sure it exists,
        # so there is something to fill right away.
        Path(settings.fonts_dir).mkdir(parents=True, exist_ok=True)
        Path(settings.user_templates_dir).mkdir(parents=True, exist_ok=True)
        fonts = FontLibrary(Path(settings.builtin_fonts_dir), Path(settings.fonts_dir))
        log.info("shared folder: %s", settings.files_dir)
        return cls(
            settings=settings,
            templates=templates,
            store=store,
            renderer=Renderer(settings),
            fonts=fonts,
            files=files,
            printers=IppClient(),
            registry=PrinterRegistry(settings.database_path),
            preferences=PreferenceStore(settings.database_path),
        )


def state(request: Request) -> AppState:
    return request.app.state.app_state
