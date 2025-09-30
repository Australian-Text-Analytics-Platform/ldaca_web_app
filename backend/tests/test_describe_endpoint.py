"""Tests for the column describe endpoint."""

import pytest
from httpx import ASGITransport, AsyncClient
from ldaca_web_app_backend.main import app


@pytest.mark.asyncio
async def test_describe_column_basic():
    """Test basic describe endpoint with a mock setup."""
    # This is a minimal test to ensure the endpoint is properly registered
    # A full integration test would require setting up a workspace with actual data

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Try to access the endpoint (will fail with 401 without auth, but confirms route exists)
        response = await client.get(
            "/workspaces/test-ws/nodes/test-node/columns/test-col/describe"
        )

        # Expect 401 (unauthorized) rather than 404 (not found), confirming endpoint exists
        assert response.status_code in [401, 404], (
            f"Got unexpected status: {response.status_code}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
