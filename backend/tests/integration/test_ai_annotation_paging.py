import pytest
from ldaca_web_app_backend.analysis.manager import get_task_manager


@pytest.mark.anyio
async def test_ai_annotation_recomputes_pages_without_persisting_results(
    authenticated_client,
    workspace_id,
    sample_node_id,
    monkeypatch,
):
    calls: list[list[str]] = []

    async def fake_classify_texts(*, texts, text_column_name="text", **_kwargs):
        calls.append(list(texts))
        return [
            {
                "row_index": index,
                text_column_name: text,
                "classification": f"label-{index}",
                "error": None,
            }
            for index, text in enumerate(texts)
        ]

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.ai_annotation.classify_texts",
        fake_classify_texts,
    )

    request_payload = {
        "node_ids": [sample_node_id],
        "node_columns": {sample_node_id: "document"},
        "classes": [
            {"name": "support", "description": "Supportive tone"},
            {"name": "critical", "description": "Critical tone"},
        ],
        "model": "gpt-4o-mini",
        "page": 1,
        "page_size": 2,
    }

    initial_response = await authenticated_client.post(
        "/api/workspaces/ai-annotation",
        json=request_payload,
    )

    assert initial_response.status_code == 200
    initial_payload = initial_response.json()
    assert initial_payload["state"] == "successful"

    task_id = initial_payload["metadata"]["task_id"]
    task_manager = get_task_manager("test")
    task = task_manager.get_task(task_id)
    assert task is not None

    stored_result = task.result.to_json() if task.result is not None else {}
    assert "node_results" not in stored_result

    page_two_response = await authenticated_client.post(
        f"/api/workspaces/ai-annotation/tasks/{task_id}/result",
        json={"page": 2, "page_size": 2},
    )
    assert page_two_response.status_code == 200

    page_two_repeat_response = await authenticated_client.post(
        f"/api/workspaces/ai-annotation/tasks/{task_id}/result",
        json={"page": 2, "page_size": 2},
    )
    assert page_two_repeat_response.status_code == 200

    assert calls == [
        ["This is a sample document.", "Another sample text for analysis."],
        ["More text content for testing.", "Final sample sentence."],
        ["More text content for testing.", "Final sample sentence."],
    ]

    refreshed_task = task_manager.get_task(task_id)
    assert refreshed_task is not None
    refreshed_result = (
        refreshed_task.result.to_json() if refreshed_task.result is not None else {}
    )
    assert "node_results" not in refreshed_result
