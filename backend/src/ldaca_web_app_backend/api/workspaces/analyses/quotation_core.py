"""Core quotation analysis helpers shared by API routes."""

from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

import polars as pl

from ....models import QuotationEngineConfig, QuotationEngineType
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

DEFAULT_CONTEXT_LENGTH = 20
MAX_CONTEXT_LENGTH = 2000
DEFAULT_PAGE_SIZE = 100
DEFAULT_DESCENDING = True


def normalize_context_length(value: Any) -> int:
    """Normalize quote-context length into bounded integer limits.

    Used by:
    - quotation request normalization paths
    - `extract_context_preference`

    Why:
    - Prevents invalid or oversized context values from destabilizing parsing.
    """
    try:
        numeric = int(value)
    except TypeError, ValueError:
        return DEFAULT_CONTEXT_LENGTH
    if numeric < 0:
        return 0
    if numeric > MAX_CONTEXT_LENGTH:
        return MAX_CONTEXT_LENGTH
    return numeric


def normalize_pagination(
    page: Optional[int], page_size: Optional[int]
) -> Tuple[int, int]:
    """Normalize page and page-size inputs for quotation views.

    Used by:
    - quotation result endpoints before page computation

    Why:
    - Keeps pagination behavior stable across GET/POST result retrieval flows.
    """
    normalized_page = max(1, int(page)) if isinstance(page, int) else 1
    try:
        normalized_size = int(page_size) if page_size is not None else DEFAULT_PAGE_SIZE
    except TypeError, ValueError:
        normalized_size = DEFAULT_PAGE_SIZE
    if normalized_size <= 0:
        normalized_size = DEFAULT_PAGE_SIZE
    return normalized_page, normalized_size


def extract_context_preference(record_result: Optional[Dict[str, Any]]) -> int:
    """Read preferred context length from a stored quotation payload.

    Used by:
    - quotation result hydration logic

    Why:
    - Reuses saved UI preferences when users revisit existing analysis tasks.
    """
    if not record_result:
        return DEFAULT_CONTEXT_LENGTH
    prefs = record_result.get("preferences")
    if isinstance(prefs, dict) and "context_length" in prefs:
        return normalize_context_length(prefs.get("context_length"))
    return DEFAULT_CONTEXT_LENGTH


def to_polars_dataframe(data: Any) -> pl.DataFrame:
    """Convert node data into an eager Polars DataFrame.

    Used by:
    - `compute_quote_dataframe`

    Why:
    - Enforces strict Polars-only node data contracts for quotation analysis.
    """
    if isinstance(data, pl.LazyFrame):
        return data.collect()

    raise ValueError(
        f"Quotation analysis requires Polars LazyFrame, got {type(data).__name__}"
    )


def empty_quote_dataframe(text_column: Optional[str] = None) -> pl.DataFrame:
    """Return an empty quotation-schema DataFrame.

    Used by:
    - `remote_payload_to_dataframe`
    - `compute_quote_dataframe`

    Why:
    - Ensures callers always receive a predictable schema, even with no quotes.
    """
    columns: Dict[str, pl.Series] = {
        QUOTE_SPEAKER_COLUMN: pl.Series(QUOTE_SPEAKER_COLUMN, [], dtype=pl.Utf8),
        QUOTE_SPEAKER_START_IDX_COLUMN: pl.Series(
            QUOTE_SPEAKER_START_IDX_COLUMN, [], dtype=pl.Int64
        ),
        QUOTE_SPEAKER_END_IDX_COLUMN: pl.Series(
            QUOTE_SPEAKER_END_IDX_COLUMN, [], dtype=pl.Int64
        ),
        QUOTE_QUOTE_COLUMN: pl.Series(QUOTE_QUOTE_COLUMN, [], dtype=pl.Utf8),
        QUOTE_QUOTE_START_IDX_COLUMN: pl.Series(
            QUOTE_QUOTE_START_IDX_COLUMN, [], dtype=pl.Int64
        ),
        QUOTE_QUOTE_END_IDX_COLUMN: pl.Series(
            QUOTE_QUOTE_END_IDX_COLUMN, [], dtype=pl.Int64
        ),
        QUOTE_VERB_COLUMN: pl.Series(QUOTE_VERB_COLUMN, [], dtype=pl.Utf8),
        QUOTE_VERB_START_IDX_COLUMN: pl.Series(
            QUOTE_VERB_START_IDX_COLUMN, [], dtype=pl.Int64
        ),
        QUOTE_VERB_END_IDX_COLUMN: pl.Series(
            QUOTE_VERB_END_IDX_COLUMN, [], dtype=pl.Int64
        ),
        QUOTE_TYPE_COLUMN: pl.Series(QUOTE_TYPE_COLUMN, [], dtype=pl.Utf8),
        QUOTE_TOKEN_COUNT_COLUMN: pl.Series(
            QUOTE_TOKEN_COUNT_COLUMN, [], dtype=pl.Int64
        ),
        QUOTE_IS_FLOATING_COLUMN: pl.Series(
            QUOTE_IS_FLOATING_COLUMN, [], dtype=pl.Boolean
        ),
        QUOTE_ROW_IDX_COLUMN: pl.Series(QUOTE_ROW_IDX_COLUMN, [], dtype=pl.Int64),
    }

    if text_column:
        columns[text_column] = pl.Series(text_column, [], dtype=pl.Utf8)

    return pl.DataFrame(columns)


