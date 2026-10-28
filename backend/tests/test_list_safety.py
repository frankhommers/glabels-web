"""What went wrong once must not lose rows again: rows without an id, and
files a list cannot save unchanged."""

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


def test_a_changed_source_of_the_same_length_gives_another_preview_key(env):
    import os

    from glabels_web.api.routes_documents import source_snapshot

    client, folder = env
    doc = _label_with_source(client, folder, "Jack\nRood\n")
    state = client.app.state.app_state
    info = state.store.info(doc)
    path = folder / "merges" / "jacks.tsv"
    stamp = path.stat().st_mtime

    first, key = source_snapshot(state, doc, info)
    path.write_text("Jack\nRoos\n")  # same length, same second
    os.utime(path, (stamp, stamp))
    second, other = source_snapshot(state, doc, info)

    assert key != other
    assert first.read_text() == "Jack\nRood\n" and second.read_text() == "Jack\nRoos\n"
    assert source_snapshot(state, doc, info)[1] == other
