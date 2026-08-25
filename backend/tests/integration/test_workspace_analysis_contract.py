"""End-to-end contract for Workspace-owned Analysis lifecycle resources."""

from __future__ import annotations

import json
import shutil
import time
from io import BytesIO
from pathlib import Path
from typing import cast

import polars as pl
from fastapi.testclient import TestClient

from ldaca_wordflow.main import create_app
from ldaca_wordflow.settings import Settings


def _wait_analysis(
    client: TestClient,
    workspace_id: str,
    analysis_id: str,
) -> dict[str, object]:
    deadline = time.monotonic() + 15
    while True:
        detail = client.get(f"/api/workspaces/{workspace_id}/analyses/{analysis_id}")
        assert detail.status_code == 200, detail.text
        payload = detail.json()
        if payload["state"] in {"succeeded", "failed", "cancelled"}:
            return payload
        assert time.monotonic() < deadline
        time.sleep(0.05)


def test_quotation_preview_page_is_native_arrow_ipc(tmp_path: Path) -> None:
    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        upload = client.post(
            "/api/user-files/uploads",
            params={"path": "quotes.csv"},
            content='text,created_at\n"Alice said hello.",2020-10-16T22:02:13Z\n'.encode(),
            headers={**unsafe, "Content-Type": "application/octet-stream"},
        )
        assert upload.status_code == 201
        workspace_id = client.post(
            "/api/workspaces", json={"name": "Quotation IPC"}, headers=unsafe
        ).json()["id"]
        assert client.put(
            f"/api/workspaces/{workspace_id}/open", headers=unsafe
        ).status_code == 200
        node = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "quotes.csv"},
            headers=unsafe,
        ).json()
        tab = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "quotation", "name": "Quotation"},
            headers=unsafe,
        ).json()
        created = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab['id']}/analyses",
            json={
                "execution_scope": "preview",
                "request": {
                    "kind": "quotation",
                    "node_id": node["id"],
                    "column": "text",
                    "engine": {"type": "local"},
                },
            },
            headers=unsafe,
        )
        assert created.status_code == 201, created.text
        analysis_id = created.json()["id"]
        assert _wait_analysis(client, workspace_id, analysis_id)["state"] == "succeeded"

        marker = client.get(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result"
        )
        assert marker.json() == {"kind": "quotation", "ready": True}
        page = client.post(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/quotation-preview/query",
            json={"page": 1, "page_size": 1, "sort_by": None, "descending": False},
            headers=unsafe,
        )
        assert page.status_code == 200, page.text
        assert page.headers["content-type"] == "application/vnd.apache.arrow.stream"
        assert page.headers["x-wordflow-has-next"] == "false"
        assert page.headers["x-wordflow-total-rows"] == "1"
        frame = pl.read_ipc_stream(BytesIO(page.content))
        assert frame.columns == ["text", "created_at", "quotation"]
        quotation_dtype = frame.schema["quotation"]
        assert isinstance(quotation_dtype, pl.List)
        quotation_struct = quotation_dtype.inner
        assert isinstance(quotation_struct, pl.Struct)
        fields = {field.name: field.dtype for field in quotation_struct.fields}
        assert fields["speaker_start_idx"] == pl.Int64
        assert fields["quote_start_idx"] == pl.Int64

        removed_json = client.post(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/query",
            json={"kind": "quotation", "page": 1, "page_size": 1},
            headers=unsafe,
        )
        assert removed_json.status_code == 422


