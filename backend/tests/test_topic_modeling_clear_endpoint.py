import pytest


@pytest.mark.asyncio
async def test_topic_modeling_clear_endpoint(authenticated_client):
    response = await authenticated_client.post(
        "/api/workspaces/test-workspace/topic-modeling/clear"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["state"] == "successful"
    assert "cleared" in payload
    assert "analyses_removed" in payload["cleared"]
