import pytest


@pytest.mark.asyncio
async def test_quotation_clear_endpoint(authenticated_client):
    response = await authenticated_client.post(
        "/api/workspaces/test-workspace/quotation/clear"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["state"] == "successful"
    assert "cleared" in payload
    assert "quotation" in payload["cleared"]
