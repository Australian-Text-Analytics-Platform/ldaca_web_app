import csv
from types import SimpleNamespace

import pytest
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.analysis.results import GenericAnalysisResult
from ldaca_web_app_backend.api.workspaces.analyses.token_frequencies import (
    DEFAULT_TOKEN_LIMIT,
    MAX_SERVER_TOKEN_LIMIT,
    SERVER_LIMIT_MULTIPLIER,
    _safe_float,
)
from ldaca_web_app_backend.core.utils import get_user_data_folder
from ldaca_web_app_backend.core.worker import token_frequencies_task
from ldaca_web_app_backend.core.workspace import workspace_manager


def _simulate_token_frequency_completion(workspace_id: str):
    task_manager = get_task_manager("test")
    task_ids = task_manager.get_current_task_ids("token_frequencies")
    assert task_ids
    task = task_manager.get_task(task_ids[0])
    assert task is not None
    req = task.request.model_dump() if hasattr(task.request, "model_dump") else {}
    workspace = workspace_manager.get_current_workspace("test")
    assert workspace is not None

    node_ids = req.get("node_ids") or []
    node_columns = req.get("node_columns") or {}
    node_corpora: dict[str, list[str]] = {}
    node_display_names: dict[str, str] = {}
    for node_id in node_ids:
        node = workspace.nodes.get(node_id)
        assert node is not None
        node_data = getattr(node, "data", None)
        assert node_data is not None
        column_name = node_columns.get(node_id)
        assert column_name
        docs_df = node_data.select(column_name).collect()
        node_corpora[node_id] = [
            str(v) if v is not None else "" for v in docs_df[column_name].to_list()
        ]
        node_display_names[node_id] = str(getattr(node, "name", None) or node_id)

    artifacts_dir = workspace_manager.ensure_workspace_artifacts_dir(
        "test", workspace_id
    )
    assert artifacts_dir is not None
    worker_result = token_frequencies_task(
        user_id="test",
        workspace_id=workspace_id,
        node_corpora=node_corpora,
        node_display_names=node_display_names,
        artifact_dir=str(artifacts_dir),
        artifact_prefix=f"test_token_freq_{task.task_id}",
        token_limit=req.get("token_limit") or DEFAULT_TOKEN_LIMIT,
        stop_words=req.get("stop_words") or [],
    )
    task.complete(GenericAnalysisResult(worker_result))
    task_manager.save_task(task)


async def _get_current_task_id(client, workspace_id: str, analysis: str):
    slug = analysis.replace("_", "-")
    response = await client.get(f"/api/workspaces/{slug}/tasks/current")
    if response.status_code != 200:
        return None
    payload = response.json()
    task_ids = payload.get("task_ids") or []
    return task_ids[0] if task_ids else None


@pytest.fixture(autouse=True)
def _stub_task_manager(monkeypatch):
    class ImmediateTaskManager:
        async def any_running(self, **_kwargs):  # pragma: no cover
            return False

        async def latest_by_type(self, *args, **_kwargs):  # pragma: no cover
            return None

        async def submit_task(self, **_kwargs):  # pragma: no cover
            return SimpleNamespace(id="test-task")

    def fake_get_task_manager(self, _user_id):
        return ImmediateTaskManager()

    monkeypatch.setattr(
        workspace_manager.__class__, "get_task_manager", fake_get_task_manager
    )


def _write_token_csv(folder, filename, start, end):
    file_path = folder / filename
    with open(file_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["document"])
        for i in range(start, end):
            writer.writerow([f"token{i}"])
    return file_path


def test_safe_float_preserves_missing_and_distinguishes_infinities():
    assert _safe_float(None) is None
    assert _safe_float(float("inf")) == "+Inf"
    assert _safe_float(float("-inf")) == "-Inf"
    assert _safe_float(float("nan")) is None


@pytest.mark.anyio
async def test_token_frequencies_full_table_and_metadata(
    authenticated_client,
    workspace_id,
    test_user,
):
    user_folder = get_user_data_folder(test_user["id"])
    user_folder.mkdir(parents=True, exist_ok=True)

    file_a = _write_token_csv(user_folder, "node_a.csv", 0, 600)
    file_b = _write_token_csv(user_folder, "node_b.csv", 300, 900)

    node_ids: list[str] = []
    for csv_file in (file_a, file_b):
        resp = await authenticated_client.post(
            "/api/workspaces/nodes",
            params={"filename": csv_file.name},
        )
        assert resp.status_code == 200, resp.text
        node_ids.append(resp.json()["id"])

    payload = {
        "node_ids": node_ids,
        "node_columns": {node_ids[0]: "document", node_ids[1]: "document"},
        "stop_words": ["the", "and"],
    }

    response = await authenticated_client.post(
        "/api/workspaces/token-frequencies",
        json=payload,
    )
    assert response.status_code == 200, response.text
    start_payload = response.json()
    assert start_payload.get("state") == "running"
    assert start_payload.get("metadata", {}).get("task_id")

    running_task_id = await _get_current_task_id(
        authenticated_client, workspace_id, "token_frequencies"
    )
    assert running_task_id
    running_result_response = await authenticated_client.get(
        f"/api/workspaces/token-frequencies/tasks/{running_task_id}/result"
    )
    assert running_result_response.status_code == 200
    running_payload = running_result_response.json()
    assert running_payload.get("state") == "running"
    assert running_payload.get("metadata", {}).get("task_id") == running_task_id

    _simulate_token_frequency_completion(workspace_id)
    task_id = await _get_current_task_id(
        authenticated_client, workspace_id, "token_frequencies"
    )
    assert task_id
    result_response = await authenticated_client.get(
        f"/api/workspaces/token-frequencies/tasks/{task_id}/result"
    )
    assert result_response.status_code == 200
    data = result_response.json()

    assert data["state"] == "successful"
    assert data.get("token_limit") == DEFAULT_TOKEN_LIMIT
    assert data.get("analysis_params", {}).get("token_limit") == DEFAULT_TOKEN_LIMIT
    expected_server_limit = min(
        max(DEFAULT_TOKEN_LIMIT * SERVER_LIMIT_MULTIPLIER, DEFAULT_TOKEN_LIMIT),
        MAX_SERVER_TOKEN_LIMIT,
    )
    assert data.get("analysis_params", {}).get("server_limit") == expected_server_limit
    assert data.get("stop_words") == ["the", "and"]
    assert data.get("metadata", {}).get("stop_words") == ["the", "and"]
    assert data.get("metadata", {}).get("server_limit") == expected_server_limit
    assert data.get("metadata", {}).get("token_limit") == DEFAULT_TOKEN_LIMIT

    assert "data" in data and isinstance(data["data"], dict)
    for node_id, node_result in data["data"].items():
        meta = node_result.get("metadata")
        assert meta is not None, f"metadata missing for node result {node_id}"
        assert meta["applied_server_limit"] is None
        assert meta["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert meta["total_tokens_before_limit"] >= expected_server_limit
        assert meta.get("total_tokens_returned") == meta["total_tokens_before_limit"]
        assert meta["truncated"] is False
        assert meta["node_id"] == node_id
        assert meta.get("display_name")
        assert len(node_result.get("data", [])) == meta["total_tokens_before_limit"]

    stats = data.get("statistics")
    assert stats is not None and len(stats) > 0

    node_display_names = data.get("metadata", {}).get("node_display_names")
    assert isinstance(node_display_names, dict)
    for original_id in node_ids:
        assert original_id in node_display_names

    first_node_result = next(iter(data["data"].values()))
    sample_token = first_node_result["data"][0]["token"]
    assert isinstance(sample_token, str)
    assert sample_token