def test_sequential_analysis_is_owned_by_its_tab_and_workspace(tmp_path: Path) -> None:
    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        upload = client.post(
            "/api/user-files/uploads",
            params={"path": "timeline.csv"},
            content=b"time,value\n0,1\n1,2\n2,3\n",
            headers={**unsafe, "Content-Type": "application/octet-stream"},
        )
        assert upload.status_code == 201
        workspace = client.post(
            "/api/workspaces",
            json={"name": "Analysis contract"},
            headers=unsafe,
        ).json()
        workspace_id = workspace["id"]
        assert (
            client.put(
                f"/api/workspaces/{workspace_id}/open", headers=unsafe
            ).status_code
            == 200
        )
        node = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "timeline.csv"},
            headers=unsafe,
        ).json()
        tab = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "sequential", "name": "Timeline"},
            headers=unsafe,
        ).json()

        created = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab['id']}/analyses",
            json={
                "execution_scope": "run_all",
                "request": {
                    "kind": "sequential",
                    "node_id": node["id"],
                    "time_column": "time",
                    "column_type": "numeric",
                    "numeric_interval": 1,
                },
            },
            headers=unsafe,
        )
        assert created.status_code == 201, created.text
        analysis_id = created.json()["id"]
        assert created.json()["state"] == "queued"
        assert created.headers["location"] == (
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}"
        )

        detail_payload = _wait_analysis(client, workspace_id, analysis_id)
        assert detail_payload["state"] == "succeeded", detail_payload
        assert client.get(
            f"/api/workspaces/{workspace_id}/tabs/{tab['id']}/analyses"
        ).json() == [detail_payload]

        listing = client.get(f"/api/workspaces/{workspace_id}/analyses")
        assert listing.status_code == 200
        assert [item["id"] for item in listing.json()["items"]] == [analysis_id]

        result = client.get(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result"
        )
        assert result.status_code == 200, result.text
        result_payload = result.json()
        assert result_payload["kind"] == "sequential"
        assert result_payload["table"]["delivery"] == "complete"
        table_response = client.get(result_payload["table"]["url"])
        assert table_response.status_code == 200
        table = pl.read_ipc_stream(BytesIO(table_response.content))
        assert table.height > 0
        queried = client.post(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/query",
            json={"kind": "sequential", "page": 1, "page_size": 1},
            headers=unsafe,
        )
        assert queried.status_code == 422, queried.text

        cleared = client.delete(
            f"/api/workspaces/{workspace_id}/tabs/{tab['id']}/analyses",
            headers=unsafe,
        )
        assert cleared.status_code == 204
        assert cleared.content == b""
        assert (
            client.get(
                f"/api/workspaces/{workspace_id}/tabs/{tab['id']}/analyses"
            ).json()
            == []
        )


