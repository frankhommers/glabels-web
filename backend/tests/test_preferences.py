"""Preferences belong to the installation, not to a browser."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app
from glabels_web.preferences import PreferenceError, PreferenceStore


@pytest.fixture()
def client(tmp_path, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(templates_dir.parent / "fonts"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_FILES_DIR", str(tmp_path / "shared"))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


def test_default_is_millimetre_and_browser_language(client):
    body = client.get("/api/preferences").json()
    assert body["unit"] == "mm"
    assert body["locale"] == ""  # empty means: follow the browser
    assert "in" in body["units"]


def test_setting_is_kept(client):
    client.put("/api/preferences", json={"locale": "en-GB", "unit": "in"})
    body = client.get("/api/preferences").json()
    assert body == {"locale": "en-GB", "unit": "in", "units": body["units"]}


def test_changing_one_field_leaves_the_other(client):
    client.put("/api/preferences", json={"locale": "de-DE", "unit": "cm"})
    client.put("/api/preferences", json={"unit": "pt"})
    body = client.get("/api/preferences").json()
    assert body["locale"] == "de-DE"
    assert body["unit"] == "pt"


@pytest.mark.parametrize("unit", ["el", "parsec", "", "MM"])
def test_unknown_unit_is_refused(client, unit):
    assert client.put("/api/preferences", json={"unit": unit}).status_code == 422


@pytest.mark.parametrize("locale", ["dutch nl", "nl_NL/../etc", "x" * 40])
def test_unusable_language_code_is_refused(client, locale):
    assert client.put("/api/preferences", json={"locale": locale}).status_code == 422


def test_empty_language_code_means_follow_the_browser(client):
    client.put("/api/preferences", json={"locale": "fr-FR"})
    client.put("/api/preferences", json={"locale": ""})
    assert client.get("/api/preferences").json()["locale"] == ""


def test_storage_survives_a_restart(tmp_path):
    path = tmp_path / "preferences.sqlite3"
    PreferenceStore(path).save(locale="en-US", unit="in")

    again = PreferenceStore(path).get()
    assert again.locale == "en-US"
    assert again.unit == "in"


def test_invalid_value_falls_back_to_millimetre(tmp_path):
    path = tmp_path / "preferences.sqlite3"
    store = PreferenceStore(path)
    with pytest.raises(PreferenceError):
        store.save(unit="thumb")
    assert store.get().unit == "mm"
