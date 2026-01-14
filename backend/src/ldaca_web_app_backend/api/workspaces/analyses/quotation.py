"""Quotation analysis endpoints with on-demand paginated result retrieval."""

import logging
import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.quotation import (
    QuotationRequest as AnalysisQuotationRequest,
)
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
DEFAULT_PAGE_SIZE = 100
DEFAULT_SORT_ORDER = "asc"


def _normalize_context_length(value: Any) -> int:
    """Clamp user-provided context length to the allowed range."""
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return DEFAULT_CONTEXT_LENGTH
    if numeric < 0:
        return 0
    if numeric > MAX_CONTEXT_LENGTH:
        return MAX_CONTEXT_LENGTH
    return numeric


def _normalize_sort_order(sort_order: Optional[str]) -> str:
    """Normalize sort order strings to either 'asc' or 'desc'."""
    if isinstance(sort_order, str) and sort_order.lower() == "desc":
        return "desc"
    return DEFAULT_SORT_ORDER


def _normalize_pagination(
    page: Optional[int], page_size: Optional[int]
) -> Tuple[int, int]:
    """Ensure pagination inputs are positive integers with sane defaults."""
    normalized_page = max(1, int(page)) if isinstance(page, int) else 1
    try:
        normalized_size = int(page_size) if page_size is not None else DEFAULT_PAGE_SIZE
    except (TypeError, ValueError):
        normalized_size = DEFAULT_PAGE_SIZE
    if normalized_size <= 0:
        normalized_size = DEFAULT_PAGE_SIZE
    return normalized_page, normalized_size


def _apply_sort(
    df: pl.DataFrame,
    *,
    sort_by: Optional[str],
    sort_order: str,
    allowed_columns: Optional[Iterable[str]] = None,
) -> Tuple[pl.DataFrame, Optional[str], str]:
    """Apply optional sorting constrained to allowed columns."""

    permitted = set(allowed_columns or df.columns)
    effective_sort_by = sort_by if sort_by and sort_by in permitted else None
    normalized_sort_order = _normalize_sort_order(sort_order)

    if effective_sort_by:
        df = df.sort(
            pl.col(effective_sort_by), descending=normalized_sort_order == "desc"
        )

    return df, effective_sort_by, normalized_sort_order


def _extract_context_preference(record_result: Optional[Dict[str, Any]]) -> int:
    """Pull the persisted context length preference from a stored result."""
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


def _empty_quote_dataframe(text_column: Optional[str] = None) -> pl.DataFrame:
    """Return a typed empty DataFrame shaped like a quotation result (no document_idx)."""

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


def _materialise_base_dataframe(node_data: Any) -> pl.DataFrame:
    """Coerce node data into an eager Polars DataFrame for quotation work."""
    base_df = _to_polars_dataframe(node_data)
    if not isinstance(base_df, pl.DataFrame):
        base_df = pl.DataFrame(base_df)
    return base_df


def _ensure_quote_dataframe(
    df: pl.DataFrame, *, text_column: Optional[str] = None
) -> pl.DataFrame:
    """Guarantee required quotation columns and dtypes exist (without document_idx)."""

    result = df
    if "quote_row_idx" not in result.columns:
        result = result.with_columns(
            pl.arange(0, result.height, eager=True)
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


def _prepare_documents_payload(
    base_df: pl.DataFrame, column: str
) -> Dict[str, Dict[str, Any]]:
    """Prepare remote-service payload mapping document ids to text strings."""
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
    """Convert remote quotation service payload into a normalized DataFrame."""
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


async def _compute_on_demand_page(
    node: Any,
    column: str,
    engine: QuotationEngineConfig,
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    sort_order: str,
) -> Dict[str, Any]:
    """Compute quotations only for the requested document page (explode & unnest).

    Pagination metadata counts documents; returned rows are exploded quotations for
    those documents. Sorting is applied to the base documents only, never on
    quotation metadata columns.
    """

    base_df = _materialise_base_dataframe(node.data)
    if column not in base_df.columns:
        raise ValueError(
            f"Column '{column}' not found. Available columns: {list(base_df.columns)}"
        )

    sortable_columns = set(base_df.columns)
    sorted_base, effective_sort_by, normalized_sort_order = _apply_sort(
        base_df,
        sort_by=sort_by,
        sort_order=sort_order,
        allowed_columns=sortable_columns,
    )

    total_docs = sorted_base.height
    total_pages = max(1, math.ceil(total_docs / page_size)) if total_docs else 1
    if page > total_pages:
        page = total_pages
    if page < 1:
        page = 1

    start_doc = (page - 1) * page_size
    slice_df = sorted_base.slice(start_doc, page_size)

    quote_df = await _compute_quote_dataframe(
        node, slice_df, column, engine, use_base_only=True
    )
    quote_df = _ensure_quote_dataframe(quote_df, text_column=column)

    if "quote" in quote_df.columns:
        quote_df = quote_df.filter(pl.col("quote").is_not_null())

    return {
        "data": quote_df.to_dicts(),
        "columns": list(quote_df.columns),
        "total_rows": total_docs,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "has_next": (start_doc + page_size) < total_docs,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "sort_order": normalized_sort_order,
        },
        "column": column,
    }


