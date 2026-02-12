"""Tests for the default stop words endpoint."""

import pytest
from httpx import ASGITransport, AsyncClient
from ldaca_web_app_backend.main import app


@pytest.mark.asyncio
async def test_default_stop_words_endpoint_available():
    """Ensure the default stop words endpoint is reachable at /api/text."""

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/text/default-stop-words")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["stopwords"], list)
        assert "the" in data["stopwords"]

        spanish = await client.get("/api/text/default-stop-words?language=es")
        assert spanish.status_code == 200
        spanish_data = spanish.json()
        assert isinstance(spanish_data["stopwords"], list)
        assert "de" in spanish_data["stopwords"]

        legacy = await client.get("/api/api/text/default-stop-words")
        assert legacy.status_code == 404
