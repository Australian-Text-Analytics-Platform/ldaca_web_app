from types import SimpleNamespace

import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces.analyses.quotation_core import (
    compute_quote_dataframe,
    prepare_documents_payload,
)
from ldaca_web_app_backend.core.services.quotation_client import (
    QuotationServiceError,
    extract_remote_quotations,
    normalise_engine_base_url,
)
from ldaca_web_app_backend.models import QuotationEngineConfig, QuotationEngineType
from ldaca_web_app_backend.settings import settings


def test_engine_config_local_clears_url():
    cfg = QuotationEngineConfig(
        type=QuotationEngineType.LOCAL, url="http://example.com"
    )
    assert cfg.type is QuotationEngineType.LOCAL
    assert cfg.url is None


def test_engine_config_remote_requires_url():
    with pytest.raises(ValueError):
        QuotationEngineConfig(type=QuotationEngineType.REMOTE)


def test_normalise_engine_base_url_variants():
    assert (
        normalise_engine_base_url("http://localhost:8005")
        == "http://localhost:8005/api/v1/quotation"
    )
    assert (
        normalise_engine_base_url("http://localhost:8005/api/v1/quotation")
        == "http://localhost:8005/api/v1/quotation"
    )
    assert (
        normalise_engine_base_url("http://localhost:8005/api/v1/quotation/extract")
        == "http://localhost:8005/api/v1/quotation"
    )


@pytest.mark.asyncio
async def test_extract_remote_requires_remote_engine():
    cfg = QuotationEngineConfig()
    with pytest.raises(QuotationServiceError):
        await extract_remote_quotations(cfg, {})


def test_prepare_documents_payload_stable_order():
    df = pl.DataFrame({"text": ["a", "b", "c"]})
    docs = prepare_documents_payload(df, "text")
    assert list(docs.keys()) == ["0", "1", "2"]
    assert docs["0"]["text"] == "a"


@pytest.mark.asyncio
async def test_remote_compute_chunks_based_on_settings(monkeypatch):
    engine = QuotationEngineConfig(type=QuotationEngineType.REMOTE, url="http://engine")
    df = pl.DataFrame({"body": [f"doc-{i}" for i in range(5)]})
    node = SimpleNamespace(data=df)

    calls = []

    async def fake_extract(cfg, documents, *, options=None, timeout=None):
        calls.append({
            "cfg": cfg,
            "documents": documents,
            "options": options,
            "timeout": timeout,
        })
        return {
            "results": [
                {
                    "identifier": doc_id,
                    "quotes": [
                        {
                            "quote": f"quote-{doc_id}",
                            "quote_start_idx": 0,
                            "quote_end_idx": 1,
                        }
                    ],
                }
                for doc_id in documents.keys()
            ]
        }

    monkeypatch.setattr(settings, "quotation_service_max_batch_size", 2)

    result = await compute_quote_dataframe(
        node,
        df,
        "body",
        engine,
        extract_remote_fn=fake_extract,
        quotation_service_max_batch_size=settings.quotation_service_max_batch_size,
        quotation_service_timeout=settings.quotation_service_timeout,
    )

    assert len(calls) == 3  # 5 docs -> batches of 2,2,1
    assert [list(call["documents"].keys()) for call in calls] == [
        ["0", "1"],
        ["2", "3"],
        ["4"],
    ]
    assert set(result.columns) >= {"quote"}
    assert sorted(result["quote"].to_list()) == [
        "quote-0",
        "quote-1",
        "quote-2",
        "quote-3",
        "quote-4",
    ]
