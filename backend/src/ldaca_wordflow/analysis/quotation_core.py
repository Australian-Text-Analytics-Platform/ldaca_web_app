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

import logging
import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from typing import Any, cast
from collections.abc import Iterable

import polars as pl
from polars.exceptions import ColumnNotFoundError

from ..domain.workspace import Node
from ..shared.errors import InvalidInputError
from ..models.quotation import QuotationEngineType, ResolvedQuotationEngine
from .generated_columns import (
    QUOTE_COLUMN_NAMES,
    QUOTE_IS_FLOATING_COLUMN,
    QUOTE_QUOTE_COLUMN,
    QUOTE_QUOTE_END_IDX_COLUMN,
    QUOTE_QUOTE_START_IDX_COLUMN,
    QUOTE_ROW_IDX_COLUMN,
    QUOTE_SPEAKER_COLUMN,
    QUOTE_SPEAKER_END_IDX_COLUMN,
    QUOTE_SPEAKER_START_IDX_COLUMN,
    QUOTE_TOKEN_COUNT_COLUMN,
    QUOTE_TYPE_COLUMN,
    QUOTE_VERB_COLUMN,
    QUOTE_VERB_END_IDX_COLUMN,
    QUOTE_VERB_START_IDX_COLUMN,
)

logger = logging.getLogger(__name__)

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
CORE_QUOTATION_COLUMNS = QUOTE_COLUMN_NAMES

RemoteQuotationExtractor = Callable[..., Awaitable[dict[str, Any]]]
BlockingRunner = Callable[..., Awaitable[Any]]


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


def to_polars_dataframe(data: Any) -> pl.DataFrame:
    """Convert node data into an eager Polars DataFrame.





    Why:
    - Enforces strict Polars-only node data contracts for quotation analysis.
    """
    if isinstance(data, pl.LazyFrame):
        return data.collect()

    raise ValueError(
        f"Quotation analysis requires Polars LazyFrame, got {type(data).__name__}"
    )


def prepare_documents_payload(
    base_df: pl.DataFrame, column: str
) -> dict[str, dict[str, Any]]:
    """Build remote-extraction payload documents from a source text column.





    Why:
    - Adapts tabular node data into the remote service input contract.
    """
    try:
        series = base_df.get_column(column)
    except ColumnNotFoundError as exc:  # pragma: no cover
        raise ValueError(str(exc)) from exc

    docs: dict[str, dict[str, Any]] = {}
    for idx, value in enumerate(series.to_list()):
        if value is None:
            text_value = ""
        elif isinstance(value, str):
            text_value = value
        else:
            text_value = str(value)
        docs[str(idx)] = {"text": text_value}
    return docs


def stable_document_items(
    documents: dict[str, dict[str, Any]],
) -> list[tuple[str, dict[str, Any]]]:
    """Return deterministically ordered document items for batching.





    Why:
    - Keeps batch ordering reproducible for pagination and debugging.
    """
    items: list[tuple[str, dict[str, Any]]] = list(documents.items())

    def _key(pair: tuple[str, dict[str, Any]]) -> tuple[int, Any]:
        """Support quotation computation helpers with a key helper."""

        identifier = pair[0]
        try:
            return (0, int(identifier))
        except TypeError, ValueError:
            logger.debug("Non-numeric document key %r, sorting as string", identifier)
            return (1, identifier)

    items.sort(key=_key)
    return items


def batched_documents(
    documents: dict[str, dict[str, Any]],
    batch_size: int,
) -> Iterable[dict[str, dict[str, Any]]]:
    """Yield deterministic document chunks for remote extraction.





    Why:
    - Splits large requests to honor remote service batch limits.
    """
    if batch_size <= 0:
        raise ValueError("Quotation batch size must be positive")

    ordered_items = stable_document_items(documents)
    for start in range(0, len(ordered_items), batch_size):
        chunk = ordered_items[start : start + batch_size]
        yield {key: value for key, value in chunk}


