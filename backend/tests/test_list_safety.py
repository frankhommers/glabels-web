"""What went wrong once must not lose rows again: rows without an id, the
buttons that change every row, and files a list cannot save unchanged."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from glabels_web import settings as settings_module
from glabels_web.documents import merge_list
from glabels_web.main import create_app


@pytest.fixture()
def env(tmp_path, templates_dir, monkeypatch):
    folder = tmp_path / "shared"
    monkeypatch.setenv("GLW_SYSTEM_TEMPLATES_DIR", str(templates_dir))
    monkeypatch.setenv("GLW_USER_TEMPLATES_DIR", str(tmp_path / "own"))
    monkeypatch.setenv("GLW_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GLW_FILES_DIR", str(folder))
    settings_module.reset_settings_cache()
    with TestClient(create_app()) as client:
        yield client, folder
    settings_module.reset_settings_cache()


def _label_with_source(client, folder, text: str) -> str:
    (folder / "merges").mkdir(parents=True, exist_ok=True)
    (folder / "merges" / "jacks.tsv").write_text(text)
    doc = client.post("/api/documents", json={"name": "Jacks", "brand": "Dymo", "part": "30252"}).json()
    content = doc["content"]
    content["objects"] = [{"type": "text", "x_pt": 5, "y_pt": 5, "w_pt": 200, "h_pt": 20, "lines": ["${Jack}"]}]
    client.put(f"/api/documents/{doc['id']}", json={"content": content})
    assert client.put(
        f"/api/documents/{doc['id']}/merge", json={"type": "Text/Tab/Line1Keys", "source_path": "merges/jacks.tsv"}
    ).status_code == 200
    return doc["id"]


def test_rows_without_an_id_keep_the_same_id_between_reads(env):
    client, folder = env
    doc = _label_with_source(client, folder, "Jack\nA\nB\nC\n")
    first = client.get(f"/api/documents/{doc}/list").json()["rows"]
    again = client.get(f"/api/documents/{doc}/list").json()["rows"]
    assert [row["id"] for row in first] == [row["id"] for row in again]

    changed = client.put(f"/api/documents/{doc}/list/rows/{first[1]['id']}", json={"values": {"Jack": "B2"}})
    assert changed.status_code == 200
    assert [row["values"]["Jack"] for row in changed.json()["rows"]] == ["A", "B2", "C"]


def test_a_row_that_changed_elsewhere_is_not_found_rather_than_another_changed(env):
    client, folder = env
    doc = _label_with_source(client, folder, "Jack\nA\nB\n")
    rows = client.get(f"/api/documents/{doc}/list").json()["rows"]
    (folder / "merges" / "jacks.tsv").write_text("Jack\nNew\nA\nB\n")  # a row put in front

    assert client.put(f"/api/documents/{doc}/list/rows/{rows[0]['id']}", json={"values": {"Jack": "X"}}).status_code == 404
    assert (folder / "merges" / "jacks.tsv").read_text() == "Jack\nNew\nA\nB\n"


def test_clearing_printed_rows_keeps_the_earlier_version(env):
    client, folder = env
    doc = _label_with_source(client, folder, "Jack\nA\nB\n")
    client.post(f"/api/documents/{doc}/list/printed", json={"printed": True})
    cleared = client.post(f"/api/documents/{doc}/list/clear-printed").json()
    assert cleared["rows"] == []

    versions = client.get("/api/files/versions", params={"path": "merges/jacks.tsv"}).json()
    assert len(versions) == 2  # before marking, before clearing
    oldest = client.get(
        "/api/files/table", params={"path": "merges/jacks.tsv", "version": versions[-1]["id"]}
    ).json()
    assert oldest["rows"] == [["Jack"], ["A"], ["B"]]

    # Saving that version puts it back.
    restored = client.put(
        "/api/files/table",
        json={"path": "merges/jacks.tsv", "delimiter": "\t", "rows": oldest["rows"], "sha256": oldest["sha256"]},
    )
    assert restored.status_code == 200
    assert (folder / "merges" / "jacks.tsv").read_text() == "Jack\nA\nB\n"


def test_deleting_a_data_file_keeps_it(env):
    client, folder = env
    (folder / "merges").mkdir(parents=True)
    (folder / "merges" / "a.csv").write_text("x\n1\n")
    assert client.delete("/api/files", params={"path": "merges/a.csv"}).status_code == 204
    versions = client.get("/api/files/versions", params={"path": "merges/a.csv"}).json()
    assert len(versions) == 1


def test_saving_the_same_content_keeps_no_version(env):
    client, folder = env
    (folder / "merges").mkdir(parents=True)
    (folder / "merges" / "a.csv").write_text("x\n1\n")
    table = client.get("/api/files/table", params={"path": "merges/a.csv"}).json()
    client.put("/api/files/table", json={**table, "sha256": table["sha256"]})
    assert client.get("/api/files/versions", params={"path": "merges/a.csv"}).json() == []


@pytest.mark.parametrize(
    "text",
    [
        "Jack\tJack\nA\tB\n",  # the same name twice
        "Jack\t\nA\tB\n",  # a column with values but no name
        "Jack\nA\tB\n",  # values past the last name
    ],
)
def test_a_file_a_list_would_save_with_values_missing_is_no_list(env, text):
    client, folder = env
    doc = _label_with_source(client, folder, text)
    listed = client.get(f"/api/documents/{doc}/list").json()
    assert (listed["available"], listed["reason"]) == (False, "columns-without-name")
    assert client.post(f"/api/documents/{doc}/list/rows", json={"values": {"Jack": "C"}}).status_code == 409
    assert (folder / "merges" / "jacks.tsv").read_text() == text


def test_an_empty_cell_past_the_names_is_fine():
    parsed = merge_list.parse(b"Jack\nA\t\n", "Text/Tab/Line1Keys")
    assert [row.values for row in parsed.rows] == [{"Jack": "A"}]


def test_versions_of_the_last_month_are_all_kept(tmp_path, monkeypatch):
    from glabels_web.files import store

    area = store.FileArea(tmp_path / "shared", tmp_path / "history")
    area.ensure()
    monkeypatch.setattr(store, "KEEP_AT_LEAST", 3)
    for number in range(8):
        area.write_file("a.csv", f"x\n{number}\n".encode())
    assert len(area.versions("a.csv")) == 7  # all recent, though more than 3

    folder = tmp_path / "history" / "a.csv"
    for index, item in enumerate(sorted(folder.iterdir())[:5]):
        item.rename(folder / f"2020010{index}T000000.000000Z")  # make five old
    area.write_file("a.csv", b"x\nlast\n")
    # The old ones go, as long as at least three stay.
    assert len(area.versions("a.csv")) == 3
