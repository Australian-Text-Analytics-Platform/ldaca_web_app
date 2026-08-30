"""Core quotation computation for Analysis execution and Result queries.

Used by:
- quotation workers and ``AnalysisResultService``.
- focused backend computation tests.

Flow:
- Callers pass immutable requests and snapshotted Node plans into these helpers.
- Helpers normalize pagination/context settings, compute pages, and build extraction columns.
- Response builders serialize grouped quotation rows and generated-column metadata for clients.
"""

from __future__ import annotations

import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from typing import Any

import polars as pl

from ..domain.workspace import Node, QuotationEngineType
from ..shared.errors import InvalidInputError
from ..models.quotation import (
    RemoteQuotationDocument,
    RemoteQuotationExtractResponse,
    RemoteQuotationResult,
    RemoteResolvedQuotationEngine,
    ResolvedQuotationEngine,
)

QUOTATION_GROUP_COLUMN = "quotation"
QUOTATION_GROUP_DTYPE = pl.List(
    pl.Struct(
        {
            "speaker": pl.Utf8,
            "speaker_start_idx": pl.Int64,
            "speaker_end_idx": pl.Int64,
            "quote": pl.Utf8,
            "quote_start_idx": pl.Int64,
            "quote_end_idx": pl.Int64,
            "verb": pl.Utf8,
            "verb_start_idx": pl.Int64,
            "verb_end_idx": pl.Int64,
            "quote_type": pl.Utf8,
            "quote_token_count": pl.Int64,
            "is_floating_quote": pl.Boolean,
            "quote_row_idx": pl.Int64,
        }
    )
)
RemoteQuotationExtractor = Callable[
    [RemoteResolvedQuotationEngine, list[RemoteQuotationDocument]],
    Awaitable[RemoteQuotationExtractResponse],
]
BlockingRunner = Callable[..., Awaitable[Any]]
QuotationGroupsComputer = Callable[
    [pl.DataFrame, str, ResolvedQuotationEngine],
    Awaitable[pl.DataFrame],
]


@dataclass(frozen=True, slots=True)
class QuotationPage:
    """One source-document page with native grouped quotation values."""

    frame: pl.DataFrame
    page: int
    page_size: int
    total_source_rows: int
    has_next: bool
    sort_by: str | None
    descending: bool


def _prepare_remote_documents(
    base_df: pl.DataFrame, column: str
) -> list[RemoteQuotationDocument]:
    """Build the ordered v2 documents for one source frame."""

    series = base_df.get_column(column)
    documents: list[RemoteQuotationDocument] = []
    for idx, value in enumerate(series.to_list()):
        if value is None:
            text_value = ""
        elif isinstance(value, str):
            text_value = value
        else:
            text_value = str(value)
        documents.append(RemoteQuotationDocument(id=str(idx), text=text_value))
    return documents


def _validate_remote_result(
    document: RemoteQuotationDocument,
    result: RemoteQuotationResult,
) -> None:
    """Require every returned span to map exactly to its source document."""

    for quote in result.quotes:
        for value, start, end, label in (
            (quote.quote, quote.quote_start_idx, quote.quote_end_idx, "quote"),
            (quote.speaker, quote.speaker_start_idx, quote.speaker_end_idx, "speaker"),
            (quote.verb, quote.verb_start_idx, quote.verb_end_idx, "verb"),
        ):
            if value is None:
                continue
            assert start is not None and end is not None
            if end > len(document.text) or document.text[start:end] != value:
                raise ValueError(
                    f"Remote quotation {label} offsets do not match document {document.id}"
                )


