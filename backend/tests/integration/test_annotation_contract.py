"""Workspace-owned Annotation Preview and Run All contracts."""

from __future__ import annotations

import time
from functools import partial
from io import BytesIO
from pathlib import Path
from typing import Any, cast

from anyio.to_thread import run_sync as run_sync_in_worker_thread
from fastapi.testclient import TestClient
import polars as pl

from ldaca_wordflow.infrastructure.providers.annotation_ai import AnnotationAllResult
from ldaca_wordflow.main import create_app
from ldaca_wordflow.services import analysis_executor as analysis_executor_module
from ldaca_wordflow.settings import Settings
from ldaca_wordflow.workers.entrypoints import analysis_process


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


def _wait(client: TestClient, workspace_id: str, analysis_id: str) -> dict[str, object]:
    deadline = time.monotonic() + 10
    while True:
        response = client.get(f"/api/workspaces/{workspace_id}/analyses/{analysis_id}")
        assert response.status_code == 200
        payload = response.json()
        if payload["state"] in {"succeeded", "failed", "cancelled"}:
            return payload
        assert time.monotonic() < deadline
        time.sleep(0.02)


def test_annotation_preview_is_durable_and_run_all_edits_the_source(
    tmp_path: Path,
    monkeypatch,
) -> None:
    run_all_retry_limits: list[int] = []
    run_all_batch_sizes: list[int] = []
    run_all_examples: list[list[tuple[str, str]]] = []
    preview_retry_limits: list[int] = []
    preview_examples: list[list[tuple[str, str]]] = []

    async def fake_annotate_all(
        request,
        _api_key,
        texts,
        **kwargs,
    ):
        run_all_retry_limits.append(request.source.max_retries_per_batch)
        run_all_batch_sizes.append(request.batch_size)
        run_all_examples.append(
            [(example.text, example.label) for example in kwargs["examples"]]
        )
        progress_callback = kwargs["progress_callback"]
        progress_callback(len(texts), len(texts), 1 if texts else 0)
        labels = [None if text == "document-2379" else "support" for text in texts]
        return AnnotationAllResult(
            labels=labels,
            failed_rows=[text == "document-2379" for text in texts],
            failed_batch_count=1 if texts else 0,
            failed_row_count=1 if texts else 0,
        )

    monkeypatch.setattr(
        "ldaca_wordflow.workers.annotation.annotate_all",
        fake_annotate_all,
    )

    async def fake_annotate_preview(
        request,
        _api_key,
        texts,
        examples,
    ):
        preview_retry_limits.append(request.max_retries_per_batch)
        preview_examples.append(
            [(example.text, example.label) for example in examples]
        )
        return ["support" for _ in texts]

    monkeypatch.setattr(
        "ldaca_wordflow.services.analysis_results.annotate_preview",
        fake_annotate_preview,
    )

    class _ProgressQueue:
        def __init__(self) -> None:
            self.items: list[object] = []

        def put(self, item: object) -> None:
            self.items.append(item)

    async def execute_in_process(_self, _key, invocation, report_progress):
        progress = _ProgressQueue()
        result = await run_sync_in_worker_thread(
            partial(
                analysis_process,
                invocation=invocation.input,
                progress_queue=cast(Any, progress),
            )
        )
        for item in progress.items:
            await report_progress(item)
        return result

    monkeypatch.setattr(
        analysis_executor_module.AnalysisProcessExecutor,
        "execute_reserved",
        execute_in_process,
    )
    with _client(tmp_path) as client:
        csrf = client.get("/api/session").json()["csrf_token"]
        unsafe = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
        for path, content in (
            (
                "documents.csv",
                b"text,stance,review,username\n"
                + b"".join(
                    (
                        f"document-{index},{'  critical  ' if index == 0 else ''},"
                        f"{'critical' if index == 0 else ''},"
                        f"candidate-{index % 133}\n"
                    ).encode()
                    for index in range(2380)
                ),
            ),
            (
                "candidates.csv",
                b"username,party\n"
                + b"".join(
                    f"candidate-{index},party-{index % 3}\n".encode()
                    for index in range(133)
                ),
            ),
            (
                "classes.csv",
                b"class,description\nsupport,supports the claim\ncritical,criticises the claim\n",
            ),
            (
                "examples.csv",
                b"text,class\n"
                b"support one,support\n"
                b"support two,support\n"
                b"support three,support\n"
                b"critical one,critical\n"
                b"critical two,critical\n"
                b"outside one,outside-codebook\n"
                b"blank label, \n"
                b" ,support\n",
            ),
        ):
            assert (
                client.post(
                    "/api/user-files/uploads",
                    params={"path": path},
                    content=content,
                    headers={**unsafe, "Content-Type": "application/octet-stream"},
                ).status_code
                == 201
            )
        workspace_id = client.post(
            "/api/workspaces", json={"name": "Annotations"}, headers=unsafe
        ).json()["id"]
        assert (
            client.put(
                f"/api/workspaces/{workspace_id}/open", headers=unsafe
            ).status_code
            == 200
        )
        source_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "documents.csv"},
            headers=unsafe,
        ).json()["id"]
        candidates_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "candidates.csv"},
            headers=unsafe,
        ).json()["id"]
        joined_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={
                "kind": "join",
                "left_node_id": source_id,
                "right_node_id": candidates_id,
                "left_on": "username",
                "right_on": "username",
                "how": "left",
                "name": "joined documents",
            },
            headers=unsafe,
        ).json()["id"]
        class_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "classes.csv"},
            headers=unsafe,
        ).json()["id"]
        example_id = client.post(
            f"/api/workspaces/{workspace_id}/nodes",
            json={"kind": "file", "file_path": "examples.csv"},
            headers=unsafe,
        ).json()["id"]
        configuration = client.post(
            "/api/provider-credentials/annotation-providers",
            json={"name": "OpenAI", "provider": "openai", "api_key": "provider-secret"},
            headers=unsafe,
        ).json()
        tab_id = client.post(
            f"/api/workspaces/{workspace_id}/tabs",
            json={"kind": "annotation", "name": "Document classes"},
            headers=unsafe,
        ).json()["id"]
        preview_request = {
            "kind": "annotation",
            "node_id": joined_id,
            "text_column": "text",
            "annotation_column": "stance",
            "correction_column": "review",
            "class_node_id": class_id,
            "class_column": "class",
            "description_column": "description",
            "example_node_id": example_id,
            "example_text_column": "text",
            "example_annotation_column": "class",
            "max_examples_per_class": 2,
            "example_sampling_method": "random",
            "example_random_seed": 0,
            "classes": [
                {"name": "support", "description": "supports the claim"},
                {"name": "critical", "description": "criticises the claim"},
            ],
            "provider_configuration_id": configuration["id"],
            "provider": "openai",
            "model": "test-model",
            "instruction": "Classify each document.",
            "max_retries_per_batch": 4,
        }
        preview = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
            json={
                "execution_scope": "preview",
                "request": preview_request,
            },
            headers=unsafe,
        )
        assert preview.status_code == 201, preview.text
        preview_id = preview.json()["id"]
        assert _wait(client, workspace_id, preview_id)["state"] == "succeeded"
        marker = client.get(
            f"/api/workspaces/{workspace_id}/analyses/{preview_id}/result"
        ).json()
        assert marker["kind"] == "annotation"
        assert marker["result"] == {"variant": "ready"}

        page_url = f"/api/workspaces/{workspace_id}/analyses/{preview_id}/result/query"
        first_page = client.post(
            page_url,
            json={"kind": "annotation", "page": 1, "page_size": 20},
            headers=unsafe,
        )
        second_page = client.post(
            page_url,
            json={"kind": "annotation", "page": 1, "page_size": 20},
            headers=unsafe,
        )
        assert first_page.status_code == 200, first_page.text
        assert second_page.status_code == 200, second_page.text
        assert first_page.json()["result"]["rows"] == second_page.json()["result"]["rows"]
        assert preview_retry_limits == [4, 4]
        assert preview_examples[0] == preview_examples[1]
        assert len(preview_examples[0]) == 5
        assert {label for _, label in preview_examples[0]} == {
            "support",
            "critical",
            "outside-codebook",
        }

        run_all = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
            json={
                "execution_scope": "run_all",
                "request": {
                    "kind": "annotation_run_all",
                    "source": preview_request,
                    "batch_size": 17,
                    "processing_mode": "fill_missing",
                },
            },
            headers=unsafe,
        )
        assert run_all.status_code == 201, run_all.text
        child = _wait(client, workspace_id, run_all.json()["id"])
        assert child["state"] == "succeeded", child
        assert run_all_retry_limits == [4]
        assert run_all_batch_sizes == [17]
        assert run_all_examples == [preview_examples[0]]
        assert child["output_node_ids"] == []
        run_all_result = client.get(
            f"/api/workspaces/{workspace_id}/analyses/{child['id']}/result"
        ).json()
        assert run_all_result["attempted_count"] == 2379
        assert run_all_result["failed_batch_count"] == 1
        assert run_all_result["failed_row_count"] == 1
        forest = client.get(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses"
        ).json()
        assert [item["id"] for item in forest] == [child["id"]]
        reviewed = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [joined_id],
                "sql": (
                    f'SELECT "text", "stance", "review" FROM "{joined_id}" '
                    "WHERE \"text\" IN ('document-0', 'document-1') "
                    'ORDER BY "text" ASC'
                ),
                "page": 1,
                "page_size": 2,
            },
            headers=unsafe,
        )
        assert reviewed.status_code == 200, reviewed.text
        assert pl.read_ipc_stream(BytesIO(reviewed.content)).to_dicts() == [
            {
                "text": "document-0",
                "stance": "  critical  ",
                "review": "critical",
            },
            {"text": "document-1", "stance": "support", "review": None},
        ]

        restarted = client.post(
            f"/api/workspaces/{workspace_id}/tabs/{tab_id}/analyses",
            json={
                "execution_scope": "run_all",
                "request": {
                    "kind": "annotation_run_all",
                    "source": preview_request,
                    "batch_size": 17,
                    "processing_mode": "reprocess_all",
                },
            },
            headers=unsafe,
        )
        assert restarted.status_code == 201, restarted.text
        assert (
            _wait(client, workspace_id, restarted.json()["id"])["state"] == "succeeded"
        )
        assert run_all_examples == [preview_examples[0], preview_examples[0]]
        reviewed_after_restart = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [joined_id],
                "sql": (
                    f'SELECT "text", "stance", "review" FROM "{joined_id}" '
                    "WHERE \"text\" = 'document-0'"
                ),
                "page": 1,
                "page_size": 1,
            },
            headers=unsafe,
        )
        assert pl.read_ipc_stream(
            BytesIO(reviewed_after_restart.content)
        ).to_dicts() == [
            {"text": "document-0", "stance": "support", "review": "critical"}
        ]
        partial_row = client.post(
            f"/api/workspaces/{workspace_id}/sql",
            json={
                "mode": "query",
                "node_ids": [joined_id],
                "sql": (
                    f'SELECT "text", "stance" FROM "{joined_id}" '
                    "WHERE \"text\" = 'document-2379'"
                ),
                "page": 1,
                "page_size": 1,
            },
            headers=unsafe,
        )
        assert pl.read_ipc_stream(BytesIO(partial_row.content)).to_dicts() == [
            {"text": "document-2379", "stance": None}
        ]
