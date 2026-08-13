import uuid
from datetime import UTC, datetime

import polars as pl
import pytest
from ldaca_wordflow.analysis.quotation_core import (
    compute_quote_dataframe,
    compute_on_demand_page,
    prepare_documents_payload,
    remote_payload_to_grouped_dataframe,
)
from ldaca_wordflow.infrastructure.providers.quotation_client import (
    QuotationProviderClient,
    QuotationServiceError,
    normalise_engine_base_url,
)
from ldaca_wordflow.domain.workspace import (
    Node,
    QuotationAnalysisRequest,
    QuotationEngineSelection,
    QuotationEngineType,
)
from ldaca_wordflow.models.quotation import ResolvedQuotationEngine
from ldaca_wordflow.models.analysis_results import QuotationResult
from ldaca_wordflow.infrastructure.providers.quotation_engines import (
    resolve_quotation_engine,
)
from ldaca_wordflow.settings import RemoteQuotationEngineSetting, Settings
from ldaca_wordflow.shared.errors import InvalidInputError
from pydantic import AnyHttpUrl, TypeAdapter, ValidationError

HTTP_URL = TypeAdapter(AnyHttpUrl).validate_python


async def _run_inline(function, *args):
    return function(*args)


def test_resolved_local_engine_rejects_a_url():
    with pytest.raises(ValidationError):
        ResolvedQuotationEngine(
            type=QuotationEngineType.LOCAL,
            url=HTTP_URL("http://example.com"),
        )


def test_engine_config_remote_requires_url():
    with pytest.raises(ValueError):
        ResolvedQuotationEngine(type=QuotationEngineType.REMOTE)


def test_public_remote_selection_cannot_supply_an_arbitrary_url():
    with pytest.raises(ValidationError):
        QuotationAnalysisRequest.model_validate(
            {
                "kind": "quotation",
                "node_id": str(uuid.uuid4()),
                "column": "text",
                "engine": {
                    "type": "remote",
                    "engine_id": "approved",
                    "url": "http://127.0.0.1/admin",
                },
            }
        )


def test_remote_selection_resolves_only_operator_owned_engine():
    settings = Settings(
        quotation_remote_engines=(
            RemoteQuotationEngineSetting(
                id="approved",
                url=HTTP_URL("https://quotation.example/api/v1/quotation"),
            ),
        )
    )
    resolved = resolve_quotation_engine(
        QuotationEngineSelection(
            type=QuotationEngineType.REMOTE,
            engine_id="approved",
        ),
        settings,
    )
    assert str(resolved.url).startswith("https://quotation.example/")


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
    cfg = ResolvedQuotationEngine()
    client = QuotationProviderClient(default_timeout=1)
    try:
        with pytest.raises(QuotationServiceError):
            await client.extract(cfg, {})
    finally:
        await client.close()


def test_prepare_documents_payload_stable_order():
    df = pl.DataFrame({"text": ["a", "b", "c"]})
    docs = prepare_documents_payload(df, "text")
    assert list(docs.keys()) == ["0", "1", "2"]
    assert docs["0"]["text"] == "a"


@pytest.mark.asyncio
async def test_quotation_page_rejects_an_unknown_sort_column() -> None:
    node = Node(data=pl.DataFrame({"body": ["text"]}).lazy(), name="Documents")

    async def unused_compute(*_args, **_kwargs):
        raise AssertionError("quotation computation must not start")

    with pytest.raises(InvalidInputError, match="Sort column"):
        await compute_on_demand_page(
            node,
            "body",
            ResolvedQuotationEngine(),
            page=1,
            page_size=10,
            sort_by="missing",
            descending=False,
            compute_quote_dataframe_fn=unused_compute,
            run_blocking=_run_inline,
        )


@pytest.mark.asyncio
async def test_quotation_page_serializes_temporal_metadata_for_worker_result() -> None:
    created_at = datetime(2020, 10, 16, 22, 2, 13, tzinfo=UTC)
    node = Node(
        data=pl.DataFrame({"body": ["quoted text"], "created_at": [created_at]}).lazy(),
        name="Documents",
    )

    async def fake_compute(_node, base_df, *_args, **_kwargs):
        return remote_payload_to_grouped_dataframe(
            base_df,
            {
                "results": [
                    {
                        "identifier": "0",
                        "quotes": [{"quote": "quoted text"}],
                    }
                ]
            },
        )

    payload = await compute_on_demand_page(
        node,
        "body",
        ResolvedQuotationEngine(),
        page=1,
        page_size=10,
        sort_by=None,
        descending=False,
        compute_quote_dataframe_fn=fake_compute,
        run_blocking=_run_inline,
    )

    result = QuotationResult.model_validate(payload)

    assert result.data is not None
    assert result.data[0][0]["created_at"] == "2020-10-16T22:02:13Z"


