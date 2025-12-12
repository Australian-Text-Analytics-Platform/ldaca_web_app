from types import SimpleNamespace

import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces.analyses.quotation import (
    _build_joined_quotation_frames,
    _compute_quote_dataframe,
    _prepare_documents_payload,
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
    docs = _prepare_documents_payload(df, "text")
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

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation.extract_remote_quotations",
        fake_extract,
    )
    monkeypatch.setattr(settings, "quotation_service_max_batch_size", 2)

    result = await _compute_quote_dataframe(node, df, "body", engine)

    assert len(calls) == 3  # 5 docs -> batches of 2,2,1
    assert [list(call["documents"].keys()) for call in calls] == [
        ["0", "1"],
        ["2", "3"],
        ["4"],
    ]
    assert set(result.columns) >= {"document_idx", "quote"}
    assert sorted(result["document_idx"].to_list()) == [0, 1, 2, 3, 4]
    assert sorted(result["quote"].to_list()) == [
        "quote-0",
        "quote-1",
        "quote-2",
        "quote-3",
        "quote-4",
    ]


@pytest.mark.asyncio
async def test_joined_frame_matches_base_layout(monkeypatch):
    base_df = pl.DataFrame({
        "text": ["Alpha beta.", "Gamma delta."],
        "meta": ["a", "b"],
    })
    node = SimpleNamespace(data=base_df)
    engine = QuotationEngineConfig(type=QuotationEngineType.REMOTE, url="http://engine")

    quote_rows = pl.DataFrame({
        "document_idx": [0, 1],
        "quote": ["Alpha", "delta"],
        "quote_start_idx": [0, 6],
        "quote_end_idx": [5, 11],
        "quote_row_idx": [0, 0],
    })

    async def fake_compute(node_arg, base_arg, column_arg, engine_arg, **kwargs):
        assert column_arg == "text"
        return quote_rows

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation._compute_quote_dataframe",
        fake_compute,
    )

    joined, _ = await _build_joined_quotation_frames(node, "text", engine)

    assert joined.columns[:3] == ["document_idx", "text", "meta"]
    assert set(joined.columns) >= {
        "quote",
        "quote_start_idx",
        "quote_end_idx",
        "quote_row_idx",
    }
    # Only rows with quotations should remain
    assert joined.height == 2
    assert joined["text"].to_list() == ["Alpha beta.", "Gamma delta."]