def ensure_quote_dataframe(
    df: pl.DataFrame, *, text_column: Optional[str] = None
) -> pl.DataFrame:
    """Enforce expected quote dataframe column types and defaults.

    Used by:
    - `remote_payload_to_dataframe`
    - `compute_quote_dataframe`
    - `compute_on_demand_page`

    Why:
    - Normalizes mixed upstream outputs to a stable schema for API responses.
    """
    result = df

    if QUOTE_ROW_IDX_COLUMN not in result.columns:
        result = result.with_columns(
            pl
            .arange(0, result.height, eager=True)
            .cast(pl.Int64)
            .alias(QUOTE_ROW_IDX_COLUMN)
        )

    cast_map = {
        QUOTE_SPEAKER_START_IDX_COLUMN: pl.Int64,
        QUOTE_SPEAKER_END_IDX_COLUMN: pl.Int64,
        QUOTE_QUOTE_START_IDX_COLUMN: pl.Int64,
        QUOTE_QUOTE_END_IDX_COLUMN: pl.Int64,
        QUOTE_VERB_START_IDX_COLUMN: pl.Int64,
        QUOTE_VERB_END_IDX_COLUMN: pl.Int64,
        QUOTE_TOKEN_COUNT_COLUMN: pl.Int64,
        QUOTE_ROW_IDX_COLUMN: pl.Int64,
    }
    numeric_exprs = [
        pl.col(col).cast(dtype, strict=False)
        for col, dtype in cast_map.items()
        if col in result.columns
    ]
    boolean_exprs = []
    if QUOTE_IS_FLOATING_COLUMN in result.columns:
        boolean_exprs.append(
            pl.col(QUOTE_IS_FLOATING_COLUMN).cast(pl.Boolean, strict=False)
        )
    if numeric_exprs or boolean_exprs:
        result = result.with_columns(*numeric_exprs, *boolean_exprs)

    if text_column and text_column not in result.columns:
        result = result.with_columns(pl.lit(None).alias(text_column))

    return result


def prepare_documents_payload(
    base_df: pl.DataFrame, column: str
) -> Dict[str, Dict[str, Any]]:
    """Build remote-extraction payload documents from a source text column.

    Used by:
    - `compute_quote_dataframe` for remote quotation engines

    Why:
    - Adapts tabular node data into the remote service input contract.
    """
    try:
        series = base_df.get_column(column)
    except pl.ColumnNotFoundError as exc:  # pragma: no cover
        raise ValueError(str(exc)) from exc

    docs: Dict[str, Dict[str, Any]] = {}
    for idx, value in enumerate(series.to_list()):
        if value is None:
            text_value = ""
        elif isinstance(value, str):
            text_value = value
        else:
            text_value = str(value)
        docs[str(idx)] = {"text": text_value}
    return docs


