from types import SimpleNamespace

import pytest
from ldaca_web_app_backend.api.workspaces.analyses import ai_annotation_core
from ldaca_web_app_backend.core.workspace import workspace_manager


@pytest.fixture(autouse=True)
def _stub_task_manager(monkeypatch):
    async def _fake_classify_texts(texts, request):
        return {
            idx: {"classification": f"class-{idx}", "error": None}
            for idx, _ in enumerate(texts)
        }

    monkeypatch.setattr(
        ai_annotation_core,
        "_classify_texts",
        _fake_classify_texts,
    )

    class NoopWorkerTaskManager:
        async def submit_task(self, **_kwargs):  # pragma: no cover
            return SimpleNamespace(id="ai-annotation-detach-task")

        async def clear_task(self, _task_id):  # pragma: no cover
            return True

    monkeypatch.setattr(
        workspace_manager.__class__,
        "get_task_manager",
        lambda self, _user_id: NoopWorkerTaskManager(),
    )


@pytest.mark.anyio
async def test_ai_annotation_models_endpoint_returns_catalog(authenticated_client):
    response = await authenticated_client.get("/api/workspaces/ai-annotation/models")
    assert response.status_code == 200, response.text

    payload = response.json()
    assert payload.get("state") == "successful"
    assert "data" in payload

    data = payload["data"]
    assert "providers" in data
    assert "techniques" in data
    assert "modifiers" in data


@pytest.mark.anyio
async def test_ai_annotation_submit_requires_column_selection_per_node(
    authenticated_client,
    workspace_id,
    tiny_node_id,
):
    request_payload = {
        "node_ids": [tiny_node_id],
        "node_columns": {},
        "classes": [
            {"name": "positive", "description": "Positive sentiment"},
            {"name": "negative", "description": "Negative sentiment"},
        ],
        "provider": "openai",
        "model": "gpt-4o-mini",
    }

    response = await authenticated_client.post(
        "/api/workspaces/ai-annotation",
        json=request_payload,
    )

    assert response.status_code == 400


@pytest.mark.anyio
async def test_ai_annotation_submit_returns_synchronous_paginated_result(
    authenticated_client,
    workspace_id,
    tiny_node_id,
):
    request_payload = {
        "node_ids": [tiny_node_id],
        "node_columns": {tiny_node_id: "document"},
        "classes": [
            {"name": "positive", "description": "Positive sentiment"},
            {"name": "negative", "description": "Negative sentiment"},
        ],
        "provider": "openai",
        "model": "gpt-4o-mini",
        "technique": "zero_shot",
        "modifier": "no_modifier",
        "temperature": 0.7,
        "top_p": 0.9,
        "enable_reasoning": False,
        "max_reasoning_chars": 150,
        "page": 1,
        "page_size": 2,
        "descending": True,
    }

    response = await authenticated_client.post(
        "/api/workspaces/ai-annotation",
        json=request_payload,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload.get("state") == "successful"
    assert payload.get("metadata", {}).get("task_id")
    assert tiny_node_id in payload.get("data", {})

    node_payload = payload["data"][tiny_node_id]
    assert "pagination" in node_payload
    assert node_payload["pagination"]["page"] == 1
    assert node_payload["pagination"]["page_size"] == 2


@pytest.mark.anyio
async def test_ai_annotation_result_endpoint_accepts_page_and_page_size(
    authenticated_client,
    workspace_id,
    tiny_node_id,
):
    request_payload = {
        "node_ids": [tiny_node_id],
        "node_columns": {tiny_node_id: "document"},
        "classes": [
            {"name": "positive", "description": "Positive sentiment"},
            {"name": "negative", "description": "Negative sentiment"},
        ],
        "provider": "openai",
        "model": "gpt-4o-mini",
        "page": 1,
        "page_size": 1,
    }

    run_response = await authenticated_client.post(
        "/api/workspaces/ai-annotation",
        json=request_payload,
    )
    assert run_response.status_code == 200, run_response.text
    task_id = run_response.json().get("metadata", {}).get("task_id")
    assert task_id

    result_response = await authenticated_client.post(
        f"/api/workspaces/ai-annotation/tasks/{task_id}/result",
        json={"page": 2, "page_size": 1},
    )

    assert result_response.status_code == 200, result_response.text
    payload = result_response.json()
    assert payload.get("state") == "successful"
    assert tiny_node_id in payload.get("data", {})
    node_payload = payload["data"][tiny_node_id]
    assert node_payload["pagination"]["page"] == 2
    assert node_payload["pagination"]["page_size"] == 1


@pytest.mark.anyio
async def test_ai_annotation_detach_starts_background_task(
    authenticated_client,
    workspace_id,
    tiny_node_id,
):
    detach_payload = {
        "column": "document",
        "classes": [
            {"name": "positive", "description": "Positive sentiment"},
            {"name": "negative", "description": "Negative sentiment"},
        ],
        "provider": "openai",
        "model": "gpt-4o-mini",
    }

    response = await authenticated_client.post(
        f"/api/workspaces/nodes/{tiny_node_id}/ai-annotation/detach",
        json=detach_payload,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload.get("state") == "running"
    assert payload.get("metadata", {}).get("task_id") == "ai-annotation-detach-task"


@pytest.mark.anyio
async def test_ai_annotation_save_edits_persists_to_node(
    authenticated_client,
    workspace_id,
    tiny_node_id,
):
    save_payload = {
        "annotation_column": "document_annotation",
        "edits": [
            {
                "row_index": 0,
                "provider": "gpt-4o",
                "annotation": "test-label",
            }
        ],
    }

    response = await authenticated_client.post(
        f"/api/workspaces/nodes/{tiny_node_id}/ai-annotation/save",
        json=save_payload,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload.get("state") == "successful"
    assert payload.get("metadata", {}).get("annotation_column") == "document_annotation"
    assert payload.get("metadata", {}).get("annotation_column") == "document_annotation"
