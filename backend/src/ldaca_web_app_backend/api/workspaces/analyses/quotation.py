"""Quotation analysis endpoints with cached/paginated result retrieval."""

import logging
import math
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....core.analysis_admin import clear_quotation_cache_for
from ....core.auth import get_current_user
from ....core.services.quotation_client import (
    QuotationServiceError,
    extract_remote_quotations,
)
from ....core.workspace import workspace_manager
from ....models import (
    QuotationDetachRequest,
    QuotationEngineConfig,
    QuotationEngineType,
    QuotationRequest,
    QuotationResultQuery,
)
from ....settings import settings
from ..utils import get_node_with_data_or_400

logger = logging.getLogger(__name__)

DEFAULT_CONTEXT_LENGTH = 20
MAX_CONTEXT_LENGTH = 2000
DEFAULT_PAGE_SIZE = 50
DEFAULT_SORT_ORDER = "asc"

QUOTATION_CACHE: Dict[
    Tuple[str, str, str, str, str, str], Dict[str, Any]
] = {}

_REQUEST_STORAGE_EXCLUDE = {"page", "page_size", "sort_by", "sort_order"}


def _normalize_context_length(value: Any) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return DEFAULT_CONTEXT_LENGTH
    if numeric < 0:
        return 0
    if numeric > MAX_CONTEXT_LENGTH:
        return MAX_CONTEXT_LENGTH
    return numeric


def _quotation_cache_key(
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    engine: QuotationEngineConfig,
) -> Tuple[str, str, str, str, str, str]:
    normalized_url = (engine.url or "").strip().lower() if engine.url else ""
    return (
        user_id,
        workspace_id,
        node_id,
        column,
        engine.type.value,
        normalized_url,
    )


def _get_cached_quotation_df(key: Tuple[str, str, str, str, str, str]) -> Optional[pl.DataFrame]:
    entry = QUOTATION_CACHE.get(key)
    if not entry:
        return None
    return entry.get("df")


def _store_cached_quotation_df(
    key: Tuple[str, str, str, str, str, str], df: pl.DataFrame
) -> None:
    QUOTATION_CACHE[key] = {"df": df, "created": time.time()}


def _sanitize_request_for_storage(request_dict: Dict[str, Any]) -> Dict[str, Any]:
    sanitized: Dict[str, Any] = {}
    for key, value in request_dict.items():
        if key in _REQUEST_STORAGE_EXCLUDE:
            continue
        if value is None:
            continue
        sanitized[key] = value
    return sanitized


def _normalize_sort_order(sort_order: Optional[str]) -> str:
    if isinstance(sort_order, str) and sort_order.lower() == "desc":
        return "desc"
    return DEFAULT_SORT_ORDER


def _normalize_pagination(page: Optional[int], page_size: Optional[int]) -> Tuple[int, int]:
    normalized_page = max(1, int(page)) if isinstance(page, int) else 1
    try:
        normalized_size = int(page_size) if page_size is not None else DEFAULT_PAGE_SIZE
    except (TypeError, ValueError):
        normalized_size = DEFAULT_PAGE_SIZE
    if normalized_size <= 0:
        normalized_size = DEFAULT_PAGE_SIZE
    return normalized_page, normalized_size


def _paginate_dataframe(
    df: pl.DataFrame,
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    sort_order: str,
) -> Dict[str, Any]:
    working = df
    effective_sort_by = sort_by if sort_by and sort_by in working.columns else None
    normalized_sort_order = _normalize_sort_order(sort_order)
    if effective_sort_by:
        working = working.sort(
            pl.col(effective_sort_by), descending=normalized_sort_order == "desc"
        )

    total_rows = working.height
    total_pages = max(1, math.ceil(total_rows / page_size)) if total_rows else 1
    if page > total_pages:
        page = total_pages
    if page < 1:
        page = 1
    start_idx = (page - 1) * page_size
    paginated = working.slice(start_idx, page_size)

    return {
        "data": paginated.to_dicts(),
        "columns": list(working.columns),
        "total_rows": total_rows,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "has_next": (start_idx + page_size) < total_rows,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "sort_order": normalized_sort_order,
        },
    }


def _rows_to_dataframe(rows: List[Dict[str, Any]], columns: Optional[List[str]] = None) -> pl.DataFrame:
    if rows:
        return pl.DataFrame(rows)
    if columns:
        return pl.DataFrame({col: [] for col in columns})
    return pl.DataFrame([])


