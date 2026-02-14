"""Core quotation analysis helpers shared by API routes."""

from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

import polars as pl

from ....models import QuotationEngineConfig, QuotationEngineType

DEFAULT_CONTEXT_LENGTH = 20
MAX_CONTEXT_LENGTH = 2000
DEFAULT_PAGE_SIZE = 100
DEFAULT_SORT_ORDER = "asc"


def normalize_context_length(value: Any) -> int:
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
    normalized_page = max(1, int(page)) if isinstance(page, int) else 1
    try:
        normalized_size = int(page_size) if page_size is not None else DEFAULT_PAGE_SIZE
    except TypeError, ValueError:
        normalized_size = DEFAULT_PAGE_SIZE
    if normalized_size <= 0:
        normalized_size = DEFAULT_PAGE_SIZE
    return normalized_page, normalized_size


def extract_context_preference(record_result: Optional[Dict[str, Any]]) -> int:
    if not record_result:
        return DEFAULT_CONTEXT_LENGTH
    prefs = record_result.get("preferences")
    if isinstance(prefs, dict) and "context_length" in prefs:
        return normalize_context_length(prefs.get("context_length"))
    return DEFAULT_CONTEXT_LENGTH


def to_polars_dataframe(data: Any) -> pl.DataFrame:
    if isinstance(data, pl.DataFrame):
        return data
    if isinstance(data, pl.LazyFrame):
        return data.collect()

    if hasattr(data, "collect"):
        try:
            collected = data.collect()
            if isinstance(collected, pl.LazyFrame):
                return collected.collect()
            if isinstance(collected, pl.DataFrame):
                return collected
        except Exception:  # pragma: no cover
            pass

    return pl.DataFrame(data)


def empty_quote_dataframe(text_column: Optional[str] = None) -> pl.DataFrame:
    columns: Dict[str, pl.Series] = {
        "speaker": pl.Series("speaker", [], dtype=pl.Utf8),
        "speaker_start_idx": pl.Series("speaker_start_idx", [], dtype=pl.Int64),
        "speaker_end_idx": pl.Series("speaker_end_idx", [], dtype=pl.Int64),
        "quote": pl.Series("quote", [], dtype=pl.Utf8),
        "quote_start_idx": pl.Series("quote_start_idx", [], dtype=pl.Int64),
        "quote_end_idx": pl.Series("quote_end_idx", [], dtype=pl.Int64),
        "verb": pl.Series("verb", [], dtype=pl.Utf8),
        "verb_start_idx": pl.Series("verb_start_idx", [], dtype=pl.Int64),
        "verb_end_idx": pl.Series("verb_end_idx", [], dtype=pl.Int64),
        "quote_type": pl.Series("quote_type", [], dtype=pl.Utf8),
        "quote_token_count": pl.Series("quote_token_count", [], dtype=pl.Int64),
        "is_floating_quote": pl.Series("is_floating_quote", [], dtype=pl.Boolean),
        "quote_row_idx": pl.Series("quote_row_idx", [], dtype=pl.Int64),
    }

    if text_column:
        columns[text_column] = pl.Series(text_column, [], dtype=pl.Utf8)

    return pl.DataFrame(columns)


def ensure_quote_dataframe(
    df: pl.DataFrame, *, text_column: Optional[str] = None
) -> pl.DataFrame:
    result = df

    if "quote_row_idx" not in result.columns:
        result = result.with_columns(
            pl
            .arange(0, result.height, eager=True)
            .cast(pl.Int64)
            .alias("quote_row_idx")
        )

    cast_map = {
        "speaker_start_idx": pl.Int64,
        "speaker_end_idx": pl.Int64,
        "quote_start_idx": pl.Int64,
        "quote_end_idx": pl.Int64,
        "verb_start_idx": pl.Int64,
        "verb_end_idx": pl.Int64,
        "quote_token_count": pl.Int64,
        "quote_row_idx": pl.Int64,
    }
    numeric_exprs = [
        pl.col(col).cast(dtype, strict=False)
        for col, dtype in cast_map.items()
        if col in result.columns
    ]
    boolean_exprs = []
    if "is_floating_quote" in result.columns:
        boolean_exprs.append(pl.col("is_floating_quote").cast(pl.Boolean, strict=False))
    if numeric_exprs or boolean_exprs:
        result = result.with_columns(*numeric_exprs, *boolean_exprs)

    if text_column and text_column not in result.columns:
        result = result.with_columns(pl.lit(None).alias(text_column))

    return result


def prepare_documents_payload(
    base_df: pl.DataFrame, column: str
) -> Dict[str, Dict[str, Any]]:
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
                "quote_row_idx": quote_idx,
                "speaker": quote.get("speaker"),
                "speaker_start_idx": quote.get("speaker_start_idx"),
                "speaker_end_idx": quote.get("speaker_end_idx"),
                "quote": quote.get("quote"),
                "quote_start_idx": quote.get("quote_start_idx"),
                "quote_end_idx": quote.get("quote_end_idx"),
                "verb": quote.get("verb"),
                "verb_start_idx": quote.get("verb_start_idx"),
                "verb_end_idx": quote.get("verb_end_idx"),
                "quote_type": quote.get("quote_type"),
                "quote_token_count": quote.get("quote_token_count"),
                "is_floating_quote": quote.get("is_floating_quote"),
            })

    if not rows:
        return empty_quote_dataframe()

    return ensure_quote_dataframe(pl.DataFrame(rows))


def stable_document_items(
    documents: Dict[str, Dict[str, Any]],
) -> List[Tuple[str, Dict[str, Any]]]:
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
    tmp = df.with_columns(pl.col(column).text.quotation().alias("__quotation__"))
    exploded = tmp.explode("__quotation__")
    return exploded.unnest("__quotation__")


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
    sort_order: str,
    compute_quote_dataframe_fn,
    normalize_sort_order_fn,
) -> Dict[str, Any]:
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
    normalized_sort_order = normalize_sort_order_fn(sort_order)

    if effective_sort_by:
        lazy_df = lazy_df.sort(
            pl.col(effective_sort_by),
            descending=normalized_sort_order == "desc",
        )

    total_source_rows = lazy_df.select(pl.len()).collect().item()
    total_source_pages = max(1, math.ceil(total_source_rows / page_size))

    start_doc = (page - 1) * page_size
    slice_df = lazy_df.slice(start_doc, page_size).collect()

    quote_df = await compute_quote_dataframe_fn(
        node, slice_df, column, engine, use_base_only=True
    )
    quote_df = ensure_quote_dataframe(quote_df, text_column=column)

    if "quote" in quote_df.columns:
        quote_df = quote_df.filter(pl.col("quote").is_not_null())

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
            "sort_order": normalized_sort_order,
        },
        "column": column,
    }
