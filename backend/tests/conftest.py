from __future__ import annotations

import os
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def templates_dir() -> Path:
    """Template database from the renderer image, synced by scripts/sync-vendor.sh."""
    path = Path(os.environ.get("GLW_SYSTEM_TEMPLATES_DIR", "")) if os.environ.get("GLW_SYSTEM_TEMPLATES_DIR") else None
    if path and path.is_dir():
        return path
    local = Path(__file__).resolve().parents[2] / "vendor" / "glabels-qt" / "templates"
    if local.is_dir():
        return local
    pytest.skip("template database missing; run scripts/sync-vendor.sh")


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    if not FIXTURES.is_dir():
        pytest.skip("fixtures missing; run scripts/sync-vendor.sh")
    return FIXTURES