def _stable_document_items(
    documents: Dict[str, Dict[str, Any]],
) -> List[Tuple[str, Dict[str, Any]]]:
    """Sort document payloads deterministically to ensure stable batching."""
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
    """Yield deterministic chunks of documents honoring the configured batch size."""
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
    """Fetch remote quotation results in batches and merge payloads."""
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
    *,
    use_base_only: bool = False,
) -> pl.DataFrame:
    """
    Compute quotations for the provided DataFrame slice. When use_base_only=True, the
    provided base_df is used directly (avoiding full-node recomputation) and relies on
    the docframe text namespace being registered on the slice.
    """

    if engine.type is QuotationEngineType.REMOTE:
        documents = _prepare_documents_payload(base_df, column)
        if not documents:
            return _empty_quote_dataframe(text_column=column)
        payload = await _extract_remote_paginated(engine, documents)
        quote_df = _remote_payload_to_dataframe(payload)

        # Attach the source text column using the remote identifier, then drop it
        if "document_idx" in quote_df.columns:
            base_with_idx = base_df.with_row_index("__row__")
            quote_df = quote_df.join(
                base_with_idx.select(
                    pl.col("__row__"),
                    pl.col(column).alias(column),
                ),
                left_on="document_idx",
                right_on="__row__",
                how="left",
            ).drop([
                col for col in ("document_idx", "__row__") if col in quote_df.columns
            ])

        return _ensure_quote_dataframe(quote_df, text_column=column)

    # Local engine: rely on docframe's Polars text namespace.
    if not use_base_only:
        node_data = getattr(node, "data", None)
        if node_data is None:
            raise ValueError("Node has no data")

        if not hasattr(node_data, "text"):
            raise ValueError(
                "This node does not support quotation extraction (docframe text namespace not available)"
            )

        quote_raw = node_data.text.quotation(column, explode=True, unnest=True)
        return _ensure_quote_dataframe(
            _to_polars_dataframe(quote_raw), text_column=column
        )

    if not hasattr(base_df, "text"):
        raise ValueError(
            "This slice does not support quotation extraction (docframe text namespace not available)"
        )

    quote_raw = base_df.text.quotation(column, explode=True, unnest=True)
    return _ensure_quote_dataframe(_to_polars_dataframe(quote_raw), text_column=column)


router = APIRouter(prefix="/workspaces", tags=["quotation"])  # maintain path parity


