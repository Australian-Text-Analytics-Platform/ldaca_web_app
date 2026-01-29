import pytest
from ldaca_web_app_backend.analysis.manager import get_task_manager


@pytest.mark.asyncio
async def test_topic_modeling_clear_endpoint(authenticated_client):
    workspace_id = "test-workspace"
    task_manager = get_task_manager("test", workspace_id)
    task_id = task_manager.create_task({"node_ids": ["node-1"]})

    response = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/tasks/{task_id}/clear"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["state"] == "successful"
