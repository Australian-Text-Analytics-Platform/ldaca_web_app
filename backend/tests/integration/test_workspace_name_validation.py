import pytest


@pytest.mark.anyio
async def test_create_workspace_rejects_invalid_name(test_client):
    resp = await test_client.post(
        "/api/workspaces/",
        json={"name": "Bad/Name", "description": ""},
    )
    assert resp.status_code == 400
    payload = resp.json()
    assert "Invalid workspace name" in str(payload.get("detail"))


@pytest.mark.anyio
async def test_rename_workspace_rejects_invalid_name(test_client):
    create = await test_client.post(
        "/api/workspaces/",
        json={"name": "Valid Name", "description": ""},
    )
    assert create.status_code == 200
    workspace_id = create.json()["workspace_id"]

    resp = await test_client.put(
        f"/api/workspaces/{workspace_id}/name",
        params={"new_name": "Bad/Name"},
    )
    assert resp.status_code == 400
    payload = resp.json()
    assert "Invalid workspace name" in str(payload.get("detail"))