def remote_payload_to_dataframe(payload: Dict[str, Any]) -> pl.DataFrame:
    """Convert remote quotation service payloads into quote rows.

    Used by:
    - `compute_quote_dataframe`

    Why:
    - Normalizes service responses to the same structure as local extraction.
    """
    results = payload.get("results", []) if isinstance(payload, dict) else []
    rows = []
    for entry in results:
        quotes = entry.get("quotes") if isinstance(entry, dict) else None
        if not quotes:
            continue
        for quote_idx, quote in enumerate(quotes):
            if not isinstance(quote, dict):
                continue
            rows.append({
                QUOTE_ROW_IDX_COLUMN: quote_idx,
                QUOTE_SPEAKER_COLUMN: quote.get("speaker"),
                QUOTE_SPEAKER_START_IDX_COLUMN: quote.get("speaker_start_idx"),
                QUOTE_SPEAKER_END_IDX_COLUMN: quote.get("speaker_end_idx"),
                QUOTE_QUOTE_COLUMN: quote.get("quote"),
                QUOTE_QUOTE_START_IDX_COLUMN: quote.get("quote_start_idx"),
                QUOTE_QUOTE_END_IDX_COLUMN: quote.get("quote_end_idx"),
                QUOTE_VERB_COLUMN: quote.get("verb"),
                QUOTE_VERB_START_IDX_COLUMN: quote.get("verb_start_idx"),
                QUOTE_VERB_END_IDX_COLUMN: quote.get("verb_end_idx"),
                QUOTE_TYPE_COLUMN: quote.get("quote_type"),
                QUOTE_TOKEN_COUNT_COLUMN: quote.get("quote_token_count"),
                QUOTE_IS_FLOATING_COLUMN: quote.get("is_floating_quote"),
            })

    if not rows:
        return empty_quote_dataframe()

    return ensure_quote_dataframe(pl.DataFrame(rows))


def stable_document_items(
    documents: Dict[str, Dict[str, Any]],
) -> List[Tuple[str, Dict[str, Any]]]:
    """Return deterministically ordered document items for batching.

    Used by:
    - `batched_documents`

    Why:
    - Keeps batch ordering reproducible for pagination and debugging.
    """
    items: List[Tuple[str, Dict[str, Any]]] = list(documents.items())

    def _key(pair: Tuple[str, Dict[str, Any]]) -> Tuple[int, Any]:
        identifier = pair[0]
        try:
            return (0, int(identifier))
        except TypeError, ValueError:
            return (1, identifier)

    items.sort(key=_key)
    return items


def batched_documents(
    documents: Dict[str, Dict[str, Any]],
    batch_size: int,
) -> Iterable[Dict[str, Dict[str, Any]]]:
    """Yield deterministic document chunks for remote extraction.

    Used by:
    - `extract_remote_paginated`

    Why:
    - Splits large requests to honor remote service batch limits.
    """
    if batch_size <= 0:
        batch_size = len(documents) or 1

    ordered_items = stable_document_items(documents)
    for start in range(0, len(ordered_items), batch_size):
        chunk = ordered_items[start : start + batch_size]
        yield {key: value for key, value in chunk}


async def extract_remote_paginated(
    engine: QuotationEngineConfig,
    documents: Dict[str, Dict[str, Any]],
    *,
    batch_size: int,
    timeout: float,
    extract_remote_fn,
) -> Dict[str, Any]:
    """Call remote quotation extraction in batches and merge responses.

    Used by:
    - `compute_quote_dataframe`

    Why:
    - Avoids oversized single requests while preserving one combined payload.
    """
    combined_payload: Dict[str, Any] = {"results": []}
    combined_errors: List[Any] = []
    combined_warnings: List[Any] = []
    meta_captured = False

    for chunk in batched_documents(documents, batch_size):
        payload = await extract_remote_fn(
            engine,
            chunk,
            options={"preprocess": True},
            timeout=timeout,
        )

        if not isinstance(payload, dict):
            continue

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


def quotation_via_polars_text(df: pl.DataFrame, column: str) -> pl.DataFrame:
    """Extract quotations locally using the `polars_text` plugin.

    Used by:
    - `compute_quote_dataframe`

    Why:
    - Provides the in-process quotation path when remote engine is not selected.
    """
    tmp = df.with_columns(pl.col(column).text.quotation().alias("__quotation__"))
    exploded = tmp.explode("__quotation__")
    quote_dtype = exploded.schema.get("__quotation__")
    available_fields: set[str] = set()
    if isinstance(quote_dtype, pl.Struct):
        try:
            available_fields = set(quote_dtype.to_schema().keys())
        except Exception:
            available_fields = set()

    projection_by_field = {
        "speaker": QUOTE_SPEAKER_COLUMN,
        "speaker_start_idx": QUOTE_SPEAKER_START_IDX_COLUMN,
        "speaker_end_idx": QUOTE_SPEAKER_END_IDX_COLUMN,
        "quote": QUOTE_QUOTE_COLUMN,
        "quote_start_idx": QUOTE_QUOTE_START_IDX_COLUMN,
        "quote_end_idx": QUOTE_QUOTE_END_IDX_COLUMN,
        "verb": QUOTE_VERB_COLUMN,
        "verb_start_idx": QUOTE_VERB_START_IDX_COLUMN,
        "verb_end_idx": QUOTE_VERB_END_IDX_COLUMN,
        "quote_type": QUOTE_TYPE_COLUMN,
        "quote_token_count": QUOTE_TOKEN_COUNT_COLUMN,
        "is_floating_quote": QUOTE_IS_FLOATING_COLUMN,
        "quote_row_idx": QUOTE_ROW_IDX_COLUMN,
    }
    struct_projection = [
        pl.col("__quotation__").struct.field(field_name).alias(alias)
        for field_name, alias in projection_by_field.items()
        if field_name in available_fields
    ]

    return exploded.select([
        pl.exclude("__quotation__"),
        *struct_projection,
    ])