def _paginate_from_storage(
    stored_blob: Dict[str, Any],
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    sort_order: Optional[str],
) -> Dict[str, Any]:
    rows = stored_blob.get("rows") or []
    columns = stored_blob.get("columns")
    df = _rows_to_dataframe(rows, columns)
    default_sort_by = stored_blob.get("default_sort_by")
    default_sort_order = stored_blob.get("default_sort_order")
    effective_sort_by = sort_by or default_sort_by
    effective_sort_order = sort_order or default_sort_order
    normalized_sort_order = _normalize_sort_order(effective_sort_order)
    paginated = _paginate_dataframe(
        df,
        page=page,
        page_size=page_size,
        sort_by=effective_sort_by,
        sort_order=normalized_sort_order,
    )
    return paginated


def _extract_context_preference(record_result: Optional[Dict[str, Any]]) -> int:
    if not record_result:
        return DEFAULT_CONTEXT_LENGTH
    prefs = record_result.get("preferences")
    if isinstance(prefs, dict) and "context_length" in prefs:
        return _normalize_context_length(prefs.get("context_length"))
    return DEFAULT_CONTEXT_LENGTH


def _to_polars_dataframe(data: Any) -> pl.DataFrame:
    """Best-effort conversion of docframe/Polars-like objects into a Polars DataFrame."""

    if isinstance(data, pl.DataFrame):
        return data
    if isinstance(data, pl.LazyFrame):
        return data.collect()

    if hasattr(data, "to_lazyframe"):
        try:
            lazy = data.to_lazyframe()
            if isinstance(lazy, pl.LazyFrame):
                return lazy.collect()
        except Exception:  # pragma: no cover - docframe specific types
            pass

    if hasattr(data, "collect"):
        try:
            collected = data.collect()
            if isinstance(collected, pl.LazyFrame):
                return collected.collect()
            if isinstance(collected, pl.DataFrame):
                return collected
        except Exception:  # pragma: no cover
            pass

    if hasattr(data, "_df"):
        try:
            df = data._df
            if isinstance(df, pl.DataFrame):
                return df
        except Exception:  # pragma: no cover
            pass

    return pl.DataFrame(data)


def _empty_quote_dataframe() -> pl.DataFrame:
    return pl.DataFrame({
        "document_idx": pl.Series("document_idx", [], dtype=pl.Int64),
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
    })


def _materialise_base_dataframe(node_data: Any) -> pl.DataFrame:
    base_df = _to_polars_dataframe(node_data)
    if not isinstance(base_df, pl.DataFrame):
        base_df = pl.DataFrame(base_df)
    return base_df