async def extract_remote_paginated(
    engine: ResolvedQuotationEngine,
    documents: dict[str, dict[str, Any]],
    *,
    batch_size: int,
    timeout: float,
    extract_remote_fn: RemoteQuotationExtractor,
) -> dict[str, Any]:
    """Call remote quotation extraction in batches and merge responses.





    Why:
    - Avoids oversized single requests while preserving one combined payload.
    """
    combined_payload: dict[str, Any] = {"results": []}
    combined_errors: list[Any] = []
    combined_warnings: list[Any] = []
    meta_captured = False

    for chunk in batched_documents(documents, batch_size):
        payload = await extract_remote_fn(
            engine,
            chunk,
            options={"preprocess": True},
            timeout=timeout,
        )

        if not isinstance(payload, dict):
            raise ValueError("Quotation provider returned an invalid payload")

        results = payload.get("results")
        if isinstance(results, list):
            combined_payload["results"].extend(results)

        errors = payload.get("errors")
        if isinstance(errors, list):
            combined_errors.extend(errors)

        warnings = payload.get("warnings")
        if isinstance(warnings, list):
            combined_warnings.extend(warnings)

        if not meta_captured and "meta" in payload:
            combined_payload["meta"] = payload["meta"]
            meta_captured = True

    if combined_errors:
        combined_payload["errors"] = combined_errors
    if combined_warnings:
        combined_payload["warnings"] = combined_warnings

    return combined_payload


def quotation_groups_via_quote_extractor(df: pl.DataFrame, column: str) -> pl.DataFrame:
    """Extract quotations using the vendored QuoteExtractor (replaces polars-text).

    Used by quotation workers and live result queries.
    """
    from .quotation_extractor import quotation_groups_for_dataframe

    return quotation_groups_for_dataframe(df, column)


def remote_payload_to_grouped_dataframe(
    base_df: pl.DataFrame,
    payload: dict[str, Any],
) -> pl.DataFrame:
    """Attach remote quotation lists to their source rows without exploding."""
    results = payload.get("results", []) if isinstance(payload, dict) else []
    quotes_by_identifier: dict[str, list[dict[str, Any]]] = {}

    for result_index, entry in enumerate(results):
        if not isinstance(entry, dict):
            continue
        identifier_value = entry.get("identifier")
        identifier = (
            str(identifier_value) if identifier_value is not None else str(result_index)
        )
        quotes = entry.get("quotes")
        if not isinstance(quotes, list):
            quotes_by_identifier[identifier] = []
            continue

        normalized_quotes: list[dict[str, Any]] = []
        for quote_idx, quote in enumerate(quotes):
            if not isinstance(quote, dict):
                continue
            quote_record = cast(dict[str, Any], quote)
            normalized_quotes.append(
                {
                    "speaker": quote_record.get("speaker"),
                    "speaker_start_idx": quote_record.get("speaker_start_idx"),
                    "speaker_end_idx": quote_record.get("speaker_end_idx"),
                    "quote": quote_record.get("quote"),
                    "quote_start_idx": quote_record.get("quote_start_idx"),
                    "quote_end_idx": quote_record.get("quote_end_idx"),
                    "verb": quote_record.get("verb"),
                    "verb_start_idx": quote_record.get("verb_start_idx"),
                    "verb_end_idx": quote_record.get("verb_end_idx"),
                    "quote_type": quote_record.get("quote_type"),
                    "quote_token_count": quote_record.get("quote_token_count"),
                    "is_floating_quote": quote_record.get("is_floating_quote"),
                    "quote_row_idx": quote_record.get("quote_row_idx", quote_idx),
                }
            )
        quotes_by_identifier[identifier] = normalized_quotes

    grouped_quotes = [
        quotes_by_identifier.get(str(idx), []) for idx in range(base_df.height)
    ]
    return base_df.with_columns(
        pl.Series(
            QUOTATION_GROUP_COLUMN,
            grouped_quotes,
            dtype=QUOTATION_GROUP_DTYPE,
            strict=False,
        )
    )


