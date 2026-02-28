"""Integration tests for task-id based analysis endpoints."""

from concurrent.futures import Future

import pytest
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.core.worker_task_manager import TaskInfo, WorkerTaskManager


@pytest.mark.asyncio
async def test_task_manager_endpoints_roundtrip(authenticated_client, workspace_id):
    """Current endpoint returns task_id and task request/result endpoints serve data."""
    user_id = "test"
    manager = get_task_manager(user_id)

    task_id = manager.create_task({"node_ids": ["node-1"]})
    manager.set_current_task("token-frequencies", task_id)
    manager.update_task(task_id, {"state": "successful", "data": {}})

    resp = await authenticated_client.get(
        "/api/workspaces/token-frequencies/tasks/current"
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["task_ids"] == [task_id]

    req_resp = await authenticated_client.get(
        f"/api/workspaces/token-frequencies/tasks/{task_id}/request"
    )
    assert req_resp.status_code == 200

    # Task-specific result endpoints have analysis-specific processing;
    # result round-trip is covered by test_analysis_persistence.py with proper data.

    clear_resp = await authenticated_client.post(
        "/api/tasks/clear", params={"task_id": task_id}
    )
    assert clear_resp.status_code == 200


@pytest.mark.asyncio
async def test_task_manager_saves_result_by_task_id(workspace_id):
    """WorkerTaskManager should persist results by task_id in TaskManager."""
    user_id = "test"
    manager = get_task_manager(user_id)
    task_id = manager.create_task({"node_ids": ["node-1"]})

    task_info = TaskInfo(id=task_id, future=Future())
    manager_instance = WorkerTaskManager()

    await manager_instance._save_analysis_result(
        user_id,
        workspace_id,
        "token_frequencies",
        task_info,
        {"state": "successful", "data": {}},
    )

    task = manager.get_task(task_id)
    assert task is not None
    assert task.result is not None
    assert task.result is not None