@router.get("/{workspace_id}/quotation/current-request")
async def quotation_current_request(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        return None

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    task = analysis_manager.get_current_task("quotation")
    if not task:
        return None

    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    return {"state": "successful", "message": "ok", "data": req_dict}


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
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        return None

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    task = analysis_manager.get_current_task("quotation")
    if not task or not task.result:
        return None

    base_result = task.result.to_json()
    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )

    # If pagination params are provided, recompute on-demand using stored request metadata
    if any(v is not None for v in (page, page_size, sort_by, sort_order)):
        node_id = req_dict.get("node_id")
        column = req_dict.get("column")
        if not node_id or not column:
            return base_result

        engine_dict = req_dict.get("engine") or {}
        # Filter out internal fields that are not in public model
        engine_dict = {
            k: v for k, v in engine_dict.items() if k not in ("api_key", "model")
        }
        try:
            engine = QuotationEngineConfig.model_validate(engine_dict)
        except Exception:
            return base_result

        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            return base_result

        normalized_page, normalized_size = _normalize_pagination(
            page if page is not None else 1,
            page_size if page_size is not None else DEFAULT_PAGE_SIZE,
        )
        sort_by_effective = sort_by or None
        sort_order_effective = _normalize_sort_order(sort_order)

        return await _compute_on_demand_page(
            node,
            column,
            engine,
            page=normalized_page,
            page_size=normalized_size,
            sort_by=sort_by_effective,
            sort_order=sort_order_effective,
        )

    return base_result


@router.post("/{workspace_id}/quotation/current-result")
async def update_quotation_current_result(
    workspace_id: str,
    query: QuotationResultQuery,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    task = analysis_manager.get_current_task("quotation")
    if not task or not task.result:
        raise HTTPException(status_code=404, detail="No quotation analysis found")

    base_request = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    base_result = task.result.to_json()

    context_length_value = _extract_context_preference(base_result)
    if query.context_length is not None:
        context_length_value = _normalize_context_length(query.context_length)

    preferences = {
        **(
            base_result.get("preferences")
            if isinstance(base_result.get("preferences"), dict)
            else {}
        ),
        "context_length": context_length_value,
    }

    needs_pagination = (
        any(
            value is not None
            for value in (query.page, query.page_size, query.sort_by, query.sort_order)
        )
        and not query.update_only
    )

    if not needs_pagination:
        base_result["preferences"] = preferences
        try:
            # Update task request and result
            # We need to update the request object in the task
            # Assuming AnalysisQuotationRequest can be updated or replaced

            # Update request dict for storage (if we were using dicts)
            # But here we have a model.
            # Let's update the model instance if possible or create new one.
            # For now, let's just update the result.

            # Wait, the original code updated the request too?
            # "analysis_store.update_current_request"
            # Yes, to persist preferences maybe? No, preferences are in result.
            # Ah, maybe to update pagination params in request?
            # But here needs_pagination is False.

            # So just update result.
            from ....analysis.results import GenericAnalysisResult

            task.complete(GenericAnalysisResult(base_result))
            analysis_manager.update_task(task)
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

    # Recompute the requested page on demand using the stored request metadata
    node_id = base_request.get("node_id")
    column = base_request.get("column")
    if not node_id or not column:
        raise HTTPException(
            status_code=404, detail="No quotation analysis found for this workspace"
        )

    engine_dict = base_request.get("engine") or {}
    # Filter out internal fields that are not in public model
    engine_dict = {
        k: v for k, v in engine_dict.items() if k not in ("api_key", "model")
    }
    try:
        engine = QuotationEngineConfig.model_validate(engine_dict)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=f"Invalid engine config: {exc}")

    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    normalized_page, normalized_size = _normalize_pagination(
        query.page if query.page is not None else 1,
        query.page_size if query.page_size is not None else DEFAULT_PAGE_SIZE,
    )
    sort_by = query.sort_by or None
    sort_order = _normalize_sort_order(query.sort_order)

    page_payload = await _compute_on_demand_page(
        node,
        column,
        engine,
        page=normalized_page,
        page_size=normalized_size,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    updated_result = {**page_payload, "preferences": preferences}

    try:
        from ....analysis.results import GenericAnalysisResult

        task.complete(GenericAnalysisResult(updated_result))

        # Also update request params in task?
        # The original code did: analysis_store.update_current_request
        # This implies the "current request" should reflect the latest pagination.
        # Let's update the task request.
        # We need to create a new request object or modify existing.
        # Since Pydantic models are mutable by default (unless frozen), we can modify.
        if hasattr(task.request, "page"):
            task.request.page = normalized_page
            task.request.page_size = normalized_size
            task.request.sort_by = sort_by
            task.request.sort_order = sort_order

        analysis_manager.update_task(task)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist quotation pagination update: {exc}",
        )

    return updated_result


