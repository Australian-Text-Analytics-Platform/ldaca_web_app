import json
import uuid
from datetime import UTC, datetime

import httpx
import polars as pl
import pytest
from ldaca_wordflow.analysis.quotation_core import (
    compute_quotation_groups,
    compute_quotation_page,
)
from ldaca_wordflow.infrastructure.providers.quotation_client import (
    QuotationProviderClient,
)
from ldaca_wordflow.domain.workspace import (
    Node,
    QuotationAnalysisRequest,
    QuotationEngineType,
    RemoteQuotationEngineSelection,
)
from ldaca_wordflow.models.quotation import (
    LocalResolvedQuotationEngine,
    RemoteQuotationDocument,
    RemoteQuotationExtractResponse,
    RemoteQuotationQuote,
    RemoteQuotationResult,
    RemoteResolvedQuotationEngine,
)
from ldaca_wordflow.infrastructure.providers.quotation_engines import (
    resolve_quotation_engine,
)
from ldaca_wordflow.settings import RemoteQuotationEngineSetting, Settings
from ldaca_wordflow.shared.errors import InvalidInputError
from pydantic import AnyHttpUrl, TypeAdapter, ValidationError

HTTP_URL = TypeAdapter(AnyHttpUrl).validate_python


async def _run_inline(function, *args):
    return function(*args)


def _remote_quote(text: str) -> RemoteQuotationQuote:
    return RemoteQuotationQuote(
        speaker=None,
        speaker_start_idx=None,
        speaker_end_idx=None,
        quote=text,
        quote_start_idx=0,
        quote_end_idx=len(text),
        verb=None,
        verb_start_idx=None,
        verb_end_idx=None,
        quote_type="direct",
        quote_token_count=1,
        is_floating_quote=False,
        quote_row_idx=0,
    )


def _remote_response(
    *results: RemoteQuotationResult,
) -> RemoteQuotationExtractResponse:
    return RemoteQuotationExtractResponse(version=2, results=list(results))


def test_resolved_local_engine_rejects_a_url():
    with pytest.raises(ValidationError):
        LocalResolvedQuotationEngine.model_validate(
            {"type": "local", "url": "http://example.com"}
        )


def test_engine_config_remote_requires_url():
    with pytest.raises(ValueError):
        RemoteResolvedQuotationEngine.model_validate({"type": "remote"})


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
                url=HTTP_URL("https://quotation.example"),
            ),
        )
    )
    resolved = resolve_quotation_engine(
        RemoteQuotationEngineSelection(
            type=QuotationEngineType.REMOTE, engine_id="approved"
        ),
        settings,
    )
    assert isinstance(resolved, RemoteResolvedQuotationEngine)
    assert str(resolved.url).startswith("https://quotation.example/")


def test_remote_engine_setting_rejects_an_endpoint_suffix():
    with pytest.raises(ValidationError, match="exact origin"):
        RemoteQuotationEngineSetting(
            id="invalid-suffix",
            url=HTTP_URL("http://localhost:8005/api/v2/quotation/extract"),
        )


@pytest.mark.asyncio
async def test_remote_client_uses_the_exact_v2_endpoint_and_envelope():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"version": 2, "results": [{"id": "doc", "quotes": []}]},
        )

    client = QuotationProviderClient(default_timeout=1)
    await client._client.aclose()
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        response = await client.extract(
            RemoteResolvedQuotationEngine(url=HTTP_URL("http://engine")),
            [RemoteQuotationDocument(id="doc", text="text")],
        )
    finally:
        await client.close()

    assert captured == {
        "url": "http://engine/api/v2/quotation/extract",
        "payload": {
            "version": 2,
            "documents": [{"id": "doc", "text": "text"}],
        },
    }
    assert response.results[0].id == "doc"


@pytest.mark.asyncio
async def test_quotation_page_rejects_an_unknown_sort_column() -> None:
    node = Node(data=pl.DataFrame({"body": ["text"]}).lazy(), name="Documents")

    async def unused_extract(*_args, **_kwargs):
        raise AssertionError("quotation computation must not start")

    with pytest.raises(InvalidInputError, match="Sort column"):
        await compute_quotation_page(
            node,
            "body",
            RemoteResolvedQuotationEngine(url=HTTP_URL("http://engine")),
            page=1,
            page_size=10,
            sort_by="missing",
            descending=False,
            quotation_service_max_batch_size=2,
            extract_remote_fn=unused_extract,
            run_blocking=_run_inline,
        )


