"""Which printers a label fits: from the sizes a printer reports, or set by hand."""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app
from glabels_web.printing import PrinterRegistry, ProbeResult

MM = 72 / 25.4

TAPE = ["custom_12.14x50.8mm_12.14x50.8mm", "custom_min_1.41x5.64mm", "custom_max_18.06x1411.11mm"]
LABELS = ["custom_27.86x88.9mm_27.86x88.9mm", "custom_54.19x22.27mm_54.19x22.27mm"]


class FakePrinters:
    """Answers like printers would, without a network."""

    tool = "ipptool"

    def __init__(self, media: dict[str, list[str]]):
        self.media = media
        self.asked: list[str] = []

    def available(self) -> bool:
        return True

    def probe(self, uri: str, *, timeout: int = 8) -> ProbeResult:
        self.asked.append(uri)
        if uri not in self.media:
            return ProbeResult(reachable=False, uri=uri, problems=["no answer"])
        return ProbeResult(reachable=True, uri=uri, accepting=True, accepts_pdf=True, media=self.media[uri])


@pytest.fixture()
def client(tmp_path, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_BUILTIN_FONTS_DIR", str(templates_dir.parent / "fonts"))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "user-templates"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as test_client:
        app_state = test_client.app.state.app_state
        app_state.printers = FakePrinters({"ipp://tape/ipp/print": TAPE, "ipp://labels/ipp/print": LABELS})
        app_state.registry.add("Tape", "ipp://tape/ipp/print")
        app_state.registry.add("Labels", "ipp://labels/ipp/print")
        app_state.registry.add("Away", "ipp://away/ipp/print")
        yield test_client
    settings_module.reset_settings_cache()


def fit(client, width_mm, height_mm, *, continuous=False, status="false"):
    printers = client.get(
        "/api/printers",
        params={
            "status": status,
            "page_width_pt": width_mm * MM,
            "page_height_pt": height_mm * MM,
            "continuous": str(continuous).lower(),
        },
    ).json()["printers"]
    return {printer["name"]: printer["fit"] for printer in printers}


def test_a_tape_fits_the_tape_printer_only(client):
    assert fit(client, 12, 70, continuous=True) == {"Tape": "yes", "Labels": "no", "Away": "unknown"}


def test_an_address_label_fits_the_label_printer_only(client):
    assert fit(client, 28, 89) == {"Tape": "no", "Labels": "yes", "Away": "unknown"}


def test_the_sizes_are_remembered(client):
    fake = client.app.state.app_state.printers
    fit(client, 28, 89)
    asked = len(fake.asked)
    fit(client, 12, 70, continuous=True)
    # Only the printer that never answered is asked again.
    assert fake.asked[asked:] == ["ipp://away/ipp/print"]


def test_without_a_page_there_is_no_verdict(client):
    printers = client.get("/api/printers", params={"status": "false"}).json()["printers"]
    assert {printer["fit"] for printer in printers} == {""}
    assert client.app.state.app_state.printers.asked == []


def test_asking_the_state_also_learns_the_sizes(client):
    assert fit(client, 28, 89, status="true")["Labels"] == "yes"


def test_set_by_hand(client):
    response = client.put("/api/printers/Away/takes", json={"takes": "continuous"})
    assert response.status_code == 200
    assert response.json()["takes"] == "continuous"
    assert fit(client, 12, 70, continuous=True)["Away"] == "yes"
    assert fit(client, 28, 89)["Away"] == "no"

    client.put("/api/printers/Labels/takes", json={"takes": "any"})
    assert fit(client, 12, 70, continuous=True)["Labels"] == "yes"


def test_set_by_hand_refuses_nonsense(client):
    assert client.put("/api/printers/Away/takes", json={"takes": "everything"}).status_code == 422
    assert client.put("/api/printers/Nobody/takes", json={"takes": "any"}).status_code == 404


def test_an_older_database_gets_the_new_columns(tmp_path):
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE printers (name TEXT PRIMARY KEY, uri TEXT NOT NULL, info TEXT NOT NULL DEFAULT '', "
            "location TEXT NOT NULL DEFAULT '', is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"
        )
        conn.execute("INSERT INTO printers VALUES ('Old', 'ipp://old/ipp/print', '', '', 1, 'then')")

    registry = PrinterRegistry(path)
    old = registry.require("Old")
    assert (old.media, old.takes) == ((), "auto")
    registry.set_media("Old", LABELS)
    assert registry.require("Old").media == tuple(LABELS)