async def compute_quote_dataframe(
    node: Any,
    base_df: pl.DataFrame,
    column: str,
    engine: QuotationEngineConfig,
    *,
    use_base_only: bool = False,
    extract_remote_fn,
    quotation_service_max_batch_size: int,
    quotation_service_timeout: float,
) -> pl.DataFrame:
    """Compute normalized quote rows for one node/column pair.

    Used by:
    - quotation API endpoints and on-demand page computation flow

    Why:
    - Abstracts local vs remote extraction behind one shared contract.
    """
    if engine.type is QuotationEngineType.REMOTE:
        documents = prepare_documents_payload(base_df, column)
        if not documents:
            return empty_quote_dataframe(text_column=column)
        payload = await extract_remote_paginated(
            engine,
            documents,
            batch_size=max(1, int(quotation_service_max_batch_size or 0)),
            timeout=quotation_service_timeout,
            extract_remote_fn=extract_remote_fn,
        )
        quote_df = remote_payload_to_dataframe(payload)
        return ensure_quote_dataframe(quote_df, text_column=column)

    if not use_base_only:
        node_data = getattr(node, "data", None)
        if node_data is None:
            raise ValueError("Node has no data")

        source_df = to_polars_dataframe(node_data)
        quote_raw = quotation_via_polars_text(source_df, column)
        return ensure_quote_dataframe(quote_raw, text_column=column)

    quote_raw = quotation_via_polars_text(base_df, column)
    return ensure_quote_dataframe(quote_raw, text_column=column)


async def compute_on_demand_page(
    node: Any,
    column: str,
    engine: QuotationEngineConfig,
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    descending: bool,
    compute_quote_dataframe_fn,
) -> Dict[str, Any]:
    """Compute one on-demand quotation page from source node data.

    Used by:
    - quotation result endpoints with pagination/sorting

    Why:
    - Delays expensive quotation extraction to requested slices for responsive
      UI paging.
    """
    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise ValueError("Node data must be a LazyFrame")

    lazy_df = node_data
    try:
        schema = lazy_df.collect_schema()
        available_columns = set(schema.keys())
    except Exception:
        available_columns = set()

    if column not in available_columns:
        raise ValueError(
            f"Column '{column}' not found. Available columns: {list(available_columns)}"
        )

    effective_sort_by = sort_by if sort_by and sort_by in available_columns else None

    if effective_sort_by:
        lazy_df = lazy_df.sort(
            pl.col(effective_sort_by),
            descending=descending,
        )

    total_source_rows = lazy_df.select(pl.len()).collect().item()
    total_source_pages = max(1, math.ceil(total_source_rows / page_size))

    start_doc = (page - 1) * page_size
    slice_df = lazy_df.slice(start_doc, page_size).collect()

    quote_df = await compute_quote_dataframe_fn(
        node, slice_df, column, engine, use_base_only=True
    )
    quote_df = ensure_quote_dataframe(quote_df, text_column=column)

    if QUOTE_QUOTE_COLUMN in quote_df.columns:
        quote_df = quote_df.filter(pl.col(QUOTE_QUOTE_COLUMN).is_not_null())

    result_count = quote_df.height

    return {
        "data": quote_df.to_dicts(),
        "columns": list(quote_df.columns),
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_source_rows": total_source_rows,
            "total_source_pages": total_source_pages,
            "result_count": result_count,
            "has_next": page < total_source_pages,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "descending": descending,
        },
        "column": column,
    }