def test_analysis_artifacts_publish_under_the_analysis_directory(
    tmp_path: Path,
) -> None:
    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        assert (
            client.post(
                "/api/user-files/uploads",
                params={"path": "words.csv"},
                content=b"text\nhello world hello\nworld again\n",
                headers={**unsafe, "Content-Type": "application/octet-stream"},
            ).status_code
            == 201
        )
        workspace_id = client.post(
            "/api/workspaces",
            json={"name": "Artifact ownership"},
            headers=unsafe,
        ).json()["id"]
        assert (
            client.put(
                f"/api/workspaces/{workspace_id}/open", headers=unsafe
            ).status_code
            == 200
        )
        node_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "words.csv"},
            headers=unsafe,
        ).json()["id"]
        tab_id = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "token_frequency", "name": "Tokens"},
            headers=unsafe,
        ).json()["id"]
        created = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
            json={
                "execution_scope": "run_all",
                "request": {
                    "kind": "token_frequency",
                    "node_ids": [node_id],
                    "node_columns": {node_id: "text"},
                    "node_tokenizer_models": {node_id: "native:plain_words_en"},
                },
            },
            headers=unsafe,
        )
        assert created.status_code == 201, created.text
        analysis_id = created.json()["id"]
        terminal = _wait_analysis(client, workspace_id, analysis_id)
        assert terminal["state"] == "succeeded", terminal

        analysis_dir = tmp_path / "workspaces" / workspace_id / "analyses" / analysis_id
        assert not (analysis_dir / ".execution").exists()
        assert any((analysis_dir / "artifacts").iterdir())

        workspace_payload = json.loads(
            (tmp_path / "workspaces" / workspace_id / "workspace.json").read_text()
        )
        reference = next(
            item for item in workspace_payload["analyses"] if item["id"] == analysis_id
        )
        record_text = (
            tmp_path / "workspaces" / workspace_id / reference["record_path"]
        ).read_text()
        assert str(tmp_path) not in record_text
        record = json.loads(record_text)
        assert record["artifact_references"]

        result = client.get(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result"
        )
        assert result.status_code == 200, result.text
        payload = result.json()
        assert payload["kind"] == "token_frequency"
        assert "analysis_params" not in payload
        assert "stop_words" not in payload
        assert "token_limit" not in payload
        table_url = payload["tables"]["nodes"][0]["table"]["url"]
        assert table_url.startswith(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/"
        )
        download = client.get(table_url)
        assert download.status_code == 200
        assert pl.read_ipc_stream(BytesIO(download.content)).height > 0

        artifact_path = analysis_dir / record["artifact_references"][0]["relative_path"]
        artifact_path.unlink()
        gone = client.get(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result"
        )
        assert gone.status_code == 410
        assert gone.json()["code"] == "artifact_gone"

        assert (
            client.delete(
                f"/api/workspaces/{workspace_id}/nodes/{node_id}",
                headers=unsafe,
            ).status_code
            == 204
        )
        invalid = client.get(f"/api/workspaces/{workspace_id}/analyses/{analysis_id}")
        assert invalid.status_code == 200
        assert invalid.json()["integrity"] == {
            "status": "invalid",
            "code": "analysis_input_missing",
            "missing_input_ids": [node_id],
        }
        unusable = client.get(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result"
        )
        assert unusable.status_code == 410
        assert unusable.json()["code"] == "analysis_input_missing"


def test_concordance_result_uses_the_completed_analysis_snapshot(
    tmp_path: Path,
) -> None:
    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        assert (
            client.post(
                "/api/user-files/uploads",
                params={"path": "documents.csv"},
                content=b"text\nhello first\nhello second\n",
                headers={**unsafe, "Content-Type": "application/octet-stream"},
            ).status_code
            == 201
        )
        workspace_id = client.post(
            "/api/workspaces",
            json={"name": "Stable concordance"},
            headers=unsafe,
        ).json()["id"]
        assert (
            client.put(
                f"/api/workspaces/{workspace_id}/open", headers=unsafe
            ).status_code
            == 200
        )
        node_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "documents.csv"},
            headers=unsafe,
        ).json()["id"]
        tab_id = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "concordance", "name": "Search"},
            headers=unsafe,
        ).json()["id"]
        created = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
            json={
                "execution_scope": "preview",
                "request": {
                    "kind": "concordance",
                    "node_ids": [node_id],
                    "node_columns": {node_id: "text"},
                    "search_word": "hello",
                },
            },
            headers=unsafe,
        )
        assert created.status_code == 201, created.text
        analysis_id = created.json()["id"]
        assert _wait_analysis(client, workspace_id, analysis_id)["state"] == "succeeded"

        before = client.post(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/query",
            json={"kind": "concordance", "page": 1, "page_size": 50},
            headers=unsafe,
        )
        assert before.status_code == 200, before.text
        before_payload = before.json()
        assert "analysis_params" not in before_payload
        assert "combinable" not in before_payload
        assert before_payload["sources"][0]["node_id"] == node_id
        assert before_payload["sources"][0]["result"]["pagination"]["result_count"] == 2

        edited = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{node_id}/edits",
            json={
                "kind": "replace",
                "source_column": "text",
                "pattern": "hello",
                "replacement": "goodbye",
                "output_column": "text",
            },
            headers=unsafe,
        )
        assert edited.status_code == 200, edited.text
        assert (
            client.delete(
                f"/api/workspaces/{workspace_id}/open", headers=unsafe
            ).status_code
            == 204
        )
        assert (
            client.put(
                f"/api/workspaces/{workspace_id}/open", headers=unsafe
            ).status_code
            == 200
        )

        after = client.post(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/query",
            json={"kind": "concordance", "page": 1, "page_size": 50},
            headers=unsafe,
        )
        assert after.status_code == 200, after.text
        assert after.json() == before_payload

        shutil.rmtree(
            tmp_path
            / "workspaces"
            / workspace_id
            / "analyses"
            / analysis_id
            / "query-input"
        )
        stored = client.get(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result"
        )
        assert stored.status_code == 200, stored.text
        assert stored.json()["ready"] is True
        assert stored.json()["sources"] is None

        unavailable = client.post(
            f"/api/workspaces/{workspace_id}/analyses/{analysis_id}/result/query",
            json={"kind": "concordance", "page": 1, "page_size": 1},
            headers=unsafe,
        )
        assert unavailable.status_code == 410, unavailable.text
        assert unavailable.json()["code"] == "analysis_result_unavailable"