@pytest.mark.asyncio
async def test_remote_compute_chunks_based_on_settings(monkeypatch):
    engine = ResolvedQuotationEngine(
        type=QuotationEngineType.REMOTE,
        url=HTTP_URL("http://engine"),
    )
    df = pl.DataFrame({"body": [f"doc-{i}" for i in range(5)]})
    node = Node(data=df.lazy(), name="Documents")

    calls = []

    async def fake_extract(cfg, documents, *, options=None, timeout=None):
        calls.append(
            {
                "cfg": cfg,
                "documents": documents,
                "options": options,
                "timeout": timeout,
            }
        )
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

    test_settings = Settings(quotation_service_max_batch_size=2)

    result = await compute_quote_dataframe(
        node,
        df,
        "body",
        engine,
        extract_remote_fn=fake_extract,
        quotation_service_max_batch_size=test_settings.quotation_service_max_batch_size,
        quotation_service_timeout=test_settings.quotation_service_timeout,
        run_blocking=_run_inline,
    )

    assert len(calls) == 3  # 5 docs -> batches of 2,2,1
    assert [list(call["documents"].keys()) for call in calls] == [
        ["0", "1"],
        ["2", "3"],
        ["4"],
    ]
    assert result.columns == ["body", "quotation"]
    assert result.to_dicts() == [
        {
            "body": "doc-0",
            "quotation": [
                {
                    "speaker": None,
                    "speaker_start_idx": None,
                    "speaker_end_idx": None,
                    "quote": "quote-0",
                    "quote_start_idx": 0,
                    "quote_end_idx": 1,
                    "verb": None,
                    "verb_start_idx": None,
                    "verb_end_idx": None,
                    "quote_type": None,
                    "quote_token_count": None,
                    "is_floating_quote": None,
                    "quote_row_idx": 0,
                }
            ],
        },
        {
            "body": "doc-1",
            "quotation": [
                {
                    "speaker": None,
                    "speaker_start_idx": None,
                    "speaker_end_idx": None,
                    "quote": "quote-1",
                    "quote_start_idx": 0,
                    "quote_end_idx": 1,
                    "verb": None,
                    "verb_start_idx": None,
                    "verb_end_idx": None,
                    "quote_type": None,
                    "quote_token_count": None,
                    "is_floating_quote": None,
                    "quote_row_idx": 0,
                }
            ],
        },
        {
            "body": "doc-2",
            "quotation": [
                {
                    "speaker": None,
                    "speaker_start_idx": None,
                    "speaker_end_idx": None,
                    "quote": "quote-2",
                    "quote_start_idx": 0,
                    "quote_end_idx": 1,
                    "verb": None,
                    "verb_start_idx": None,
                    "verb_end_idx": None,
                    "quote_type": None,
                    "quote_token_count": None,
                    "is_floating_quote": None,
                    "quote_row_idx": 0,
                }
            ],
        },
        {
            "body": "doc-3",
            "quotation": [
                {
                    "speaker": None,
                    "speaker_start_idx": None,
                    "speaker_end_idx": None,
                    "quote": "quote-3",
                    "quote_start_idx": 0,
                    "quote_end_idx": 1,
                    "verb": None,
                    "verb_start_idx": None,
                    "verb_end_idx": None,
                    "quote_type": None,
                    "quote_token_count": None,
                    "is_floating_quote": None,
                    "quote_row_idx": 0,
                }
            ],
        },
        {
            "body": "doc-4",
            "quotation": [
                {
                    "speaker": None,
                    "speaker_start_idx": None,
                    "speaker_end_idx": None,
                    "quote": "quote-4",
                    "quote_start_idx": 0,
                    "quote_end_idx": 1,
                    "verb": None,
                    "verb_start_idx": None,
                    "verb_end_idx": None,
                    "quote_type": None,
                    "quote_token_count": None,
                    "is_floating_quote": None,
                    "quote_row_idx": 0,
                }
            ],
        },
    ]
