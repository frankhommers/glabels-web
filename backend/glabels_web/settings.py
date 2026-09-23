"""Application settings.

All paths come from the environment, so the same code works in the container
(everything present locally) and during development on a workstation (where
the renderer runs in Docker).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


def _path(env: str, default: str) -> Path:
    return Path(os.environ.get(env, default)).expanduser()


def _int(env: str, default: int) -> int:
    try:
        return int(os.environ[env])
    except (KeyError, ValueError):
        return default



def normalize_public_url(value: str) -> str | None:
    """An absolute http(s) address without a trailing slash, or `None`.

    A value that is not an absolute http or https address, or that has a
    query or fragment, is not usable as a base for links and gives `None`.
    """
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    parts = urlsplit(cleaned)
    if parts.scheme not in ("http", "https") or not parts.netloc or parts.query or parts.fragment:
        return None
    return cleaned.rstrip("/")

@dataclass(frozen=True)
class Settings:
    # Upstream template database (share/glabels-qt/templates).
    system_templates_dir: Path = field(
        default_factory=lambda: _path("GLW_SYSTEM_TEMPLATES_DIR", "/opt/glabels/share/glabels-qt/templates")
    )

    data_dir: Path = field(default_factory=lambda: _path("GLW_DATA_DIR", "/var/lib/glabels-web"))
    # Shared folder mounted as a volume: merge sources, .glabels files and
    # user fonts. By default a subfolder of the data folder, so one volume is
    # enough.
    files_dir_override: str = field(default_factory=lambda: os.environ.get("GLW_FILES_DIR", ""))
    # Built web interface; in the container it sits next to the API.
    web_root: Path = field(default_factory=lambda: _path("GLW_WEB_ROOT", "/opt/glabels-web/web"))
    # Fonts that ship with the image, and the folder for user uploads.
    builtin_fonts_dir: Path = field(
        default_factory=lambda: _path("GLW_BUILTIN_FONTS_DIR", "/usr/share/fonts")
    )

    # Rendering.
    batch_command: str = field(
        default_factory=lambda: os.environ.get("GLW_BATCH_COMMAND", "/opt/glabels/bin/glabels-batch-qt")
    )
    # A separate docker call for development outside the container.
    batch_docker_image: str | None = field(
        default_factory=lambda: os.environ.get("GLW_BATCH_DOCKER_IMAGE") or None
    )
    render_timeout_seconds: int = field(default_factory=lambda: _int("GLW_RENDER_TIMEOUT", 60))
    render_max_concurrency: int = field(default_factory=lambda: _int("GLW_RENDER_CONCURRENCY", 2))

    # Upload limits; they also apply to decompressed gzip content.
    max_upload_bytes: int = field(default_factory=lambda: _int("GLW_MAX_UPLOAD_BYTES", 32 * 1024 * 1024))

    # The address people use to reach this installation, for example
    # https://labels.home.lan. Used where the application hands out a link to
    # itself, such as the QR code for the phone view. Empty: use whatever
    # address the browser is on.
    public_url_raw: str = field(default_factory=lambda: os.environ.get("GLW_PUBLIC_URL", ""))

    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip() for o in os.environ.get("GLW_CORS_ORIGINS", "").split(",") if o.strip()
        )
    )

    @property
    def public_url(self) -> str | None:
        """`GLW_PUBLIC_URL` without a trailing slash, or `None` when unset or
        unusable (see `normalize_public_url`)."""
        return normalize_public_url(self.public_url_raw)

    @property
    def files_dir(self) -> Path:
        if self.files_dir_override:
            return Path(self.files_dir_override).expanduser()
        return self.data_dir / "files"

    @property
    def user_templates_dir(self) -> Path:
        """User product definitions: a fixed subfolder of the shared folder.

        Like fonts, they can be viewed and downloaded there, and put there
        directly.
        """
        override = os.environ.get("GLW_USER_TEMPLATES_DIR", "")
        return Path(override).expanduser() if override else self.files_dir / "templates"

    @property
    def fonts_dir(self) -> Path:
        """User fonts: a fixed subfolder of the shared folder.

        That way a font can also be put on the volume directly, without
        uploading it through the web interface.
        """
        return self.files_dir / "fonts"

    @property
    def documents_dir(self) -> Path:
        return self.data_dir / "documents"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "glabels-web.sqlite3"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings_cache() -> None:
    """Only for tests that change the environment."""
    global _settings
    _settings = None
