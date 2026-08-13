"""Strict Workspace-owned Tab resource and persistence contract."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
import zipfile

from fastapi.testclient import TestClient

from ldaca_wordflow.main import create_app
from ldaca_wordflow.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    return TestClient(
        create_app(
            Settings(
                data_root=tmp_path,
                multi_user=False,
                session_cookie_secure=False,
                cors_allowed_origins=("http://testserver",),
                trusted_hosts=("testserver",),
            ),
            serve_frontend=False,
        ),
        base_url="http://testserver",
    )


def _unsafe_headers(client: TestClient) -> dict[str, str]:
    csrf = client.get("/api/session").json()["csrf_token"]
    return {"Origin": "http://testserver", "X-CSRF-Token": csrf}


def _create_open_workspace(
    client: TestClient,
    unsafe: dict[str, str],
) -> tuple[str, int]:
    created = client.post(
        "/api/workspaces",
        json={"name": "Tabs"},
        headers=unsafe,
    )
    assert created.status_code == 201
    workspace_id = created.json()["id"]
    opened = client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe)
    assert opened.status_code == 200
    return workspace_id, opened.json()["revision"]


def test_tabs_are_open_workspace_children_with_exact_resources(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        created = client.post(
            "/api/workspaces",
            json={"name": "Closed"},
            headers=unsafe,
        ).json()
        workspace_id = created["id"]

        closed = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "concordance", "name": "Concordance"},
            headers=unsafe,
        )
        assert closed.status_code == 409
        assert closed.json()["code"] == "workspace_not_open"

        client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe)
        assert client.get(f"/api/workspaces/{workspace_id}/tabs").json() == []

        first = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "concordance", "name": "  Shared name  "},
            headers=unsafe,
        )
        assert first.status_code == 201
        tab = first.json()
        assert set(tab) == {
            "id",
            "kind",
            "name",
            "analysis_ids",
            "annotation_correction_columns",
            "stop_words",
            "topic_modeling_words_per_topic",
            "created_at",
            "modified_at",
            "revision",
        }
        assert tab["kind"] == "concordance"
        assert tab["name"] == "Shared name"
        assert tab["analysis_ids"] == []
        assert tab["annotation_correction_columns"] == {}
        assert tab["stop_words"] == []
        assert tab["topic_modeling_words_per_topic"] is None
        assert tab["created_at"] == tab["modified_at"]
        assert tab["revision"] == 1
        assert first.headers["Location"] == (
            f"/api/workspaces/{workspace_id}/tabs/{tab['id']}"
        )

        second = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "annotation", "name": "Shared name"},
            headers=unsafe,
        )
        assert second.status_code == 201

        listed = client.get(f"/api/workspaces/{workspace_id}/tabs")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()] == [tab["id"], second.json()["id"]]
        assert client.get(
            f"/api/workspaces/{workspace_id}/tabs/{tab['id']}"
        ).json() == tab


def test_tab_rename_is_normalized_and_no_op_is_not_persisted(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        workspace_id, initial_workspace_revision = _create_open_workspace(client, unsafe)
        created = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "token_frequency", "name": "Frequency"},
            headers=unsafe,
        ).json()
        after_create = client.get(f"/api/workspaces/{workspace_id}").json()
        assert after_create["revision"] == initial_workspace_revision + 1

        no_op = client.patch(
            f"/api/workspaces/{workspace_id}/tabs/{created['id']}",
            json={"name": "  Frequency  "},
            headers=unsafe,
        )
        assert no_op.status_code == 200
        assert no_op.json() == created
        assert client.get(f"/api/workspaces/{workspace_id}").json()["revision"] == (
            after_create["revision"]
        )

        renamed = client.patch(
            f"/api/workspaces/{workspace_id}/tabs/{created['id']}",
            json={"name": "Renamed"},
            headers=unsafe,
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Renamed"
        assert renamed.json()["revision"] == 2
        assert renamed.json()["modified_at"] > created["modified_at"]
        assert client.get(f"/api/workspaces/{workspace_id}").json()["revision"] == (
            after_create["revision"] + 1
        )


def test_tab_validation_and_addressable_deletion_are_strict(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        workspace_id, _ = _create_open_workspace(client, unsafe)
        collection = f"/api/workspaces/{workspace_id}/tabs"

        for body in (
            {"kind": "unknown", "name": "No"},
            {"kind": "concordance", "name": "\u0000bad"},
            {"kind": "concordance", "name": "   "},
            {"kind": "concordance", "name": "Valid", "position": 1},
        ):
            assert client.post(collection, json=body, headers=unsafe).status_code == 422

        created = client.post(
            collection,
            json={"kind": "sequential", "name": "Delete me"},
            headers=unsafe,
        ).json()
        resource = f"{collection}/{created['id']}"
        deleted = client.delete(resource, headers=unsafe)
        assert deleted.status_code == 204
        assert deleted.content == b""
        assert client.get(resource).status_code == 404
        repeated = client.delete(resource, headers=unsafe)
        assert repeated.status_code == 404
        assert repeated.json()["code"] == "tab_not_found"


def test_tab_presentation_settings_are_normalized_and_kind_scoped(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        workspace_id, _ = _create_open_workspace(client, unsafe)
        collection = f"/api/workspaces/{workspace_id}/tabs"
        topic = client.post(
            collection,
            json={"kind": "topic_modeling", "name": "Topics"},
            headers=unsafe,
        ).json()
        assert topic["topic_modeling_words_per_topic"] == 15

        updated = client.patch(
            f"{collection}/{topic['id']}",
            json={
                "stop_words": [" The ", "and", "THE", ""],
                "topic_modeling_words_per_topic": 32,
            },
            headers=unsafe,
        )
        assert updated.status_code == 200
        assert updated.json()["stop_words"] == ["the", "and"]
        assert updated.json()["topic_modeling_words_per_topic"] == 32
        cleared = client.delete(
            f"{collection}/{topic['id']}/analyses",
            headers=unsafe,
        )
        assert cleared.status_code == 204
        preserved = client.get(f"{collection}/{topic['id']}").json()
        assert preserved["stop_words"] == ["the", "and"]
        assert preserved["topic_modeling_words_per_topic"] == 32

        concordance = client.post(
            collection,
            json={"kind": "concordance", "name": "Concordance"},
            headers=unsafe,
        ).json()
        assert client.patch(
            f"{collection}/{concordance['id']}",
            json={"stop_words": []},
            headers=unsafe,
        ).status_code == 400
        assert client.patch(
            f"{collection}/{concordance['id']}",
            json={"topic_modeling_words_per_topic": 15},
            headers=unsafe,
        ).status_code == 400


def test_tab_persists_across_close_and_invalid_record_is_isolated(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        workspace_id, _ = _create_open_workspace(client, unsafe)
        created = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "topic_modeling", "name": "Persistent"},
            headers=unsafe,
        ).json()
        assert client.delete(
            f"/api/workspaces/{workspace_id}/open",
            headers=unsafe,
        ).status_code == 204

        snapshot_path = tmp_path / "workspaces" / workspace_id / "workspace.json"
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        tab_reference = snapshot["tabs"][0]
        tab_path = snapshot_path.parent / tab_reference["record_path"]
        tab_path.write_text("not json", encoding="utf-8")

        listed = client.get("/api/workspaces")
        assert [item["id"] for item in listed.json()] == [workspace_id]
        assert client.get(f"/api/workspaces/{workspace_id}").status_code == 200

        reopened = client.put(f"/api/workspaces/{workspace_id}/open", headers=unsafe)
        assert reopened.status_code == 500
        assert reopened.json()["code"] == "tab_corrupt"
        assert reopened.json()["details"] == {"tab_id": created["id"]}

        deleted = client.delete(f"/api/workspaces/{workspace_id}", headers=unsafe)
        assert deleted.status_code == 204


def test_workspace_archive_round_trip_preserves_tabs(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        unsafe = _unsafe_headers(client)
        workspace_id, _ = _create_open_workspace(client, unsafe)
        original = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "quotation", "name": "Portable tab"},
            headers=unsafe,
        ).json()

        exported = client.get(f"/api/workspaces/{workspace_id}/archive")
        assert exported.status_code == 200
        with zipfile.ZipFile(BytesIO(exported.content)) as archive:
            manifest = json.loads(archive.read("workspace/workspace.json"))
        assert manifest["tabs"] == [
            {
                "id": original["id"],
                "kind": "quotation",
                "name": "Portable tab",
                "analysis_ids": [],
                "annotation_correction_columns": {},
                "stop_words": [],
                "topic_modeling_words_per_topic": None,
                "created_at": original["created_at"],
                "modified_at": original["modified_at"],
                "revision": 1,
            }
        ]

        imported = client.post(
            "/api/workspaces/imports?filename=tabs.zip",
            content=exported.content,
            headers={**unsafe, "Content-Type": "application/octet-stream"},
        )
        assert imported.status_code == 201
        imported_id = imported.json()["id"]
        assert client.put(
            f"/api/workspaces/{imported_id}/open", headers=unsafe
        ).status_code == 200
        restored = client.get(f"/api/workspaces/{imported_id}/tabs")
        assert restored.status_code == 200
        assert restored.json() == [original]
