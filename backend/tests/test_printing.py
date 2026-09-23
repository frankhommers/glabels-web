"""Printer management: limits, registration and behaviour without a reachable printer.

The full chain (adding, printing, job state) is tested against an IPP
simulator; see docs/printers.md. This file holds what must be right without a
printer too.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app
from glabels_web.printing import (
    IppClient,
    PrinterRegistry,
    PrintingError,
    validate_name,
    validate_uri,
)


@pytest.fixture()
def client(tmp_path, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(templates_dir.parent / "fonts"))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        yield test_client
    settings_module.reset_settings_cache()


# ------------------------------------------------------------------- limits
@pytest.mark.parametrize(
    "uri",
    [
        "http://printer/ipp/print",
        "socket://printer:9100",
        "lpd://printer/queue",
        "file:///etc/passwd",
        "ipp://",
        "ipp://printer",  # no path
        "",
    ],
)
def test_only_ipp_destinations(uri):
    with pytest.raises(PrintingError):
        validate_uri(uri)


def test_ipp_and_ipps_are_allowed():
    assert validate_uri("ipp://192.168.1.50/ipp/print").startswith("ipp://")
    assert validate_uri("ipps://printer.lan:631/ipp/print").startswith("ipps://")


@pytest.mark.parametrize("name", ["with space", "slash/name", "hash#name", "", "a" * 200, "quote'"])
def test_invalid_printer_names(name):
    with pytest.raises(PrintingError):
        validate_name(name)


def test_valid_printer_names():
    for name in ("Labelprinter", "dymo-450", "office.ground_floor"):
        assert validate_name(name) == name


# -------------------------------------------------------------- registration
def test_first_printer_becomes_the_default(tmp_path):
    registry = PrinterRegistry(tmp_path / "test.sqlite3")
    first = registry.add("First", "ipp://printer-a/ipp/print")
    second = registry.add("Second", "ipp://printer-b/ipp/print")

    assert first.is_default is True
    assert second.is_default is False
    assert [printer.name for printer in registry.list()] == ["First", "Second"]


def test_default_moves_on_when_removed(tmp_path):
    registry = PrinterRegistry(tmp_path / "test.sqlite3")
    registry.add("First", "ipp://printer-a/ipp/print")
    registry.add("Second", "ipp://printer-b/ipp/print")

    registry.remove("First")
    assert registry.default() is not None
    assert registry.default().name == "Second"


def test_same_name_cannot_be_used_twice(tmp_path):
    registry = PrinterRegistry(tmp_path / "test.sqlite3")
    registry.add("Labelprinter", "ipp://printer-a/ipp/print")
    with pytest.raises(PrintingError):
        registry.add("Labelprinter", "ipp://printer-b/ipp/print")


def test_unknown_printer_gives_an_error(tmp_path):
    registry = PrinterRegistry(tmp_path / "test.sqlite3")
    with pytest.raises(PrintingError):
        registry.require("does-not-exist")


# ---------------------------------------------- without a reachable printer
def test_list_is_empty_without_printers(client):
    body = client.get("/api/printers").json()
    assert body["printers"] == []


def test_health_counts_the_printers(client):
    body = client.get("/api/health").json()
    assert body["printers"] == 0


def test_unreachable_printer_is_not_added(client):
    """A printer that does not answer must not end up in the list."""
    response = client.post(
        "/api/printers",
        # TEST-NET-1 from RFC 5737: guaranteed not a printer.
        json={"name": "Labelprinter", "uri": "ipp://192.0.2.1:631/ipp/print"},
    )
    assert response.status_code in (422, 503)
    assert client.get("/api/printers").json()["printers"] == []


def test_wrong_scheme_is_refused(client):
    response = client.post("/api/printers", json={"name": "X", "uri": "socket://printer:9100"})
    assert response.status_code in (422, 503)


def test_printing_to_unknown_printer_says_so(client):
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()
    response = client.post(
        f"/api/documents/{doc['id']}/print",
        json={"printer": "Does-not-exist", "request_id": "one", "settings": {"copies": 1}},
    )
    assert response.status_code == 404


# ------------------------------------------------------------- duplicate work
def test_same_request_is_not_printed_twice(client, tmp_path):
    """A repeated submission returns the existing job."""
    doc = client.post("/api/documents", json={"brand": "Avery", "part": "5095"}).json()
    from glabels_web.api.deps import AppState  # noqa: PLC0415 - only for this test

    app_state: AppState = client.app.state.app_state
    app_state.store.record_print_request(
        "repeat", doc["id"], "Labelprinter", "ipp://192.0.2.1/ipp/print", 42, "Title"
    )

    response = client.post(
        f"/api/documents/{doc['id']}/print",
        json={"printer": "Labelprinter", "request_id": "repeat", "settings": {"copies": 1}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["duplicate"] is True
    assert body["job_id"] == 42


def test_client_reports_whether_the_tool_is_present():
    assert IppClient(tool="this-does-not-exist").available() is False


def test_unreachable_printer_gives_a_clean_probe(tmp_path):
    client = IppClient(timeout=3)
    if not client.available():
        pytest.skip("ipptool is missing in this environment")
    result = client.probe("ipp://192.0.2.1:631/ipp/print", timeout=2)
    assert result.reachable is False
    assert result.problems
