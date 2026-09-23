"""Print job history: final state, paging, cleaning up."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.main import create_app
from glabels_web.printing import PrintingError
from glabels_web.printing.ipp_client import JobStatus

URI = "ipp://printer.test/ipp/print"
DOC = "00000000-0000-0000-0000-000000000001"


class FakePrinter:
    """Counts how often a job is asked about."""

    def __init__(self):
        self.status: dict[int, int] = {}
        self.asked: list[int] = []
        self.unreachable = False

    def job_status(self, uri, job_id):
        self.asked.append(job_id)
        if self.unreachable:
            raise PrintingError("printer does not respond")
        code = self.status.get(job_id, 3)
        name = {3: "pending", 5: "processing", 7: "canceled", 9: "completed"}[code]
        return JobStatus(job_id=job_id, state=name, state_code=code)


@pytest.fixture()
def env(tmp_path, templates_dir, monkeypatch):
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "eigen"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as client:
        state = client.app.state.app_state
        printer = FakePrinter()
        monkeypatch.setattr(state.printers, "job_status", printer.job_status)
        yield client, state.store, printer
    settings_module.reset_settings_cache()


def _job(store, number: int, *, minutes_ago: int = 0):
    store.record_print_request(f"request-{number}", DOC, "Dymo", URI, number, f"Label {number}")
    if minutes_ago:
        moment = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat(
            timespec="seconds"
        )
        with sqlite3.connect(store._db_path) as conn:
            conn.execute(
                "UPDATE print_requests SET created_at = ? WHERE request_id = ?",
                (moment, f"request-{number}"),
            )


def test_final_state_is_remembered(env):
    client, store, printer = env
    _job(store, 1)
    printer.status[1] = 5

    first = client.get("/api/printers/jobs").json()["items"][0]
    assert (first["state_code"], first["active"], first["finished"]) == (5, True, False)

    printer.status[1] = 9
    done = client.get("/api/printers/jobs").json()["items"][0]
    assert (done["state"], done["active"], done["finished"]) == ("completed", False, True)

    # After that, do not ask the printer again.
    printer.asked.clear()
    again = client.get("/api/printers/jobs").json()["items"][0]
    assert again["state"] == "completed"
    assert printer.asked == []


def test_paging(env):
    client, store, printer = env
    for number in range(1, 26):
        _job(store, number, minutes_ago=100 - number)
        printer.status[number] = 9

    first = client.get("/api/printers/jobs", params={"limit": 10}).json()
    assert first["total"] == 25
    assert [item["job_id"] for item in first["items"]] == list(range(25, 15, -1))

    last = client.get("/api/printers/jobs", params={"limit": 10, "offset": 20}).json()
    assert [item["job_id"] for item in last["items"]] == [5, 4, 3, 2, 1]


def test_unreachable_printer_is_tried_once(env):
    client, store, printer = env
    for number in range(1, 6):
        _job(store, number)
    printer.unreachable = True

    items = client.get("/api/printers/jobs").json()["items"]
    assert all(item["state"] == "unknown" for item in items)
    assert len(printer.asked) == 1


def test_clean_up_leaves_running_jobs(env):
    client, store, printer = env
    _job(store, 1)
    _job(store, 2)
    _job(store, 3, minutes_ago=120)  # never finished, printer gone
    printer.status.update({1: 9, 2: 5})
    client.get("/api/printers/jobs")  # records the final state of 1

    removed = client.post("/api/printers/jobs/clear").json()["removed"]
    assert removed == 2
    remaining = client.get("/api/printers/jobs").json()["items"]
    assert [item["job_id"] for item in remaining] == [2]


def test_automatic_cleanup(env):
    client, store, printer = env
    _job(store, 1, minutes_ago=31 * 24 * 60)  # older than 30 days
    for number in range(2, 110):
        _job(store, number, minutes_ago=200 - number)
        store.finish_print_request(f"request-{number}", 9, "")
    _job(store, 999)  # still running

    body = client.get("/api/printers/jobs", params={"limit": 1}).json()
    # The 100 newest jobs stay, the running one included; the rest and
    # everything older than 30 days is gone.
    assert body["total"] == 100
    assert store.find_print_request("request-1") is None
    assert store.find_print_request("request-10") is None
    assert store.find_print_request("request-11") is not None
    assert store.find_print_request("request-999") is not None