def _project_quotation_hit(raw_hit: dict[str, Any]) -> dict[str, Any]:
    """Project raw quotation-struct fields into canonical quotation columns."""
    return {
        QUOTE_SPEAKER_COLUMN: raw_hit.get("speaker"),
        QUOTE_SPEAKER_START_IDX_COLUMN: raw_hit.get("speaker_start_idx"),
        QUOTE_SPEAKER_END_IDX_COLUMN: raw_hit.get("speaker_end_idx"),
        QUOTE_QUOTE_COLUMN: raw_hit.get("quote"),
        QUOTE_QUOTE_START_IDX_COLUMN: raw_hit.get("quote_start_idx"),
        QUOTE_QUOTE_END_IDX_COLUMN: raw_hit.get("quote_end_idx"),
        QUOTE_VERB_COLUMN: raw_hit.get("verb"),
        QUOTE_VERB_START_IDX_COLUMN: raw_hit.get("verb_start_idx"),
        QUOTE_VERB_END_IDX_COLUMN: raw_hit.get("verb_end_idx"),
        QUOTE_TYPE_COLUMN: raw_hit.get("quote_type"),
        QUOTE_TOKEN_COUNT_COLUMN: raw_hit.get("quote_token_count"),
        QUOTE_IS_FLOATING_COLUMN: raw_hit.get("is_floating_quote"),
        QUOTE_ROW_IDX_COLUMN: raw_hit.get("quote_row_idx"),
    }


def _quotation_hit_has_content(hit: dict[str, Any]) -> bool:
    """Return whether a projected quotation hit contains meaningful content."""
    for key in (QUOTE_QUOTE_COLUMN, QUOTE_SPEAKER_COLUMN, QUOTE_VERB_COLUMN):
        value = hit.get(key)
        if value is None:
            continue
        if str(value).strip():
            return True
    return False


def _empty_flattened_quotation_dataframe(result_df: pl.DataFrame) -> pl.DataFrame:
    """Support quotation computation helpers with an empty flattened quotation dataframe helper."""

    metadata_columns = [
        column for column in result_df.columns if column != QUOTATION_GROUP_COLUMN
    ]
    schema: dict[str, pl.DataType] = {
        **{column: result_df.schema[column] for column in metadata_columns},
        QUOTE_SPEAKER_COLUMN: cast(pl.DataType, pl.Utf8),
        QUOTE_SPEAKER_START_IDX_COLUMN: cast(pl.DataType, pl.Int64),
        QUOTE_SPEAKER_END_IDX_COLUMN: cast(pl.DataType, pl.Int64),
        QUOTE_QUOTE_COLUMN: cast(pl.DataType, pl.Utf8),
        QUOTE_QUOTE_START_IDX_COLUMN: cast(pl.DataType, pl.Int64),
        QUOTE_QUOTE_END_IDX_COLUMN: cast(pl.DataType, pl.Int64),
        QUOTE_VERB_COLUMN: cast(pl.DataType, pl.Utf8),
        QUOTE_VERB_START_IDX_COLUMN: cast(pl.DataType, pl.Int64),
        QUOTE_VERB_END_IDX_COLUMN: cast(pl.DataType, pl.Int64),
        QUOTE_TYPE_COLUMN: cast(pl.DataType, pl.Utf8),
        QUOTE_TOKEN_COUNT_COLUMN: cast(pl.DataType, pl.Int64),
        QUOTE_IS_FLOATING_COLUMN: cast(pl.DataType, pl.Boolean),
        QUOTE_ROW_IDX_COLUMN: cast(pl.DataType, pl.Int64),
    }
    return pl.DataFrame(schema=schema)


