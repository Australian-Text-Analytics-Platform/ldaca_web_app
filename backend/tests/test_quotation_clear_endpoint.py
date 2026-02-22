import pytest
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.core.workspace import workspace_manager


@pytest.mark.asyncio
async def test_quotation_clear_endpoint(authenticated_client):
    workspace_obj = object()
    workspace_manager._current["test"] = {
        "wid": "test-workspace",
        "workspace": workspace_obj,
        "path": None,
    }

    workspace_id = "test-workspace"
    task_manager = get_task_manager("test", workspace_id)
    task_id = task_manager.create_task({"node_id": "node-1", "column": "document"})

    try:
        response = await authenticated_client.post(
            f"/api/workspaces/tasks/{task_id}/clear"
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["state"] == "successful"
    finally:
        workspace_manager._current.pop("test", None)
