"""A label's list: rows added from anywhere, printed when you like."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.api.routes_printers import settle_list_prints
from glabels_web.main import create_app
from glabels_web.printing.ipp_client import JobStatus

URI = "ipp://printer.test/ipp/print"


class FakePrinter:
    def __init__(self):
        self.status: dict[int, int] = {}

    def job_status(self, uri, job_id):
        code = self.status.get(job_id, 3)
        name = {3: "pending", 5: "processing", 8: "aborted", 9: "completed"}[code]
        return JobStatus(job_id=job_id, state=name, state_code=code)


@pytest.fixture()
def env(tmp_path, templates_dir, monkeypatch):
    folder = tmp_path / "shared"
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "own"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_FILES_DIR", str(folder))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as client:
        state = client.app.state.app_state
        printer = FakePrinter()
        monkeypatch.setattr(state.printers, "job_status", printer.job_status)
        yield client, state, printer, folder
    settings_module.reset_settings_cache()


def _label(client, *lines: str, name: str = "Books") -> str:
    doc = client.post("/api/documents", json={"name": name, "brand": "Dymo", "part": "30252"}).json()
    content = doc["content"]
    content["objects"] = [
        {"type": "text", "x_pt": 5, "y_pt": 5 + 20 * i, "w_pt": 200, "h_pt": 20, "lines": [line]}
        for i, line in enumerate(lines)
    ]
    assert client.put(f"/api/documents/{doc['id']}", json={"content": content}).status_code == 200
    return doc["id"]


def test_a_label_without_fields_has_no_list(env):
    client, _state, _printer, _folder = env
    doc = _label(client, "Just text")
    listed = client.get(f"/api/documents/{doc}/list").json()
    assert (listed["available"], listed["reason"]) == (False, "no-fields")
    assert client.post(f"/api/documents/{doc}/list/rows", json={"values": {"a": "b"}}).status_code == 409


def test_rows_build_up_a_source_desktop_glabels_can_read(env):
    client, _state, _printer, folder = env
    doc = _label(client, "${subject}", "${title:=untitled}")

    empty = client.get(f"/api/documents/{doc}/list").json()
    assert empty["available"] and empty["fields"] == ["subject", "title"] and empty["rows"] == []

    first = client.post(f"/api/documents/{doc}/list/rows", json={"values": {"subject": "Maths", "title": "Book 1"}})
    assert first.status_code == 201, first.text
    listed = client.post(
        f"/api/documents/{doc}/list/rows", json={"values": {"subject": "Dutch"}, "copies": 3}
    ).json()
    assert listed["source_path"] == "merges/Books.tsv"
    assert (listed["pending_rows"], listed["pending_labels"]) == (2, 4)

    # The label is linked to it the way the desktop app links a source ...
    detail = client.get(f"/api/documents/{doc}").json()
    assert detail["merge"] == {**detail["merge"], "type": "Text/Tab/Line1Keys", "src": "merges/Books.tsv", "available": True}
    # ... and it is an ordinary tab separated file with field names first.
    lines = (folder / "merges" / "Books.tsv").read_text().splitlines()
    assert lines[0] == "subject\ttitle\t_id\t_copies\t_printed"
    assert lines[1].startswith("Maths\tBook 1\t") and lines[2].startswith("Dutch\t\t")
    # The merge preview reads it like any other source.
    assert client.get(f"/api/documents/{doc}/merge").json()["record_count"] == 2


def test_rows_change_get_marked_and_cleared(env):
    client, _state, _printer, _folder = env
    doc = _label(client, "${name}")
    for name in ("Ada", "Bob", "Cy"):
        listed = client.post(f"/api/documents/{doc}/list/rows", json={"values": {"name": name}}).json()
    ada, bob, cy = (row["id"] for row in listed["rows"])

    changed = client.put(f"/api/documents/{doc}/list/rows/{bob}", json={"values": {"name": "Bobby"}, "copies": 2}).json()
    assert [(r["values"]["name"], r["copies"]) for r in changed["rows"]] == [("Ada", 1), ("Bobby", 2), ("Cy", 1)]

    after = client.delete(f"/api/documents/{doc}/list/rows/{cy}").json()
    assert [r["id"] for r in after["rows"]] == [ada, bob]

    marked = client.put(f"/api/documents/{doc}/list/rows/{ada}", json={"printed": True}).json()
    assert marked["rows"][0]["printed"] and marked["pending_rows"] == 1
    everything = client.post(f"/api/documents/{doc}/list/printed", json={"printed": True}).json()
    assert everything["pending_rows"] == 0
    again = client.post(f"/api/documents/{doc}/list/printed", json={"printed": False, "ids": [bob]}).json()
    assert again["pending_rows"] == 1

    cleared = client.post(f"/api/documents/{doc}/list/clear-printed").json()
    assert [r["id"] for r in cleared["rows"]] == [bob]
    assert client.delete(f"/api/documents/{doc}/list/rows/unknown").status_code == 404


def test_an_existing_source_keeps_its_columns(env):
    client, _state, _printer, folder = env
    (folder / "merges").mkdir(parents=True)
    (folder / "merges" / "books.csv").write_text("subject,title,shelf\nMaths,Book 1,A\n")
    doc = _label(client, "${subject} ${title}")
    client.put(f"/api/documents/{doc}/merge", json={"type": "Text/Comma/Line1Keys", "source_path": "merges/books.csv"})

    listed = client.get(f"/api/documents/{doc}/list").json()
    assert listed["keys"] == ["subject", "title", "shelf"]
    assert listed["rows"][0]["values"] == {"subject": "Maths", "title": "Book 1", "shelf": "A"}
    client.post(f"/api/documents/{doc}/list/rows", json={"values": {"subject": "Art", "title": "Book 2"}})
    lines = (folder / "merges" / "books.csv").read_text().splitlines()
    # Still comma separated, the extra column kept, our columns at the end.
    assert lines[0] == "subject,title,shelf,_id,_copies,_printed"
    assert lines[2].startswith("Art,Book 2,,")


def test_a_source_without_field_names_cannot_be_a_list(env):
    client, _state, _printer, folder = env
    (folder / "plain.csv").parent.mkdir(parents=True, exist_ok=True)
    (folder / "plain.csv").write_text("Maths,Book 1\n")
    doc = _label(client, "${1}")
    client.put(f"/api/documents/{doc}/merge", json={"type": "Text/Comma", "source_path": "plain.csv"})
    assert client.get(f"/api/documents/{doc}/list").json()["reason"] == "needs-field-names"


def test_rows_are_marked_printed_when_their_job_completes(env):
    client, state, printer, _folder = env
    doc = _label(client, "${name}")
    for name in ("Ada", "Bob"):
        listed = client.post(f"/api/documents/{doc}/list/rows", json={"values": {"name": name}}).json()
    ids = [row["id"] for row in listed["rows"]]

    # A job with these rows was sent: they are on their way, not to print again.
    state.store.record_print_request("r1", doc, "Dymo", URI, 41, "Books", list_rows=ids)
    busy = client.get(f"/api/documents/{doc}/list").json()
    assert [row["printing"] for row in busy["rows"]] == [True, True]
    assert busy["pending_rows"] == 0

    # Still printing: nothing changes yet.
    printer.status[41] = 5
    settle_list_prints(state)
    assert client.get(f"/api/documents/{doc}/list").json()["rows"][0]["printed"] == ""

    # Completed: marked, found by the job list as well as by the watcher.
    printer.status[41] = 9
    client.get("/api/printers/jobs")
    done = client.get(f"/api/documents/{doc}/list").json()
    assert all(row["printed"] and not row["printing"] for row in done["rows"])


def test_a_failed_job_leaves_its_rows_to_print(env):
    client, state, printer, _folder = env
    doc = _label(client, "${name}")
    listed = client.post(f"/api/documents/{doc}/list/rows", json={"values": {"name": "Ada"}}).json()
    state.store.record_print_request("r2", doc, "Dymo", URI, 42, "Books", list_rows=[listed["rows"][0]["id"]])
    printer.status[42] = 8
    settle_list_prints(state)
    after = client.get(f"/api/documents/{doc}/list").json()
    assert after["rows"][0]["printed"] == "" and after["pending_rows"] == 1


def test_the_merge_preview_hides_the_lists_own_columns(env):
    client, _state, _printer, _folder = env
    doc = _label(client, "${name}")
    client.post(f"/api/documents/{doc}/list/rows", json={"values": {"name": "Ada"}})
    preview = client.get(f"/api/documents/{doc}/merge").json()
    assert preview["keys"] == ["name"] and preview["records"] == [{"name": "Ada"}]


def test_a_field_used_several_times_is_asked_once(env):
    client, _state, _printer, _folder = env
    # The same field on the lid and on two sides, once with a default value.
    doc = _label(client, "${box}", "${box} – ${contents}", "${box:=spare}")
    listed = client.get(f"/api/documents/{doc}/list").json()
    assert listed["fields"] == ["box", "contents"]