async def _extract_remote_batches(
    engine: RemoteResolvedQuotationEngine,
    documents: list[RemoteQuotationDocument],
    *,
    batch_size: int,
    extract_remote_fn: RemoteQuotationExtractor,
) -> RemoteQuotationExtractResponse:
    """Batch remote extraction and require exact ordered document coverage."""

    combined_results: list[RemoteQuotationResult] = []
    for start in range(0, len(documents), batch_size):
        chunk = documents[start : start + batch_size]
        response = await extract_remote_fn(engine, chunk)
        expected_ids = [document.id for document in chunk]
        if [result.id for result in response.results] != expected_ids:
            raise ValueError(
                "Remote quotation response must contain one ordered result per input ID"
            )
        for document, result in zip(chunk, response.results, strict=True):
            _validate_remote_result(document, result)
            combined_results.append(result)

    return RemoteQuotationExtractResponse(version=2, results=combined_results)


def quotation_groups_via_quote_extractor(df: pl.DataFrame, column: str) -> pl.DataFrame:
    """Extract quotations using the vendored QuoteExtractor (replaces polars-text).

    Used by quotation workers and live result queries.
    """
    from .quotation_extractor import quotation_groups_for_dataframe

    return quotation_groups_for_dataframe(df, column)


def _remote_payload_to_grouped_dataframe(
    base_df: pl.DataFrame,
    payload: RemoteQuotationExtractResponse,
) -> pl.DataFrame:
    """Attach remote quotation lists to their source rows without exploding."""
    expected_ids = [str(index) for index in range(base_df.height)]
    if [result.id for result in payload.results] != expected_ids:
        raise ValueError(
            "Remote quotation response does not preserve the complete source order"
        )
    grouped_quotes = [
        [quote.model_dump(mode="python") for quote in result.quotes]
        for result in payload.results
    ]
    return base_df.with_columns(
        pl.Series(
            QUOTATION_GROUP_COLUMN,
            grouped_quotes,
            dtype=QUOTATION_GROUP_DTYPE,
        )
    )


async def compute_quotation_groups(
    base_df: pl.DataFrame,
    column: str,
    engine: ResolvedQuotationEngine,
    *,
    extract_remote_fn: RemoteQuotationExtractor,
    run_blocking: BlockingRunner,
    quotation_service_max_batch_size: int,
) -> pl.DataFrame:
    """Compute grouped quote rows for one node/column pair.

    Why:
    - Abstracts local vs remote extraction behind one shared contract.
    """
    if engine.type is QuotationEngineType.REMOTE:
        documents = await run_blocking(_prepare_remote_documents, base_df, column)
        if not documents:
            return base_df.with_columns(
                pl.Series(QUOTATION_GROUP_COLUMN, [], dtype=QUOTATION_GROUP_DTYPE)
            )
        payload = await _extract_remote_batches(
            engine,
            documents,
            batch_size=quotation_service_max_batch_size,
            extract_remote_fn=extract_remote_fn,
        )
        return await run_blocking(
            _remote_payload_to_grouped_dataframe,
            base_df,
            payload,
        )

    return await run_blocking(quotation_groups_via_quote_extractor, base_df, column)


def _lazyframe_height(lazyframe: pl.LazyFrame) -> int:
    return int(lazyframe.select(pl.len()).collect().item())


def _collect_lazyframe_slice(
    lazyframe: pl.LazyFrame,
    offset: int,
    length: int,
) -> pl.DataFrame:
    return lazyframe.slice(offset, length).collect()


def _quotation_hit_count(frame: pl.DataFrame) -> int:
    count = frame.select(
        pl.col(QUOTATION_GROUP_COLUMN).list.len().fill_null(0).sum().alias("total")
    ).item()
    return int(count or 0)