@router.post("/{workspace_id}/quotation/clear")
async def clear_quotation_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if ws:
        analysis_manager = getattr(ws, "analysis", None)
        if not analysis_manager:
            from ....analysis.manager import get_analysis_manager

            analysis_manager = get_analysis_manager(user_id, workspace_id)

        analysis_manager.clear_current_result("quotation")

    return {"state": "successful", "cleared": ["quotation"]}


@router.post("/{workspace_id}/nodes/{node_id}/quotation")
async def get_quotation(
    workspace_id: str,
    node_id: str,
    request: QuotationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Compute quotation rows with optional metadata join, sorting, and pagination."""
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    try:
        node, node_data = get_node_with_data_or_400(user_id, workspace_id, node_id)
        engine = request.engine or QuotationEngineConfig()

        if engine.type is QuotationEngineType.LOCAL and not hasattr(node_data, "text"):
            raise HTTPException(
                status_code=400,
                detail="This node does not support text analysis (DocFrame text namespace not available)",
            )

        page, page_size = _normalize_pagination(request.page, request.page_size)
        sort_by = request.sort_by or None
        sort_order = _normalize_sort_order(request.sort_order)

        # On-demand extraction for the requested page only
        page_payload = await _compute_on_demand_page(
            node,
            request.column,
            engine,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
        )

        context_length_pref = DEFAULT_CONTEXT_LENGTH
        try:
            prev_task = analysis_manager.get_current_task("quotation")
            if prev_task and prev_task.result:
                prev_result = prev_task.result.to_json()
                context_length_pref = _extract_context_preference(prev_result)
        except Exception:  # pragma: no cover - best effort reuse
            context_length_pref = DEFAULT_CONTEXT_LENGTH

        result_payload = {
            **page_payload,
            "preferences": {"context_length": context_length_pref},
        }

        # Create new task
        # We need to convert the API request model to our internal AnalysisRequest model
        # They are slightly different (API request vs AnalysisRequest)
        # But I defined AnalysisQuotationRequest to match API request mostly.

        # The API request is `QuotationRequest` from `....models`.
        # My new model is `AnalysisQuotationRequest` from `....analysis.implementations.quotation`.
        # I should map them.

        analysis_request = AnalysisQuotationRequest(
            node_id=node_id,
            column=request.column,
            engine=request.engine.model_dump(mode="json") if request.engine else None,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
            context_length=context_length_pref,
        )

        existing_task = analysis_manager.get_current_task("quotation")

        if existing_task:
            # Disallow changing the base request without an explicit clear.
            # Compare core params
            existing_req = existing_task.request
            # We need to compare relevant fields.
            # If node_id or column changed, it's a conflict.
            if existing_req.node_id != node_id or existing_req.column != request.column:
                raise HTTPException(
                    status_code=409,
                    detail="Clear current quotation results before starting a new quotation analysis",
                )

            # Update existing task
            existing_task.request = analysis_request
            from ....analysis.results import GenericAnalysisResult

            existing_task.complete(GenericAnalysisResult(result_payload))
            analysis_manager.update_task(existing_task)

        else:
            # Create new task
            from uuid import uuid4

            task_id = str(uuid4())
            analysis_request.task_id = task_id

            task = analysis_manager.create_task("quotation", analysis_request)

            from ....analysis.results import GenericAnalysisResult

            task.complete(GenericAnalysisResult(result_payload))
            analysis_manager.update_task(task)

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
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        task_info = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="quotation_detach",
            task_args={
                "node_id": node_id,
                "column": request.column,
                "engine_config": request.engine.model_dump() if request.engine else {},
                "new_node_name": request.new_node_name,
            },
            task_name="Detach Quotation",
        )

        return {
            "state": "running",
            "message": "Quotation detach started",
            "data": None,
            "metadata": {"task_id": task_info.id},
        }

    except Exception as e:
        logger.exception("Error submitting detach quotation task")
        raise HTTPException(
            status_code=500, detail=f"Error submitting detach task: {str(e)}"
        )