def test_concordance_run_all_group_stores_results_without_publishing_nodes(
    tmp_path: Path,
) -> None:
    settings = Settings(
        data_root=tmp_path,
        multi_user=False,
        session_cookie_secure=False,
        cors_allowed_origins=("http://testserver",),
        trusted_hosts=("testserver",),
    )
    with TestClient(
        create_app(settings, serve_frontend=False),
        base_url="http://testserver",
    ) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        assert (
            client.post(
                "/api/user-files/uploads",
                params={"path": "documents.csv"},
                content=b"text,source\nhello world,A\nhello again,B\n",
                headers={**unsafe, "Content-Type": "application/octet-stream"},
            ).status_code
            == 201
        )
        workspace_id = client.post(
            "/api/workspaces",
            json={"name": "Child Analysis"},
            headers=unsafe,
        ).json()["id"]
        assert (
            client.put(
                f"/api/workspaces/{workspace_id}/open", headers=unsafe
            ).status_code
            == 200
        )
        first_node_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={
                "kind": "file",
                "file_path": "documents.csv",
                "name": "First source",
            },
            headers=unsafe,
        ).json()["id"]
        second_node_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={
                "kind": "file",
                "file_path": "documents.csv",
                "name": "Second source",
            },
            headers=unsafe,
        ).json()["id"]
        tab_id = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "concordance", "name": "Search"},
            headers=unsafe,
        ).json()["id"]
        preview_request = {
            "kind": "concordance",
            "node_ids": [first_node_id, second_node_id],
            "node_columns": {
                first_node_id: "text",
                second_node_id: "text",
            },
            "search_word": "hello",
        }
        root = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
            json={
                "execution_scope": "preview",
                "request": preview_request,
            },
            headers=unsafe,
        )
        assert root.status_code == 201, root.text
        root_id = root.json()["id"]
        assert _wait_analysis(client, workspace_id, root_id)["state"] == "succeeded"

        created = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
            json={
                "execution_scope": "run_all",
                "request": {
                    "kind": "concordance_run_all",
                    "source": preview_request,
                },
                "supersedes_analysis_ids": [root_id],
            },
            headers=unsafe,
        )
        assert created.status_code == 201, created.text
        group = created.json()
        group_id = group["id"]
        assert group["parent_analysis_id"] is None
        assert created.headers["location"] == (
            f"/api/workspaces/{workspace_id}/analyses/{group_id}"
        )
        terminal = _wait_analysis(client, workspace_id, group_id)
        assert terminal["state"] == "succeeded", terminal
        assert terminal["output_node_ids"] == []
        forest = client.get(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses"
        ).json()
        assert len(forest) == 3
        children = [item for item in forest if item["execution_scope"] == "supporting"]
        assert len(children) == 2
        assert all(item["parent_analysis_id"] == group_id for item in children)

        root_result = client.get(
            f"/api/workspaces/{workspace_id}/analyses/{group_id}/result"
        )
        assert root_result.status_code == 200, root_result.text
        assert root_result.json()["kind"] == "concordance_run_all"
        assert root_result.json()["result_type"] == "group"
        assert [
            source["analysis_id"] for source in root_result.json()["sources"]
        ] == [child["id"] for child in children]

        for child in children:
            result = client.get(
                f"/api/workspaces/{workspace_id}/analyses/{child['id']}/result"
            )
            assert result.status_code == 200, result.text
            payload = result.json()
            assert payload["kind"] == "concordance_run_all"
            assert payload["result_type"] == "source"
            assert payload["source"]["document_column"] == "text"
            assert payload["source"]["metadata_columns"] == ["source"]
            assert "CONC_matched_text" in payload["source"]["analysis_columns"]
            assert payload["source"]["table"]["delivery"] == "projected"
            page = client.get(
                payload["source"]["table"]["matches"]["rows_url"],
                params={"page": 1, "page_size": 20},
            )
            assert page.status_code == 200, page.text
            density = client.get(payload["source"]["table"]["density_url"])
            assert density.status_code == 200, density.text
            assert density.json()["document_count"] == 2
            assert density.json()["match_count"] == 2
            assert child["output_node_ids"] == []
            assert not (
                tmp_path
                / "workspaces"
                / workspace_id
                / "analyses"
                / child["id"]
                / "staged-output"
            ).exists()

        nodes = client.get(f"/api/workspaces/{workspace_id}/nodes")
        assert nodes.status_code == 200, nodes.text
        assert {node["id"] for node in nodes.json()} == {
            first_node_id,
            second_node_id,
        }
        invalid_creation = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
            json={
                "execution_scope": "supporting",
                "parent_analysis_id": group_id,
                "request": {
                    "kind": "concordance_match_data_block_creation",
                    "sources": [
                        {
                            "source_node_id": first_node_id,
                            "selected_columns": ["text", "CONC_matched_text"],
                            "new_node_name": "Valid first output",
                        },
                        {
                            "source_node_id": second_node_id,
                            "selected_columns": ["text", "missing"],
                            "new_node_name": "Invalid second output",
                        },
                    ],
                },
            },
            headers=unsafe,
        )
        assert invalid_creation.status_code == 201, invalid_creation.text
        invalid_terminal = _wait_analysis(
            client,
            workspace_id,
            invalid_creation.json()["id"],
        )
        assert invalid_terminal["state"] == "failed"
        unchanged_nodes = client.get(f"/api/workspaces/{workspace_id}/nodes")
        assert {node["id"] for node in unchanged_nodes.json()} == {
            first_node_id,
            second_node_id,
        }

        creation = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
            json={
                "execution_scope": "supporting",
                "parent_analysis_id": group_id,
                "request": {
                    "kind": "concordance_match_data_block_creation",
                    "sources": [
                        {
                            "source_node_id": first_node_id,
                            "selected_columns": [
                                "text",
                                "source",
                                "CONC_matched_text",
                            ],
                            "new_node_name": "First matches",
                        },
                        {
                            "source_node_id": second_node_id,
                            "selected_columns": ["text", "CONC_extraction"],
                            "new_node_name": "Second matches",
                        },
                    ],
                },
            },
            headers=unsafe,
        )
        assert creation.status_code == 201, creation.text
        published = _wait_analysis(
            client,
            workspace_id,
            creation.json()["id"],
        )
        assert published["state"] == "succeeded", published
        output_node_ids = cast(list[str], published["output_node_ids"])
        assert len(output_node_ids) == 2
        published_nodes = [
            client.get(
                f"/api/workspaces/{workspace_id}/nodes/{node_id}"
            ).json()
            for node_id in output_node_ids
        ]
        assert [node["name"] for node in published_nodes] == [
            "First matches",
            "Second matches",
        ]
        assert (
            client.delete(
                f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
                headers=unsafe,
            ).status_code
            == 204
        )
        for output_node_id in output_node_ids:
            assert (
                client.get(
                    f"/api/workspaces/{workspace_id}/nodes/{output_node_id}"
                ).status_code
                == 200
            )