async def _compute_on_demand_page(
    node: Node,
    column: str,
    engine: ResolvedQuotationEngine,
    *,
    page: int,
    page_size: int | None,
    sort_by: str | None,
    descending: bool,
    compute_groups: QuotationGroupsComputer,
    run_blocking: BlockingRunner,
) -> QuotationPage:
    """Compute one on-demand quotation page from source node data.

    - When `page_size` is None, estimate through bounded density probes.

    Why:
    - Delays expensive quotation extraction to requested slices for responsive
      UI paging while keeping a dense first page via estimation.

    Used by ``AnalysisResultService`` and quotation process workers.
    """
    lazy_df = node.data
    schema = await run_blocking(lazy_df.collect_schema)
    available_columns = set(schema.keys())

    if sort_by is not None and sort_by not in available_columns:
        raise InvalidInputError("Sort column is not available for quotations")
    effective_sort_by = sort_by
    if sort_by is not None:
        lazy_df = lazy_df.sort(
            pl.col(sort_by),
            descending=descending,
        )

    effective_page_size = await _resolve_quotation_page_size(
        lazy_df,
        column,
        engine,
        page_size,
        compute_groups,
        run_blocking,
    )

    total_source_rows = await run_blocking(_lazyframe_height, lazy_df)
    total_source_pages = (
        0
        if total_source_rows == 0
        else max(1, math.ceil(total_source_rows / effective_page_size))
    )

    start_doc = (page - 1) * effective_page_size
    slice_df = await run_blocking(
        _collect_lazyframe_slice,
        lazy_df,
        start_doc,
        effective_page_size,
    )

    quote_df = await compute_groups(slice_df, column, engine)
    page_frame = quote_df.filter(
        pl.col(QUOTATION_GROUP_COLUMN).list.len().fill_null(0) > 0
    )

    return QuotationPage(
        frame=page_frame,
        page=page,
        page_size=effective_page_size,
        total_source_rows=total_source_rows,
        has_next=page < total_source_pages,
        sort_by=effective_sort_by,
        descending=descending,
    )


async def compute_quotation_page(
    node: Node,
    column: str,
    engine: ResolvedQuotationEngine,
    *,
    page: int,
    page_size: int | None,
    sort_by: str | None,
    descending: bool,
    quotation_service_max_batch_size: int,
    extract_remote_fn: RemoteQuotationExtractor,
    run_blocking: BlockingRunner,
) -> QuotationPage:
    """Compute one quotation page with the configured local or remote extractor.

    Flow: bind the provider client and runtime settings to grouped extraction,
    then collect the requested source page.
    """
    compute_groups = partial(
        compute_quotation_groups,
        extract_remote_fn=extract_remote_fn,
        run_blocking=run_blocking,
        quotation_service_max_batch_size=quotation_service_max_batch_size,
    )
    return await _compute_on_demand_page(
        node,
        column,
        engine,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        descending=descending,
        compute_groups=compute_groups,
        run_blocking=run_blocking,
    )


async def _resolve_quotation_page_size(
    lazy_df: pl.LazyFrame,
    column: str,
    engine: ResolvedQuotationEngine,
    requested: int | None,
    compute_groups: QuotationGroupsComputer,
    run_blocking: BlockingRunner,
) -> int:
    """Return an effective page size, estimating from candidate ladder if needed.

    Probe failures are analysis failures; they are never converted into an
    apparently valid sparse page.
    """
    if requested is not None and int(requested) > 0:
        return int(requested)

    from .page_size import DEFAULT_PAGE_SIZE_CANDIDATES, TARGET_OCCURRENCES

    async def _probe(size: int) -> int:
        """Count quotation hits in one bounded source prefix."""

        slice_df = await run_blocking(_collect_lazyframe_slice, lazy_df, 0, size)
        quote_df = await compute_groups(slice_df, column, engine)
        if quote_df.height == 0:
            return 0
        if QUOTATION_GROUP_COLUMN not in quote_df.columns:
            raise ValueError("Quotation result is missing its grouped output column")
        counts = await run_blocking(_quotation_hit_count, quote_df)
        return int(counts or 0)

    for candidate in DEFAULT_PAGE_SIZE_CANDIDATES:
        hits = await _probe(candidate)
        if hits >= TARGET_OCCURRENCES:
            return candidate
    return DEFAULT_PAGE_SIZE_CANDIDATES[-1]
