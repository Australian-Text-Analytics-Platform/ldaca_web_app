from types import SimpleNamespace

import polars as pl
import pytest
from docworkspace import Node
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.analysis.models import AnalysisStatus, AnalysisTask
from ldaca_web_app_backend.analysis.results import GenericAnalysisResult
from ldaca_web_app_backend.core.workspace import workspace_manager


@pytest.fixture(autouse=True)
def _stub_worker_task_manager(monkeypatch):
    class ImmediateTaskManager:
        async def any_running(self, **_kwargs):
            return False

        async def latest_by_type(self, *args, **_kwargs):
            return None

        async def submit_task(self, **_kwargs):
            return SimpleNamespace(id="topic-worker-task")

    def fake_get_task_manager(self, _user_id):
        return ImmediateTaskManager()

    monkeypatch.setattr(
        workspace_manager.__class__, "get_task_manager", fake_get_task_manager
    )


@pytest.mark.anyio
async def test_topic_modeling_request_persists_random_seed_and_word_count(
    authenticated_client, workspace_id
):
    user_id = "test"
    workspace = workspace_manager.get_current_workspace(user_id)
    assert workspace is not None

    node = Node(
        data=pl.DataFrame({
            "document": [
                "alpha beta gamma",
                "beta gamma delta",
                "gamma delta epsilon",
            ]
        }).lazy(),
        name="topic_source",
        workspace=workspace,
        operation="test_setup",
        parents=[],
    )
    workspace.add_node(node)

    response = await authenticated_client.post(
        "/api/workspaces/topic-modeling",
        json={
            "node_ids": [node.id],
            "node_columns": {node.id: "document"},
            "min_topic_size": 2,
            "random_seed": 123,
            "representative_words_count": 7,
        },
    )

    assert response.status_code == 200, response.text
    task_id = response.json().get("metadata", {}).get("task_id")
    assert task_id

    analysis_task = get_task_manager(user_id).get_task(task_id)
    assert analysis_task is not None

    request_data = (
        analysis_task.request.model_dump()
        if hasattr(analysis_task.request, "model_dump")
        else analysis_task.request.dict()
    )
    assert request_data["random_seed"] == 123
    assert request_data["representative_words_count"] == 7


@pytest.mark.anyio
async def test_topic_modeling_detach_keeps_topic_meaning_only_on_support_node(
    authenticated_client, workspace_id, tmp_path
):
    user_id = "test"
    workspace = workspace_manager.get_current_workspace(user_id)
    assert workspace is not None

    source_node = Node(
        data=pl.DataFrame({
            "document": ["alpha beta", "beta gamma"],
            "source": ["a", "b"],
        }).lazy(),
        name="topic_source",
        workspace=workspace,
        operation="test_setup",
        parents=[],
    )
    workspace.add_node(source_node)

    assignments_path = tmp_path / "assignments.parquet"
    pl.DataFrame(
        {
            "__row_nr__": [0, 1],
            "TOPIC_topic": [0, 0],
        },
        schema={"__row_nr__": pl.Int64, "TOPIC_topic": pl.Int64},
    ).write_parquet(assignments_path)

    meanings_path = tmp_path / "topic_meanings.parquet"
    pl.DataFrame(
        {
            "TOPIC_topic": [0],
            "TOPIC_topic_meaning": [["alpha", "beta", "gamma"]],
        },
        schema={
            "TOPIC_topic": pl.Int64,
            "TOPIC_topic_meaning": pl.List(pl.String),
        },
    ).write_parquet(meanings_path)

    task_id = "completed-topic-task"
    payload = {
        "topics": [
            {
                "id": 0,
                "label": "alpha | beta | gamma",
                "representative_words": ["alpha", "beta", "gamma"],
                "size": [2],
                "total_size": 2,
                "x": 0.0,
                "y": 0.0,
            }
        ],
        "corpus_sizes": [2],
        "artifacts": {
            "version": 1,
            "topic_meanings_parquet_path": str(meanings_path),
            "nodes": [
                {
                    "node_id": source_node.id,
                    "node_name": source_node.name,
                    "text_column": "document",
                    "original_columns": ["document", "source"],
                    "assignments_parquet_path": str(assignments_path),
                }
            ],
        },
    }
    get_task_manager(user_id).save_task(
        AnalysisTask(
            task_id=task_id,
            user_id=user_id,
            workspace_id=workspace_id,
            request={"analysis_type": "topic_modeling"},
            status=AnalysisStatus.COMPLETED,
            result=GenericAnalysisResult(payload),
        )
    )

    detach_response = await authenticated_client.post(
        f"/api/workspaces/topic-modeling/tasks/{task_id}/detach",
        json={
            "node_ids": [source_node.id],
            "selected_columns": {source_node.id: ["document"]},
        },
    )

    assert detach_response.status_code == 200, detach_response.text
    detached_node_id = (
        detach_response
        .json()
        .get("data", {})
        .get("detached_nodes", [{}])[0]
        .get("new_node_id")
    )
    topic_meanings_node_id = (
        detach_response
        .json()
        .get("data", {})
        .get("detached_nodes", [{}])[0]
        .get("topic_meanings_node_id")
    )
    assert detached_node_id
    assert topic_meanings_node_id

    graph_response = await authenticated_client.get("/api/workspaces/graph")
    assert graph_response.status_code == 200, graph_response.text
    nodes = graph_response.json().get("nodes", [])
    detached_node = next(node for node in nodes if node.get("id") == detached_node_id)
    support_node = next(
        node for node in nodes if node.get("id") == topic_meanings_node_id
    )

    detached_raw_schema = detached_node.get("schema", [])
    detached_schema = (
        {column["name"]: column["js_type"] for column in detached_raw_schema}
        if isinstance(detached_raw_schema, list)
        else detached_raw_schema
    )
    support_raw_schema = support_node.get("schema", [])
    support_schema = (
        {column["name"]: column["js_type"] for column in support_raw_schema}
        if isinstance(support_raw_schema, list)
        else support_raw_schema
    )

    assert "TOPIC_topic_meaning" not in detached_schema
    assert support_schema["TOPIC_topic_meaning"] in {"list_string", "List(String)"}
    assert set(support_schema) == {"TOPIC_topic", "TOPIC_topic_meaning"}
