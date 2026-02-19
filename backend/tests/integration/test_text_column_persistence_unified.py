from types import SimpleNamespace

import polars as pl
import pytest
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.core.workspace import workspace_manager


@pytest.fixture(autouse=True)
def _stub_worker_task_manager(monkeypatch):
    class ImmediateTaskManager:
        async def any_running(self, **_kwargs):
            return False

        async def latest_by_type(self, *args, **_kwargs):
            return None

        async def submit_task(self, **_kwargs):
            return SimpleNamespace(id="test-worker-task")

    def fake_get_task_manager(self, _user_id, _workspace_id):
        return ImmediateTaskManager()

    monkeypatch.setattr(
        workspace_manager.__class__, "get_task_manager", fake_get_task_manager
    )


@pytest.mark.anyio
async def test_text_column_preference_persists_across_text_analyses(
    authenticated_client, workspace_id
):
    user_id = "test"

    node = workspace_manager.add_node_to_workspace(
        user_id=user_id,
        workspace_id=workspace_id,
        data=pl.DataFrame({
            "text_a": [
                "alpha from column a",
                "beta from column a",
                "gamma from column a",
            ],
            "text_b": [
                "alpha from column b",
                "delta from column b",
                "epsilon from column b",
            ],
        }),
        node_name="dual_text_node",
        operation="test_setup",
        parents=[],
    )

    assert node is not None

    token_response = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/token-frequencies",
        json={
            "node_ids": [node.id],
            "node_columns": {node.id: "text_a"},
        },
    )
    assert token_response.status_code == 200, token_response.text

    refreshed = workspace_manager.get_node_from_workspace(
        user_id, workspace_id, node.id
    )
    assert refreshed is not None
    metadata = getattr(refreshed, "metadata", {}) or {}
    assert isinstance(metadata, dict)
    assert metadata.get("text_column") == "text_a"

    concordance_response = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance",
        json={
            "node_ids": [node.id],
            "node_columns": {node.id: "text_b"},
            "search_word": "alpha",
            "num_left_tokens": 1,
            "num_right_tokens": 1,
            "regex": False,
            "case_sensitive": False,
            "combined": False,
        },
    )
    assert concordance_response.status_code == 200, concordance_response.text

    refreshed = workspace_manager.get_node_from_workspace(
        user_id, workspace_id, node.id
    )
    assert refreshed is not None
    metadata = getattr(refreshed, "metadata", {}) or {}
    assert isinstance(metadata, dict)
    assert metadata.get("text_column") == "text_b"

    topic_response = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/topic-modeling",
        json={
            "node_ids": [node.id],
            "node_columns": {},
            "min_topic_size": 2,
            "use_ctfidf": True,
        },
    )
    assert topic_response.status_code == 200, topic_response.text

    payload = topic_response.json()
    task_id = payload.get("metadata", {}).get("task_id")
    assert task_id

    analysis_task = get_task_manager(user_id, workspace_id).get_task(task_id)
    assert analysis_task is not None

    request_data = (
        analysis_task.request.model_dump()
        if hasattr(analysis_task.request, "model_dump")
        else analysis_task.request.dict()
    )
    assert request_data["node_columns"][node.id] == "text_b"
