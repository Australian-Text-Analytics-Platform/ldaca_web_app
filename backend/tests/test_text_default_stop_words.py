"""Tests for the default stop words endpoint."""

import sys
import types

import pytest
from httpx import ASGITransport, AsyncClient
from ldaca_web_app_backend.main import app


@pytest.mark.asyncio
async def test_default_stop_words_endpoint_available(monkeypatch):
    """Ensure the default stop words endpoint is reachable at /api/text."""

    fake_words = ["alpha", "beta", "gamma"]

    fake_nltk = types.ModuleType("nltk")
    fake_nltk.download = lambda *args, **kwargs: None

    fake_stopwords_module = types.ModuleType("nltk.corpus.stopwords")

    def _words(language: str):
        assert language == "english"
        return fake_words

    fake_stopwords_module.words = _words

    fake_corpus_module = types.ModuleType("nltk.corpus")
    fake_corpus_module.stopwords = fake_stopwords_module

    monkeypatch.setitem(sys.modules, "nltk", fake_nltk)
    monkeypatch.setitem(sys.modules, "nltk.corpus", fake_corpus_module)
    monkeypatch.setitem(sys.modules, "nltk.corpus.stopwords", fake_stopwords_module)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/text/default-stop-words")
        assert response.status_code == 200
        data = response.json()
        assert data["stopwords"] == fake_words

        legacy = await client.get("/api/api/text/default-stop-words")
        assert legacy.status_code == 404