@pytest.mark.asyncio
async def test_quotation_page_preserves_native_temporal_and_nested_arrow_values() -> (
    None
):
    created_at = datetime(2020, 10, 16, 22, 2, 13, tzinfo=UTC)
    node = Node(
        data=pl.DataFrame({"body": ["quoted text"], "created_at": [created_at]}).lazy(),
        name="Documents",
    )

    async def fake_extract(_engine, documents):
        assert [document.text for document in documents] == ["quoted text"]
        return _remote_response(
            RemoteQuotationResult(id="0", quotes=[_remote_quote("quoted text")])
        )

    page = await compute_quotation_page(
        node,
        "body",
        RemoteResolvedQuotationEngine(url=HTTP_URL("http://engine")),
        page=1,
        page_size=10,
        sort_by=None,
        descending=False,
        quotation_service_max_batch_size=2,
        extract_remote_fn=fake_extract,
        run_blocking=_run_inline,
    )

    assert page.frame.schema["created_at"] == pl.Datetime("us", "UTC")
    quotation_dtype = page.frame.schema["quotation"]
    assert isinstance(quotation_dtype, pl.List)
    quotation_struct_dtype = quotation_dtype.inner
    assert isinstance(quotation_struct_dtype, pl.Struct)
    quotation_fields = {
        field.name: field.dtype for field in quotation_struct_dtype.fields
    }
    assert quotation_fields["quote_start_idx"] == pl.Int64
    assert quotation_fields["quote_end_idx"] == pl.Int64
    assert page.frame["created_at"].to_list() == [created_at]
    assert page.frame["quotation"].to_list()[0][0]["quote"] == "quoted text"
    assert page.total_source_rows == 1
    assert page.has_next is False


@pytest.mark.asyncio
async def test_empty_sparse_page_can_still_have_a_later_source_page() -> None:
    node = Node(
        data=pl.DataFrame({"body": ["no quote", "quoted text"]}).lazy(),
        name="Documents",
    )

    async def fake_extract(_engine, _documents):
        return _remote_response(RemoteQuotationResult(id="0", quotes=[]))

    page = await compute_quotation_page(
        node,
        "body",
        RemoteResolvedQuotationEngine(url=HTTP_URL("http://engine")),
        page=1,
        page_size=1,
        sort_by=None,
        descending=False,
        quotation_service_max_batch_size=2,
        extract_remote_fn=fake_extract,
        run_blocking=_run_inline,
    )

    assert page.frame.height == 0
    assert page.total_source_rows == 2
    assert page.has_next is True


@pytest.mark.asyncio
async def test_remote_compute_chunks_based_on_settings():
    engine = RemoteResolvedQuotationEngine(url=HTTP_URL("http://engine"))
    df = pl.DataFrame({"body": [f"doc-{i}" for i in range(5)]})

    calls = []

    async def fake_extract(cfg, documents):
        calls.append(
            {
                "cfg": cfg,
                "documents": documents,
            }
        )
        return _remote_response(
            *(
                RemoteQuotationResult(
                    id=document.id,
                    quotes=[_remote_quote(document.text)],
                )
                for document in documents
            )
        )

    test_settings = Settings(quotation_service_max_batch_size=2)

    result = await compute_quotation_groups(
        df,
        "body",
        engine,
        extract_remote_fn=fake_extract,
        quotation_service_max_batch_size=test_settings.quotation_service_max_batch_size,
        run_blocking=_run_inline,
    )

    assert len(calls) == 3  # 5 docs -> batches of 2,2,1
    assert [[document.id for document in call["documents"]] for call in calls] == [
        ["0", "1"],
        ["2", "3"],
        ["4"],
    ]
    assert result.columns == ["body", "quotation"]
    assert [row["body"] for row in result.to_dicts()] == [
        "doc-0",
        "doc-1",
        "doc-2",
        "doc-3",
        "doc-4",
    ]
    assert [row["quotation"][0]["quote"] for row in result.to_dicts()] == [
        "doc-0",
        "doc-1",
        "doc-2",
        "doc-3",
        "doc-4",
    ]


@pytest.mark.parametrize(
    ("results", "message"),
    [
        ([], "ordered result"),
        (
            [
                RemoteQuotationResult(id="0", quotes=[]),
                RemoteQuotationResult(id="0", quotes=[]),
            ],
            "ordered result",
        ),
        (
            [
                RemoteQuotationResult(
                    id="0",
                    quotes=[_remote_quote("not-the-source")],
                )
            ],
            "offsets do not match",
        ),
    ],
)
@pytest.mark.asyncio
async def test_remote_compute_rejects_incomplete_or_misaligned_results(
    results: list[RemoteQuotationResult],
    message: str,
) -> None:
    engine = RemoteResolvedQuotationEngine(url=HTTP_URL("http://engine"))
    frame = pl.DataFrame({"body": ["source"]})

    async def fake_extract(_engine, _documents):
        return _remote_response(*results)

    with pytest.raises(ValueError, match=message):
        await compute_quotation_groups(
            frame,
            "body",
            engine,
            extract_remote_fn=fake_extract,
            quotation_service_max_batch_size=2,
            run_blocking=_run_inline,
        )


@pytest.mark.asyncio
async def test_remote_compute_rejects_out_of_order_results() -> None:
    engine = RemoteResolvedQuotationEngine(url=HTTP_URL("http://engine"))
    frame = pl.DataFrame({"body": ["first", "second"]})

    async def fake_extract(_engine, _documents):
        return _remote_response(
            RemoteQuotationResult(id="1", quotes=[_remote_quote("second")]),
            RemoteQuotationResult(id="0", quotes=[_remote_quote("first")]),
        )

    with pytest.raises(ValueError, match="ordered result"):
        await compute_quotation_groups(
            frame,
            "body",
            engine,
            extract_remote_fn=fake_extract,
            quotation_service_max_batch_size=2,
            run_blocking=_run_inline,
        )