def _ensure_quote_dataframe(df: pl.DataFrame) -> pl.DataFrame:
    result = df
    if "document_idx" not in result.columns:
        result = result.with_row_index("document_idx")
    if "quote_row_idx" not in result.columns:
        result = result.with_columns(
            pl.arange(0, result.height, eager=True)
            .cast(pl.Int64)
            .alias("quote_row_idx")
        )
    # Enforce stable dtypes for numeric columns used downstream
    cast_map = {
        "document_idx": pl.Int64,
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
    return result


def _prepare_documents_payload(
    base_df: pl.DataFrame, column: str
) -> Dict[str, Dict[str, Any]]:
    try:
        series = base_df.get_column(column)
    except (
        pl.ColumnNotFoundError
    ) as exc:  # pragma: no cover - safety net (should be caught earlier)
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


def _remote_payload_to_dataframe(payload: Dict[str, Any]) -> pl.DataFrame:
    results = payload.get("results", []) if isinstance(payload, dict) else []
    rows = []
    for entry in results:
        identifier = entry.get("identifier") if isinstance(entry, dict) else None
        if identifier is None:
            continue
        try:
            document_idx = int(identifier)
        except (TypeError, ValueError):
            logger.debug(
                "Skipping quotation entry with non-integer identifier: %s", identifier
            )
            continue
        quotes = entry.get("quotes") if isinstance(entry, dict) else None
        if not quotes:
            continue
        for quote_idx, quote in enumerate(quotes):
            if not isinstance(quote, dict):
                continue
            rows.append({
                "document_idx": document_idx,
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
        return _empty_quote_dataframe()

    return _ensure_quote_dataframe(pl.DataFrame(rows))


def _stable_document_items(
    documents: Dict[str, Dict[str, Any]],
) -> List[Tuple[str, Dict[str, Any]]]:
    items: List[Tuple[str, Dict[str, Any]]] = list(documents.items())

    def _key(pair: Tuple[str, Dict[str, Any]]) -> Tuple[int, Any]:
        identifier = pair[0]
        try:
            return (0, int(identifier))
        except (TypeError, ValueError):
            return (1, identifier)

    items.sort(key=_key)
    return items


def _batched_documents(
    documents: Dict[str, Dict[str, Any]],
    batch_size: int,
) -> Iterable[Dict[str, Dict[str, Any]]]:
    if batch_size <= 0:
        batch_size = len(documents) or 1

    ordered_items = _stable_document_items(documents)
    for start in range(0, len(ordered_items), batch_size):
        chunk = ordered_items[start : start + batch_size]
        yield {key: value for key, value in chunk}


async def _extract_remote_paginated(
    engine: QuotationEngineConfig,
    documents: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    batch_size = max(1, int(settings.quotation_service_max_batch_size or 0))

    combined_payload: Dict[str, Any] = {"results": []}
    combined_errors: List[Any] = []
    combined_warnings: List[Any] = []
    meta_captured = False

    for chunk in _batched_documents(documents, batch_size):
        payload = await extract_remote_quotations(
            engine,
            chunk,
            options={"preprocess": True},
            timeout=settings.quotation_service_timeout,
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


async def _compute_quote_dataframe(
    node: Any,
    base_df: pl.DataFrame,
    column: str,
    engine: QuotationEngineConfig,
) -> pl.DataFrame:
    if engine.type is QuotationEngineType.REMOTE:
        documents = _prepare_documents_payload(base_df, column)
        if not documents:
            return _empty_quote_dataframe()
        payload = await _extract_remote_paginated(engine, documents)
        return _remote_payload_to_dataframe(payload)

    base_with_idx = None
    try:
        if hasattr(node.data, "with_row_index"):
            base_with_idx = node.data.with_row_index("document_idx")
    except Exception:  # pragma: no cover - docframe fallback
        base_with_idx = None

    if base_with_idx is not None and hasattr(base_with_idx, "text"):
        quote_raw = base_with_idx.text.quotation(
            column=column, explode=True, unnest=True
        )
    else:
        quote_raw = node.data.text.quotation(column=column, explode=True, unnest=True)

    return _ensure_quote_dataframe(_to_polars_dataframe(quote_raw))


async def _build_joined_quotation_frames(
    node: Any,
    column: str,
    engine: QuotationEngineConfig,
) -> Tuple[pl.DataFrame, pl.DataFrame]:
    base_df = _materialise_base_dataframe(node.data)
    if column not in base_df.columns:
        raise ValueError(
            f"Column '{column}' not found. Available columns: {list(base_df.columns)}"
        )

    quote_df = await _compute_quote_dataframe(node, base_df, column, engine)
    quote_df = _ensure_quote_dataframe(quote_df)

    if quote_df.height == 0:
        return _empty_quote_dataframe(), base_df

    original_with_idx = base_df.with_row_index("document_idx")
    joined = original_with_idx.join(quote_df, on="document_idx", how="left")

    if "quote" in joined.columns:
        joined = joined.filter(pl.col("quote").is_not_null())
    elif "quote_row_idx" in joined.columns:
        joined = joined.filter(pl.col("quote_row_idx").is_not_null())

    redundant = [col for col in joined.columns if col.endswith("_right")]
    if redundant:
        joined = joined.drop(redundant)

    base_columns = list(original_with_idx.columns)
    additional_columns = [col for col in joined.columns if col not in base_columns]
    if additional_columns:
        joined = joined.select(base_columns + additional_columns)

    return joined, base_df


router = APIRouter(prefix="/workspaces", tags=["quotation"])  # maintain path parity


@router.get("/{workspace_id}/quotation/current-request")
async def quotation_current_request(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:  # pragma: no cover - unlikely import error
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="quotation")
    if not rec:
        return None
    return {"state": "successful", "message": "ok", "data": rec.request}


@router.get("/{workspace_id}/quotation/current-result")
async def quotation_current_result(
    workspace_id: str,
    page: Optional[int] = None,
    page_size: Optional[int] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="quotation")
    if not rec:
        return None

    base_result = rec.result if isinstance(rec.result, dict) else {}
    stored_blob = base_result.get("_stored") if isinstance(base_result, dict) else None

    if isinstance(stored_blob, dict):
        default_page = stored_blob.get("default_page")
        default_page_size = stored_blob.get("default_page_size")
        normalized_page, normalized_size = _normalize_pagination(
            page if page is not None else default_page,
            page_size if page_size is not None else default_page_size,
        )
        page_payload = _paginate_from_storage(
            stored_blob,
            page=normalized_page,
            page_size=normalized_size,
            sort_by=sort_by,
            sort_order=sort_order,
        )

        prefs_source = base_result.get("preferences") or stored_blob.get("preferences")
        preferences = {"context_length": _extract_context_preference(base_result)}
        if isinstance(prefs_source, dict) and "context_length" in prefs_source:
            preferences["context_length"] = _normalize_context_length(
                prefs_source.get("context_length")
            )

        return {
            **page_payload,
            "preferences": preferences,
        }

    # Fallback for legacy records without stored blob
    return base_result


@router.post("/{workspace_id}/quotation/current-result")
async def update_quotation_current_result(
    workspace_id: str,
    query: QuotationResultQuery,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis, save_analysis
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {exc}")

    record = get_latest_analysis(user_id, workspace_id, task="quotation")
    if not record:
        raise HTTPException(status_code=404, detail="No quotation analysis found")

    base_request = {**record.request} if isinstance(record.request, dict) else {}
    base_result = {**record.result} if isinstance(record.result, dict) else {}
    stored_blob = base_result.get("_stored") if isinstance(base_result, dict) else None

    context_length_value = _extract_context_preference(base_result)
    if query.context_length is not None:
        context_length_value = _normalize_context_length(query.context_length)

    preferences = {
        **(base_result.get("preferences") if isinstance(base_result.get("preferences"), dict) else {}),
        "context_length": context_length_value,
    }

    needs_pagination = any(
        value is not None
        for value in (query.page, query.page_size, query.sort_by, query.sort_order)
    ) and not query.update_only

    if not needs_pagination:
        base_result["preferences"] = preferences
        try:
            save_analysis(
                user_id=user_id,
                workspace_id=workspace_id,
                task="quotation",
                request_dict=_sanitize_request_for_storage(base_request),
                result_dict=base_result,
            )
        except Exception as exc:  # pragma: no cover
            raise HTTPException(
                status_code=500,
                detail=f"Failed to persist quotation preferences: {exc}",
            )

        return {
            "state": "successful",
            "message": "saved",
            "data": {"context_length": context_length_value},
        }

    if not isinstance(stored_blob, dict):
        raise HTTPException(status_code=404, detail="No paginated quotation data available")

    default_page = stored_blob.get("default_page")
    default_page_size = stored_blob.get("default_page_size")
    normalized_page, normalized_size = _normalize_pagination(
        query.page if query.page is not None else default_page,
        query.page_size if query.page_size is not None else default_page_size,
    )

    page_payload = _paginate_from_storage(
        stored_blob,
        page=normalized_page,
        page_size=normalized_size,
        sort_by=query.sort_by,
        sort_order=query.sort_order,
    )

    stored_blob.update({
        "default_page": page_payload["pagination"]["page"],
        "default_page_size": page_payload["pagination"]["page_size"],
        "default_sort_by": page_payload["sorting"].get("sort_by"),
        "default_sort_order": page_payload["sorting"].get("sort_order"),
        "preferences": preferences,
    })

    updated_result = {
        **page_payload,
        "preferences": preferences,
        "_stored": stored_blob,
    }

    try:
        save_analysis(
            user_id=user_id,
            workspace_id=workspace_id,
            task="quotation",
            request_dict=_sanitize_request_for_storage(base_request),
            result_dict=updated_result,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist quotation pagination update: {exc}",
        )

    response_payload = {k: v for k, v in updated_result.items() if k != "_stored"}
    return response_payload


@router.post("/{workspace_id}/quotation/clear")
async def clear_quotation_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import clear_analyses
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")

    removed = clear_analyses(user_id, workspace_id, task="quotation")
    cache_removed = clear_quotation_cache_for(user_id, workspace_id)
    return {
        "state": "successful",
        "cleared": {
            "analyses_removed": removed,
            "quotation_cache_removed": cache_removed,
        },
    }


@router.post("/{workspace_id}/nodes/{node_id}/quotation")
async def get_quotation(
    workspace_id: str,
    node_id: str,
    request: QuotationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Compute quotation rows with optional metadata join, sorting, and pagination.

    Mirrors original logic from base.py; any changes must retain backward-compatible
    response shape consumed by frontend & tests.
    """
    user_id = current_user["id"]
    try:
        node, node_data = get_node_with_data_or_400(user_id, workspace_id, node_id)
        engine = request.engine or QuotationEngineConfig()

        if engine.type is QuotationEngineType.LOCAL and not hasattr(node_data, "text"):
            raise HTTPException(
                status_code=400,
                detail="This node does not support text analysis (DocFrame text namespace not available)",
            )

        joined_df, _ = await _build_joined_quotation_frames(
            node, request.column, engine
        )

        page, page_size = _normalize_pagination(request.page, request.page_size)
        sort_by = request.sort_by or None
        sort_order = _normalize_sort_order(request.sort_order)

        page_payload = _paginate_dataframe(
            joined_df,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
        )

        context_length_pref = DEFAULT_CONTEXT_LENGTH
        try:
            from ....core.analysis_store import get_latest_analysis

            previous = get_latest_analysis(user_id, workspace_id, task="quotation")
            if previous and isinstance(previous.result, dict):
                context_length_pref = _extract_context_preference(previous.result)
        except Exception:  # pragma: no cover - best effort reuse
            context_length_pref = DEFAULT_CONTEXT_LENGTH

        result_payload = {
            **page_payload,
            "preferences": {"context_length": context_length_pref},
        }

        request_dict = request.model_dump()
        request_dict.update({"node_id": node_id, "engine": engine.model_dump()})

        storage_blob = {
            "rows": joined_df.to_dicts(),
            "columns": list(joined_df.columns),
            "total_rows": joined_df.height,
            "default_page": result_payload["pagination"]["page"],
            "default_page_size": result_payload["pagination"]["page_size"],
            "default_sort_by": result_payload["sorting"].get("sort_by"),
            "default_sort_order": result_payload["sorting"].get("sort_order"),
            "column": request.column,
            "node_id": node_id,
            "engine": engine.model_dump(),
            "preferences": result_payload["preferences"],
        }

        try:  # best-effort persistence
            from ....core.analysis_store import save_analysis

            persist_payload = {**result_payload, "_stored": storage_blob}
            save_analysis(
                user_id=user_id,
                workspace_id=workspace_id,
                task="quotation",
                request_dict=_sanitize_request_for_storage(request_dict),
                result_dict=persist_payload,
            )
        except Exception:  # pragma: no cover - persistence failures ignored
            pass

        cache_key = _quotation_cache_key(
            user_id, workspace_id, node_id, request.column, engine
        )
        _store_cached_quotation_df(cache_key, joined_df)

        return result_payload
    except HTTPException:
        raise
    except QuotationServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:  # pragma: no cover - unexpected path
        logger.exception("Unexpected quotation error")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/{workspace_id}/nodes/{node_id}/quotation/detach")
async def detach_quotation(
    workspace_id: str,
    node_id: str,
    request: QuotationDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    """Detach quotation results (full-table) by joining exploded quotations with original table into a new node."""
    user_id = current_user["id"]
    try:
        node, node_data = get_node_with_data_or_400(user_id, workspace_id, node_id)
        engine = request.engine or QuotationEngineConfig()
        if engine.type is QuotationEngineType.LOCAL and not hasattr(node_data, "text"):
            raise HTTPException(
                status_code=400,
                detail="This node does not support text analysis (DocFrame text namespace not available)",
            )

        cache_key = _quotation_cache_key(
            user_id, workspace_id, node_id, request.column, engine
        )
        cached_df = _get_cached_quotation_df(cache_key)
        if cached_df is not None:
            joined_df = cached_df.clone()
        else:
            joined_df, _ = await _build_joined_quotation_frames(
                node, request.column, engine
            )
            _store_cached_quotation_df(cache_key, joined_df)

        if "document_idx" in joined_df.columns:
            final_data = joined_df.drop("document_idx")
        else:
            final_data = joined_df.clone()

        # New node name
        if request.new_node_name:
            new_node_name = request.new_node_name
        else:
            original_name = node.name if getattr(node, "name", None) else node_id
            new_node_name = f"{original_name}_quotation"

        data_for_node = final_data
        try:  # pragma: no cover - best effort docframe wrapping
            from docframe import DocDataFrame as _DDF  # type: ignore
            from docframe import DocLazyFrame as _DLF  # type: ignore

            if isinstance(node.data, (_DDF, _DLF)):
                doc_col = getattr(node.data, "document_column", None)
                if doc_col and doc_col in final_data.columns:
                    data_for_node = _DDF(final_data, document_column=doc_col)
        except Exception:
            pass

        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=data_for_node,
            node_name=new_node_name,
            operation="quotation_detach",
            parents=[node],
        )
        if not new_node:
            raise HTTPException(
                status_code=500, detail="Failed to create detached quotation node"
            )

        total_rows = final_data.height if hasattr(final_data, "height") else -1
        return {
            "state": "successful",
            "message": f"Successfully created detached quotation node '{new_node_name}' with {total_rows if total_rows >= 0 else 'unknown'} rows",
            "new_node_id": new_node.id,
            "new_node_name": new_node_name,
            "total_rows": total_rows,
        }
    except HTTPException:
        raise
    except QuotationServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:  # pragma: no cover
        logger.exception("Error detaching quotation results")
        raise HTTPException(
            status_code=500, detail=f"Error detaching quotation results: {str(e)}"
        )