def flatten_grouped_quotation_dataframe(result_df: pl.DataFrame) -> pl.DataFrame:
    """Flatten grouped quotation rows for Data Block Creation or export.



    Used by Quotation Run All.
    """
    if result_df.height == 0:
        return _empty_flattened_quotation_dataframe(result_df)

    flattened_rows: list[dict[str, Any]] = []
    for row in result_df.to_dicts():
        raw_hits = row.get(QUOTATION_GROUP_COLUMN) or []
        if not isinstance(raw_hits, list):
            continue

        base_row = {
            key: value for key, value in row.items() if key != QUOTATION_GROUP_COLUMN
        }
        for raw_hit in raw_hits:
            if not isinstance(raw_hit, dict):
                continue
            projected_hit = {
                **base_row,
                **_project_quotation_hit(raw_hit),
            }
            if _quotation_hit_has_content(projected_hit):
                flattened_rows.append(projected_hit)

    if not flattened_rows:
        return _empty_flattened_quotation_dataframe(result_df)

    metadata_columns = [
        column for column in result_df.columns if column != QUOTATION_GROUP_COLUMN
    ]
    ordered_columns = [*metadata_columns, *CORE_QUOTATION_COLUMNS]
    return pl.DataFrame(flattened_rows).select(ordered_columns)


async def compute_quote_dataframe(
    node: Node,
    base_df: pl.DataFrame,
    column: str,
    engine: ResolvedQuotationEngine,
    *,
    use_base_only: bool = False,
    extract_remote_fn: RemoteQuotationExtractor,
    run_blocking: BlockingRunner,
    quotation_service_max_batch_size: int,
    quotation_service_timeout: float,
) -> pl.DataFrame:
    """Compute grouped quote rows for one node/column pair.
    Why:
    - Abstracts local vs remote extraction behind one shared contract.
    """
    if engine.type is QuotationEngineType.REMOTE:
        documents = await run_blocking(prepare_documents_payload, base_df, column)
        if not documents:
            return base_df.with_columns(
                pl.Series(QUOTATION_GROUP_COLUMN, [], dtype=QUOTATION_GROUP_DTYPE)
            )
        payload = await extract_remote_paginated(
            engine,
            documents,
            batch_size=quotation_service_max_batch_size,
            timeout=quotation_service_timeout,
            extract_remote_fn=extract_remote_fn,
        )
        return await run_blocking(remote_payload_to_grouped_dataframe, base_df, payload)

    if not use_base_only:
        node_data = node.data
        source_df = await run_blocking(to_polars_dataframe, node_data)
        return await run_blocking(
            quotation_groups_via_quote_extractor, source_df, column
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


async def compute_on_demand_page(
    node: Node,
    column: str,
    engine: ResolvedQuotationEngine,
    *,
    page: int,
    page_size: int | None,
    sort_by: str | None,
    descending: bool,
    compute_quote_dataframe_fn,
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
        node,
        column,
        engine,
        page_size,
        compute_quote_dataframe_fn,
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

    quote_df = await compute_quote_dataframe_fn(
        node, slice_df, column, engine, use_base_only=True
    )
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
    quotation_service_timeout: float,
    extract_remote_fn: RemoteQuotationExtractor,
    run_blocking: BlockingRunner,
) -> QuotationPage:
    """Compute one quotation page with the configured local/remote extractor.



    Flow: bind the configured quotation service client and settings to
        ``compute_quote_dataframe``, then delegate page collection to
        ``compute_on_demand_page``.
    """
    compute_quote_dataframe_fn = partial(
        compute_quote_dataframe,
        extract_remote_fn=extract_remote_fn,
        run_blocking=run_blocking,
        quotation_service_max_batch_size=quotation_service_max_batch_size,
        quotation_service_timeout=quotation_service_timeout,
    )
    return await compute_on_demand_page(
        node,
        column,
        engine,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        descending=descending,
        compute_quote_dataframe_fn=compute_quote_dataframe_fn,
        run_blocking=run_blocking,
    )


async def _resolve_quotation_page_size(
    lazy_df: pl.LazyFrame,
    node: Node,
    column: str,
    engine: ResolvedQuotationEngine,
    requested: int | None,
    compute_quote_dataframe_fn,
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
        quote_df = await compute_quote_dataframe_fn(
            node, slice_df, column, engine, use_base_only=True
        )
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
