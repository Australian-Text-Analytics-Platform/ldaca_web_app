import asyncio
import logging
import time
from copy import deepcopy
from typing import Any, Dict, List, Optional, Tuple

import polars as pl
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from docframe import DocDataFrame, DocLazyFrame

from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import (
    ConcordanceAnalysisRequest,
    ConcordanceDetachRequest,
    ConcordanceMetadata,
)
from ..utils import stage_dataframe_as_lazy


def _prepare_doclazy_frame(node, column_name: str, user_id: str, workspace_id: str):
    """Convert node data to a DocLazyFrame with the provided document column."""

    data = getattr(node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")

    if isinstance(data, DocLazyFrame):
        processed = (
            data
            if data.document_column == column_name
            else data.with_document_column(column_name)
        )
    elif isinstance(data, DocDataFrame):
        processed = DocLazyFrame(data.dataframe.lazy(), document_column=column_name)  # type: ignore[misc]
    elif isinstance(data, pl.LazyFrame):
        processed = DocLazyFrame(data, document_column=column_name)  # type: ignore[misc]
    elif isinstance(data, pl.DataFrame):
        processed = DocLazyFrame(data.lazy(), document_column=column_name)  # type: ignore[misc]
    else:  # pragma: no cover
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported node data type for text analysis: {type(data).__name__}",
        )

    try:
        node.document = column_name
        node.data = processed
        workspace_manager.persist(user_id, workspace_id)
    except Exception:
        pass

    return processed


"""Concordance analysis endpoints extracted from legacy monolithic base.py.

Includes:
    - POST /workspaces/{workspace_id}/concordance
    - GET  /workspaces/{workspace_id}/concordance/current-request
    - GET  /workspaces/{workspace_id}/concordance/current-result
    - POST /workspaces/{workspace_id}/concordance/current-result
        - POST /workspaces/{workspace_id}/concordance/clear
  - POST /workspaces/{workspace_id}/concordance/cache/clear
  - POST /workspaces/{workspace_id}/concordance/multi-node/clear
  - GET  /workspaces/{workspace_id}/nodes/{node_id}/concordance/{document_idx}
  - POST /workspaces/{workspace_id}/nodes/{node_id}/concordance/detach

Behavior preserved exactly: caching logic, metadata detection, pagination, sorting,
multi-node combined view, persistence via analysis_store, detach semantics, and
detail retrieval endpoint. Route shapes & response payloads unchanged to avoid
frontend/test regressions.
"""

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["concordance"])


# ---------------------------------------------------------------------------
# In-memory concordance cache (moved from base.py lines ~125-158, 549-558)
# ---------------------------------------------------------------------------
CONCORDANCE_CACHE: Dict[Tuple[str, str, str, str, str, int, int, bool, bool], dict] = {}


def _concordance_cache_key(
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    case_sensitive: bool,
):
    return (
        user_id,
        workspace_id,
        node_id,
        column,
        search_word,
        num_left_tokens,
        num_right_tokens,
        regex,
        case_sensitive,
    )


def _get_cached_concordance_df(key):  # pragma: no cover - simple accessor
    entry = CONCORDANCE_CACHE.get(key)
    if not entry:
        return None
    return entry.get("df")


def _store_concordance_df(key, df):  # pragma: no cover
    CONCORDANCE_CACHE[key] = {"df": df, "created": time.time()}


## Cache clearing now handled by analysis_admin.clear_concordance_cache_for


# ---------------------------------------------------------------------------
# Unified concordance helpers and endpoints
# ---------------------------------------------------------------------------
CORE_CONCORDANCE_COLUMNS = {
    "document_idx",
    "left_context",
    "matched_text",
    "right_context",
    "start_idx",
    "end_idx",
    "l1",
    "r1",
    "l1_freq",
    "r1_freq",
}


DEFAULT_CONCORDANCE_PAGE = 1
DEFAULT_CONCORDANCE_PAGE_SIZE = 20
DEFAULT_CONCORDANCE_SORT_ORDER = "asc"


_REQUEST_STORAGE_EXCLUDE_KEYS = {
    "page",
    "page_size",
    "sort_by",
    "sort_order",
    "pagination",
}


def _sanitize_request_for_storage(request_dict: Dict[str, Any]) -> Dict[str, Any]:
    sanitized: Dict[str, Any] = {}
    for key, value in request_dict.items():
        if key in _REQUEST_STORAGE_EXCLUDE_KEYS:
            continue
        if key == "combined" and not value:
            continue
        if value is None:
            continue
        sanitized[key] = value
    return sanitized


def _normalize_sort_order(sort_order: Optional[str]) -> str:
    if isinstance(sort_order, str) and sort_order.lower() == "desc":
        return "desc"
    return "asc"


def _materialize_base_dataframe(node_data) -> pl.DataFrame:
    if hasattr(node_data, "to_lazyframe"):
        base_df = node_data.to_lazyframe().collect()
    elif hasattr(node_data, "_df") and not isinstance(node_data, pl.DataFrame):
        base_df = node_data._df  # type: ignore[attr-defined]
    elif hasattr(node_data, "collect"):
        base_df = node_data.collect()
    else:
        base_df = node_data
    if isinstance(base_df, pl.LazyFrame):
        base_df = base_df.collect()
    if not isinstance(base_df, pl.DataFrame):
        try:
            base_df = pl.DataFrame(base_df)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Unable to materialize node data into DataFrame: {exc}",
            )
    return base_df


def _process_node_concordance(
    user_id: str,
    workspace_id: str,
    node,
    node_id: str,
    column: str,
    request: ConcordanceAnalysisRequest,
    page: int,
    page_size: int,
    sort_order: str,
):
    node_name = node.name if getattr(node, "name", None) else node_id
    result: Dict[str, Any]
    if hasattr(node.data, "text"):
        cache_key = _concordance_cache_key(
            user_id,
            workspace_id,
            node_id,
            column,
            request.search_word,
            request.num_left_tokens,
            request.num_right_tokens,
            request.regex,
            request.case_sensitive,
        )
        concordance_result = _get_cached_concordance_df(cache_key)
        if concordance_result is None:
            concordance_result = node.data.text.concordance(
                column=column,
                search_word=request.search_word,
                num_left_tokens=request.num_left_tokens,
                num_right_tokens=request.num_right_tokens,
                regex=request.regex,
                case_sensitive=request.case_sensitive,
                explode=True,
                unnest=True,
            )
            _store_concordance_df(cache_key, concordance_result)

        working_df = concordance_result
        core_columns = [c for c in working_df.columns if c in CORE_CONCORDANCE_COLUMNS]
        try:
            cdf = working_df
            if "document_idx" not in cdf.columns:
                cdf = cdf.with_row_index("document_idx")
            has_metadata = any(
                (col not in core_columns) and (col != "document_idx")
                for col in cdf.columns
            )
            if not has_metadata:
                base_df = _materialize_base_dataframe(node.data)
                orig = base_df.with_row_index("document_idx")
                try:
                    idx_dtype = cdf.schema.get("document_idx")
                    if idx_dtype is not None:
                        orig = orig.with_columns(pl.col("document_idx").cast(idx_dtype))
                except Exception:
                    pass
                cdf = cdf.join(orig, on="document_idx", how="left")
            working_df = cdf
        except Exception as je:
            logger.warning(
                "Failed to finalize concordance frame for node %s: %s", node_id, je
            )

        raw_working_df = working_df
        working_df = _filter_concordance_rows(working_df)
        if request.sort_by and request.sort_by in working_df.columns:
            working_df = working_df.sort(
                pl.col(request.sort_by),
                descending=sort_order == "desc",
            )
        total_matches = len(working_df)
        start_idx = (page - 1) * page_size
        paginated = working_df.slice(start_idx, page_size)
        all_columns = list(working_df.columns)
        metadata_columns = [col for col in all_columns if col not in core_columns]
        node_metadata = ConcordanceMetadata(
            concordance_columns=core_columns,
            metadata_columns=metadata_columns,
            all_columns=all_columns,
        )
        metadata_dict = node_metadata.model_dump()
        payload = {
            "data": paginated.to_dicts(),
            "columns": all_columns,
            "metadata": metadata_dict,
            "total_matches": total_matches,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_pages": (total_matches + page_size - 1) // page_size,
                "has_next": (start_idx + page_size) < total_matches,
                "has_prev": page > 1,
            },
            "sorting": {
                "sort_by": request.sort_by,
                "sort_order": sort_order,
            },
        }
        combined_frame = None
        try:
            combined_frame = working_df.with_columns(
                pl.lit(node_name).alias("__source_node")
            )
        except Exception:
            combined_frame = None
        result = {
            "label": node_name,
            "page_payload": payload,
            "combined_frame": combined_frame,
            "columns": all_columns,
            "full_frame": working_df,
            "raw_frame": raw_working_df,
            "metadata": metadata_dict,
            "total_matches": total_matches,
        }
        return result

    base_df = _materialize_base_dataframe(node.data)
    filtered = base_df
    if request.search_word:
        search_value = (
            request.search_word
            if request.case_sensitive
            else request.search_word.lower()
        )
        expr_column = pl.col(column)
        helper_added = False
        if not request.case_sensitive:
            helper_name = "__match_column"
            filtered = filtered.with_columns(
                pl.col(column).cast(pl.Utf8).str.to_lowercase().alias(helper_name)
            )
            expr_column = pl.col(helper_name)
            helper_added = True
        try:
            filtered = filtered.filter(
                expr_column.str.contains(search_value, literal=not request.regex)
            )
        except Exception as fe:
            logger.warning(
                "Fallback concordance filtering failed for node %s: %s", node_id, fe
            )
        if helper_added and helper_name in filtered.columns:
            filtered = filtered.drop(helper_name)
    if request.sort_by and request.sort_by in filtered.columns:
        filtered = filtered.sort(
            pl.col(request.sort_by), descending=sort_order == "desc"
        )
    filtered_df = (
        filtered if isinstance(filtered, pl.DataFrame) else pl.DataFrame(filtered)
    )
    raw_filtered_df = filtered_df
    filtered_df = _filter_concordance_rows(filtered_df)
    total_matches = filtered_df.height
    start_idx = (page - 1) * page_size
    paginated = filtered_df.slice(start_idx, page_size)
    all_columns = list(filtered_df.columns)
    fallback_metadata = ConcordanceMetadata(
        concordance_columns=[],
        metadata_columns=all_columns,
        all_columns=all_columns,
    )
    metadata_dict = fallback_metadata.model_dump()
    payload = {
        "data": paginated.to_dicts() if hasattr(paginated, "to_dicts") else [],
        "columns": all_columns,
        "metadata": metadata_dict,
        "total_matches": total_matches,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_pages": (total_matches + page_size - 1) // page_size,
            "has_next": (start_idx + page_size) < total_matches,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": request.sort_by,
            "sort_order": sort_order,
        },
    }
    combined_frame = None
    try:
        combined_frame = filtered_df.with_columns(
            pl.lit(node_name).alias("__source_node")
        )
    except Exception:
        combined_frame = None

    result = {
        "label": node_name,
        "page_payload": payload,
        "combined_frame": combined_frame,
        "columns": all_columns,
        "full_frame": filtered_df,
        "raw_frame": raw_filtered_df,
        "metadata": metadata_dict,
        "total_matches": total_matches,
    }
    return result


class ConcordanceResultQuery(BaseModel):
    node_id: Optional[str] = None
    combined: Optional[bool] = None
    page: Optional[int] = None
    page_number: Optional[int] = None
    page_size: Optional[int] = None
    sort_by: Optional[str] = None
    sort_order: Optional[str] = None
    show_metadata: Optional[bool] = None
    update_only: bool = False


def _apply_result_query_overrides(
    normalized_request: Dict[str, Any],
    query: "ConcordanceResultQuery",
) -> Dict[str, Any]:
    """Apply pagination/sorting overrides from ConcordanceResultQuery.

    Keep this narrowly scoped and behavior-preserving: only write keys when
    the query explicitly provides them.
    """

    page = query.page_number if query.page_number is not None else query.page
    if page is not None:
        normalized_request["page"] = page
    if query.page_size is not None:
        normalized_request["page_size"] = query.page_size
    if query.sort_by is not None:
        normalized_request["sort_by"] = query.sort_by
    if query.sort_order is not None:
        normalized_request["sort_order"] = query.sort_order
    return normalized_request


def _normalize_saved_request(
    raw_request: Optional[dict], raw_result: Optional[dict]
) -> Optional[dict]:
    if not raw_request:
        return None
    if "node_ids" in raw_request and "node_columns" in raw_request:
        normalized_request = dict(raw_request)
    else:
        analysis_params = (raw_result or {}).get("analysis_params") or {}
        node_id = analysis_params.get("node_id") or raw_request.get("node_id")
        column = analysis_params.get("column") or raw_request.get("column")
        if not node_id or not column:
            return None
        normalized_request = {
            "node_ids": [node_id],
            "node_columns": {node_id: column},
            "search_word": raw_request.get("search_word", ""),
            "num_left_tokens": raw_request.get("num_left_tokens", 10),
            "num_right_tokens": raw_request.get("num_right_tokens", 10),
            "regex": bool(raw_request.get("regex", False)),
            "case_sensitive": bool(raw_request.get("case_sensitive", False)),
        }
        if raw_request.get("combined"):
            normalized_request["combined"] = True
    if not normalized_request.get("combined"):
        normalized_request.pop("combined", None)
    for field in ("page", "page_size", "sort_by", "sort_order", "pagination"):
        normalized_request.pop(field, None)
    return normalized_request


def _normalize_saved_result(
    raw_result: Optional[dict], normalized_request: dict
) -> Optional[dict]:
    if not raw_result:
        return None
    if "_stored" in raw_result:
        sanitized = {k: v for k, v in raw_result.items() if k != "_stored"}
        if isinstance(sanitized.get("data"), dict) and sanitized.get("state"):
            return sanitized
        raw_result = sanitized
    if isinstance(raw_result.get("data"), dict) and raw_result.get("state"):
        return raw_result
    node_ids = normalized_request.get("node_ids") or []
    node_id = node_ids[0] if node_ids else "node"
    analysis_params = (
        raw_result.get("analysis_params") if isinstance(raw_result, dict) else {}
    ) or {}
    node_label = (
        analysis_params.get("node_name") or analysis_params.get("node_id") or node_id
    )
    columns = raw_result.get("columns") or []
    metadata = (
        raw_result.get("metadata")
        or ConcordanceMetadata(
            concordance_columns=[],
            metadata_columns=columns,
            all_columns=columns,
        ).model_dump()
    )
    page = normalized_request.get("page", DEFAULT_CONCORDANCE_PAGE)
    page_size = normalized_request.get("page_size", DEFAULT_CONCORDANCE_PAGE_SIZE)
    total_matches = raw_result.get("total_matches", 0)
    pagination = raw_result.get("pagination") or {
        "page": page,
        "page_size": page_size,
        "total_pages": (total_matches + page_size - 1) // page_size,
        "has_next": (page - 1) * page_size + page_size < total_matches,
        "has_prev": page > 1,
    }
    sorting = raw_result.get("sorting") or {
        "sort_by": normalized_request.get("sort_by"),
        "sort_order": normalized_request.get("sort_order", "asc"),
    }
    pagination_summary = {
        "page": pagination.get("page"),
        "page_size": pagination.get("page_size"),
        "sort_by": sorting.get("sort_by"),
        "sort_order": sorting.get("sort_order"),
    }
    if isinstance(analysis_params, dict):
        combined_params = dict(analysis_params)
    else:
        combined_params = dict(normalized_request)
    combined_params.update({
        "page": pagination_summary["page"],
        "page_size": pagination_summary["page_size"],
        "sort_by": pagination_summary["sort_by"],
        "sort_order": pagination_summary["sort_order"],
        "pagination": pagination_summary,
    })

    return {
        "state": raw_result.get("state", "successful"),
        "message": raw_result.get("message", "ok"),
        "data": {
            node_label: {
                "data": raw_result.get("data", []),
                "columns": columns,
                "metadata": metadata,
                "total_matches": total_matches,
                "pagination": pagination,
                "sorting": sorting,
            }
        },
        "analysis_params": combined_params,
        "combinable": raw_result.get("combinable", False),
    }


def _paginate_stored_entry(
    entry: Dict[str, Any],
    page: int,
    page_size: int,
    sort_by: Optional[str],
    sort_order: Optional[str],
) -> Dict[str, Any]:
    if not entry:
        raise HTTPException(
            status_code=404, detail="Stored concordance data unavailable"
        )

    normalized_page = max(1, page)
    normalized_page_size = max(1, page_size)

    columns = entry.get("columns") or []
    metadata = entry.get("metadata")
    if not metadata:
        metadata = {
            "concordance_columns": [
                col for col in columns if col in CORE_CONCORDANCE_COLUMNS
            ],
            "metadata_columns": [
                col for col in columns if col not in CORE_CONCORDANCE_COLUMNS
            ],
            "all_columns": columns,
        }

    data_rows = entry.get("data") or []
    if data_rows:
        df = pl.DataFrame(data_rows)
    else:
        df = pl.DataFrame({col: [] for col in columns}) if columns else pl.DataFrame([])

    df = _filter_concordance_rows(df)

    effective_sort_by = sort_by or entry.get("default_sort_by")
    effective_sort_order = _normalize_sort_order(
        sort_order or entry.get("default_sort_order")
    )

    if effective_sort_by and effective_sort_by in df.columns:
        df = df.sort(
            pl.col(effective_sort_by), descending=effective_sort_order == "desc"
        )
    else:
        effective_sort_by = None

    total_matches = df.height

    start_idx = (normalized_page - 1) * normalized_page_size
    if start_idx >= total_matches and total_matches > 0:
        normalized_page = max(1, (total_matches - 1) // normalized_page_size + 1)
        start_idx = (normalized_page - 1) * normalized_page_size

    paginated_df = df.slice(start_idx, normalized_page_size)
    paginated_rows = paginated_df.to_dicts()

    total_pages = (
        (total_matches + normalized_page_size - 1) // normalized_page_size
        if total_matches
        else 1
    )

    return {
        "data": paginated_rows,
        "columns": columns,
        "metadata": metadata,
        "total_matches": total_matches,
        "pagination": {
            "page": normalized_page,
            "page_size": normalized_page_size,
            "total_pages": total_pages,
            "has_next": (start_idx + normalized_page_size) < total_matches,
            "has_prev": normalized_page > 1,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "sort_order": effective_sort_order,
        },
    }


async def _execute_concordance(
    workspace_id: str,
    request: ConcordanceAnalysisRequest,
    current_user: dict,
    *,
    page_override: Optional[int] = None,
    page_size_override: Optional[int] = None,
    sort_by_override: Optional[str] = None,
    sort_order_override: Optional[str] = None,
    show_metadata_override: Optional[bool] = None,
):
    user_id = current_user["id"]
    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )
    if len(request.node_ids) > 2:
        raise HTTPException(
            status_code=400, detail="Maximum 2 nodes supported for comparison"
        )

    page = max(
        1, page_override if page_override is not None else DEFAULT_CONCORDANCE_PAGE
    )
    page_size = max(
        1,
        page_size_override
        if page_size_override is not None
        else DEFAULT_CONCORDANCE_PAGE_SIZE,
    )
    requested_sort_by = (
        sort_by_override
        if sort_by_override is not None
        else getattr(request, "sort_by", None)
    )
    sort_order = _normalize_sort_order(
        sort_order_override or DEFAULT_CONCORDANCE_SORT_ORDER
    )
    show_metadata = (
        bool(show_metadata_override)
        if show_metadata_override is not None
        else bool(getattr(request, "show_metadata", False))
    )

    results: Dict[str, Dict[str, Any]] = {}
    combined_frames: List[pl.DataFrame] = []
    per_node_columns: Dict[str, List[str]] = {}
    stored_nodes: Dict[str, Dict[str, Any]] = {}
    node_label_map: Dict[str, str] = {}

    for node_id in request.node_ids:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        column = request.node_columns.get(node_id)
        if not column:
            raise HTTPException(
                status_code=400, detail=f"No column specified for node {node_id}"
            )
        if hasattr(node.data, "columns"):
            available_columns = node.data.columns
        elif hasattr(node.data, "schema"):
            available_columns = list(node.data.schema.keys())
        else:
            available_columns = []
        if available_columns and column not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column}' not found in node {node_id}. Available columns: {available_columns}",
            )

        node_result = _process_node_concordance(
            user_id,
            workspace_id,
            node,
            node_id,
            column,
            request,
            page,
            page_size,
            sort_order,
        )
        node_label = node_result["label"]
        results[node_label] = node_result["page_payload"]
        per_node_columns[node_label] = node_result["columns"]
        if node_result["combined_frame"] is not None:
            combined_frames.append(node_result["combined_frame"])
        stored_nodes[node_id] = {
            "label": node_label,
            "columns": node_result["columns"],
            "metadata": node_result["metadata"],
            "total_matches": node_result["total_matches"],
            "data": node_result["full_frame"].to_dicts()
            if hasattr(node_result["full_frame"], "to_dicts")
            else [],
            "raw_data": node_result.get("raw_frame").to_dicts()
            if hasattr(node_result.get("raw_frame"), "to_dicts")
            else None,
            "default_sort_by": requested_sort_by,
            "default_sort_order": sort_order,
            "default_page_size": page_size,
            "default_page": page,
        }
        node_label_map[node_id] = node_label

    column_sets = list(per_node_columns.values())
    combinable = False
    if len(column_sets) >= 2:
        first_columns = column_sets[0]
        combinable = all(cols == first_columns for cols in column_sets[1:])

    should_build_combined = combinable and len(combined_frames) >= 2
    if should_build_combined:
        ordered_columns: List[str] = []
        column_dtypes: Dict[str, pl.datatypes.DataType] = {}
        aligned_frames: List[pl.DataFrame] = []
        for frame in combined_frames:
            for col, dtype in frame.schema.items():
                if col not in ordered_columns:
                    ordered_columns.append(col)
                if col not in column_dtypes:
                    column_dtypes[col] = dtype
        for frame in combined_frames:
            mutations = []
            missing_literals = []
            for col in ordered_columns:
                target_dtype = column_dtypes.get(col)
                if col not in frame.columns:
                    lit_expr = pl.lit(None)
                    if target_dtype is not None:
                        lit_expr = lit_expr.cast(target_dtype)
                    missing_literals.append(lit_expr.alias(col))
                else:
                    current_dtype = frame.schema.get(col)
                    if target_dtype is not None and current_dtype != target_dtype:
                        mutations.append(pl.col(col).cast(target_dtype))
            if missing_literals:
                frame = frame.with_columns(missing_literals)
            if mutations:
                frame = frame.with_columns(mutations)
            aligned_frames.append(frame.select(ordered_columns))
        combined_df = pl.concat(aligned_frames, how="vertical")
        effective_sort_by = None
        if requested_sort_by and requested_sort_by in combined_df.columns:
            effective_sort_by = requested_sort_by
            combined_df = combined_df.sort(
                pl.col(requested_sort_by),
                descending=sort_order == "desc",
            )
        elif "document_idx" in combined_df.columns:
            effective_sort_by = "document_idx"
            combined_df = combined_df.sort(pl.col("document_idx"))
        total_combined = len(combined_df)
        start_idx = (page - 1) * page_size
        paginated = combined_df.slice(start_idx, page_size)
        combined_columns = list(combined_df.columns)
        combined_metadata = {
            "concordance_columns": [
                col for col in combined_columns if col in CORE_CONCORDANCE_COLUMNS
            ],
            "metadata_columns": [
                col for col in combined_columns if col not in CORE_CONCORDANCE_COLUMNS
            ],
            "all_columns": combined_columns,
        }
        combined_page_payload = {
            "data": paginated.to_dicts(),
            "columns": combined_columns,
            "metadata": combined_metadata,
            "total_matches": total_combined,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_pages": (total_combined + page_size - 1) // page_size,
                "has_next": (start_idx + page_size) < total_combined,
                "has_prev": page > 1,
            },
            "sorting": {
                "sort_by": effective_sort_by,
                "sort_order": sort_order,
            },
        }
        if request.combined:
            results["__COMBINED__"] = combined_page_payload
        stored_nodes["__COMBINED__"] = {
            "label": "__COMBINED__",
            "columns": combined_columns,
            "metadata": combined_metadata,
            "total_matches": total_combined,
            "data": combined_df.to_dicts(),
            "default_sort_by": effective_sort_by,
            "default_sort_order": sort_order,
            "default_page_size": page_size,
            "default_page": page,
        }

    has_combined_result = "__COMBINED__" in results
    effective_combined = request.combined and combinable and has_combined_result

    message = (
        f"Found concordance results for search term '{request.search_word}'"
        if request.search_word
        else "Concordance results ready"
    )
    if request.combined and not effective_combined:
        message = (
            "Combined concordance view unavailable because node schemas differ; "
            "showing separated results instead."
            if request.search_word
            else "Combined concordance view unavailable due to schema mismatch."
        )

    raw_request_dict = request.model_dump()
    pagination_info = {
        "page": page,
        "page_size": page_size,
        "sort_by": requested_sort_by,
        "sort_order": sort_order,
    }
    label_to_node_map = {label: node_id for node_id, label in node_label_map.items()}

    analysis_params_dict = {
        **raw_request_dict,
        "combined": effective_combined,
        "combinable": combinable,
        "page": page,
        "page_size": page_size,
        "sort_by": requested_sort_by,
        "sort_order": sort_order,
        "pagination": pagination_info,
        "show_metadata": show_metadata,
        "preferences": {
            "page_size": page_size,
            "show_metadata": show_metadata,
        },
        "node_label_map": node_label_map,
        "label_to_node_map": label_to_node_map,
    }

    result_payload = {
        "state": "successful",
        "message": message,
        "data": results,
        "analysis_params": analysis_params_dict,
        "combinable": combinable,
        "preferences": analysis_params_dict["preferences"],
    }

    storage_blob = {
        "nodes": stored_nodes,
        "node_label_map": node_label_map,
        "label_to_node_map": label_to_node_map,
        "default_page": {
            "page": page,
            "page_size": page_size,
            "sort_by": requested_sort_by,
            "sort_order": sort_order,
        },
        "combinable": combinable,
        "preferences": analysis_params_dict["preferences"],
    }

    storage_blob["combined_available"] = should_build_combined

    try:  # pragma: no cover
        from ....core.analysis_store import save_analysis

        request_for_storage = _sanitize_request_for_storage(raw_request_dict)
        if effective_combined:
            request_for_storage["combined"] = True
        else:
            request_for_storage.pop("combined", None)

        persist_payload = {
            "state": result_payload["state"],
            "message": result_payload["message"],
            "data": result_payload["data"],
            "analysis_params": result_payload["analysis_params"],
            "preferences": result_payload.get("preferences"),
            "combinable": combinable,
            "_stored": storage_blob,
        }

        save_analysis(
            user_id=user_id,
            workspace_id=workspace_id,
            task="concordance",
            request_dict=request_for_storage,
            result_dict=persist_payload,
        )
    except Exception as _e:  # pragma: no cover
        print(f"[analysis_persist] concordance save failed: {_e}")

    return result_payload


@router.post("/{workspace_id}/concordance")
async def run_concordance(
    workspace_id: str,
    request: ConcordanceAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    # Check if already running
    if await tm.any_running(
        task_type="concordance", user_id=user_id, workspace_id=workspace_id
    ):
        latest = await tm.latest_by_type(
            "concordance", user_id=user_id, workspace_id=workspace_id
        )
        return {
            "state": "running",
            "message": "Concordance analysis already running",
            "data": None,
            "metadata": {"task_id": latest.id if latest else None},
        }

    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )

    # Validate columns
    validated_columns = {}
    node_columns = request.node_columns or {}

    for node_id in request.node_ids:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

        node_data = getattr(node, "data", node)
        if hasattr(node_data, "columns"):
            available_columns = node_data.columns
        elif hasattr(node_data, "collect_schema"):
            available_columns = list(node_data.collect_schema().keys())
        elif hasattr(node_data, "schema"):
            available_columns = list(node_data.schema.keys())
        else:
            available_columns = []

        column_name = node_columns.get(node_id)
        if not column_name:
            # Try to auto-detect
            common = [
                c
                for c in ["document", "text", "content", "body", "message"]
                if c in available_columns
            ]
            if common:
                column_name = common[0]

        if not column_name:
            raise HTTPException(
                status_code=400,
                detail=f"Could not determine text column for node {node_id}",
            )

        if column_name not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column_name}' not found in node {node_id}",
            )

        validated_columns[node_id] = column_name

    try:
        task_info = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="concordance",
            task_args={
                "node_ids": request.node_ids,
                "node_columns": validated_columns,
                "search_word": request.search_word,
                "num_left_tokens": request.num_left_tokens,
                "num_right_tokens": request.num_right_tokens,
                "regex": request.regex,
                "case_sensitive": request.case_sensitive,
            },
        )

        # Persist request
        from ....core.analysis_store import save_analysis

        req_dict = (
            request.model_dump() if hasattr(request, "model_dump") else request.dict()
        )
        await asyncio.to_thread(
            save_analysis, user_id, workspace_id, "concordance", req_dict, {}
        )

        return {
            "state": "running",
            "message": "Concordance analysis started",
            "data": None,
            "metadata": {"task_id": task_info.id},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to submit task: {e}")


@router.get("/{workspace_id}/concordance/current-request")
async def concordance_current_request(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="concordance")
    if not rec:
        rec = get_latest_analysis(user_id, workspace_id, task="multi_concordance")
    if not rec:
        return None
    normalized_request = _normalize_saved_request(rec.request, rec.result)
    if not normalized_request:
        return None
    return {"state": "successful", "message": "ok", "data": normalized_request}


def _filter_concordance_rows(df: pl.DataFrame) -> pl.DataFrame:
    if not isinstance(df, pl.DataFrame) or df.height == 0:
        return df

    candidate_columns = [
        col
        for col in ("matched_text", "left_context", "right_context")
        if col in df.columns
    ]
    if not candidate_columns:
        return df

    try:
        non_empty_checks = [
            (
                pl.col(col)
                .cast(pl.Utf8, strict=False)
                .str.strip_chars()
                .str.len_chars()
                .fill_null(0)
                > 0
            )
            for col in candidate_columns
        ]
        mask = pl.any_horizontal(non_empty_checks)
        return df.filter(mask)
    except Exception:
        fallback_mask = pl.any_horizontal([
            pl.col(col).is_not_null() for col in candidate_columns
        ])
        return df.filter(fallback_mask)


def _paginate_dataframe(
    df: pl.DataFrame,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    sort_order: Optional[str],
) -> Dict[str, Any]:
    df = _filter_concordance_rows(df)
    total_matches = df.height

    if sort_by and sort_by in df.columns:
        df = df.sort(sort_by, descending=(sort_order == "desc"))

    start_idx = (page - 1) * page_size
    paginated_df = df.slice(start_idx, page_size)

    columns = df.columns
    metadata = {
        "concordance_columns": [c for c in columns if c in CORE_CONCORDANCE_COLUMNS],
        "metadata_columns": [c for c in columns if c not in CORE_CONCORDANCE_COLUMNS],
        "all_columns": columns,
    }

    return {
        "data": paginated_df.to_dicts(),
        "columns": columns,
        "metadata": metadata,
        "total_matches": total_matches,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_pages": (total_matches + page_size - 1) // page_size,
            "has_next": (start_idx + page_size) < total_matches,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": sort_by,
            "sort_order": sort_order,
        },
    }


def _reorder_dataframe_columns(
    df: pl.DataFrame, preferred_order: List[str]
) -> pl.DataFrame:
    if not preferred_order:
        return df
    ordered = [col for col in preferred_order if col in df.columns]
    remaining = [col for col in df.columns if col not in ordered]
    if not ordered:
        return df
    return df.select([pl.col(col) for col in ordered + remaining])


def _coerce_result_to_dataframe(entry: Any) -> pl.DataFrame:
    if isinstance(entry, pl.DataFrame):
        return entry
    if isinstance(entry, pl.LazyFrame):
        return entry.collect()
    if isinstance(entry, list):
        return pl.DataFrame(entry)
    if isinstance(entry, dict):
        if "rows" in entry:
            df = pl.DataFrame(entry.get("rows") or [])
            columns = entry.get("columns") or []
            return _reorder_dataframe_columns(df, columns)
        if "data" in entry:
            df = pl.DataFrame(entry.get("data") or [])
            columns = entry.get("columns") or []
            return _reorder_dataframe_columns(df, columns)
        try:
            return pl.DataFrame(entry)
        except Exception:
            pass
    raise ValueError("Unsupported concordance result payload")


def _process_dataframe_result(
    result: Dict[str, Any],
    request: Dict[str, Any],
) -> Dict[str, Any]:
    node_results = result.get("node_results", {})
    page = request.get("page", DEFAULT_CONCORDANCE_PAGE)
    page_size = request.get("page_size", DEFAULT_CONCORDANCE_PAGE_SIZE)
    sort_by = request.get("sort_by")
    sort_order = request.get("sort_order", DEFAULT_CONCORDANCE_SORT_ORDER)

    data = {}
    for node_id, df in node_results.items():
        df_obj = _coerce_result_to_dataframe(df)
        data[node_id] = _paginate_dataframe(
            df_obj, page, page_size, sort_by, sort_order
        )

    return {
        "state": "successful",
        "message": "Concordance analysis complete",
        "data": data,
        "analysis_params": request,
        "combinable": False,
    }


@router.get("/{workspace_id}/concordance/current-result")
async def concordance_current_result(
    workspace_id: str,
    query: ConcordanceResultQuery = Depends(),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="concordance")
    if not rec:
        rec = get_latest_analysis(user_id, workspace_id, task="multi_concordance")
    if not rec:
        return None

    # Check for new task-based result format
    result_data = rec.result.get("data") if isinstance(rec.result, dict) else None
    if isinstance(result_data, dict) and "node_results" in result_data:
        normalized_request = _normalize_saved_request(rec.request, rec.result) or {}

        _apply_result_query_overrides(normalized_request, query)
        return _process_dataframe_result(result_data, normalized_request)

    normalized_request = _normalize_saved_request(rec.request, rec.result)
    if not normalized_request:
        return None

    # Update pagination params from query for legacy path too
    _apply_result_query_overrides(normalized_request, query)

    normalized_result = _normalize_saved_result(rec.result, normalized_request)
    if not normalized_result:
        return None
    return normalized_result


@router.post("/{workspace_id}/concordance/current-result")
async def concordance_current_result_post(
    workspace_id: str,
    query: ConcordanceResultQuery,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="concordance")
    if not rec:
        rec = get_latest_analysis(user_id, workspace_id, task="multi_concordance")
    if not rec or not rec.request:
        return {
            "state": "failed",
            "message": "No analysis found for concordance",
            "data": None,
        }

    # Check for new task-based result format
    result_data = rec.result.get("data") if isinstance(rec.result, dict) else None
    if isinstance(result_data, dict) and "node_results" in result_data:
        normalized_request = _normalize_saved_request(rec.request, rec.result) or {}

        _apply_result_query_overrides(normalized_request, query)
        return _process_dataframe_result(result_data, normalized_request)

    normalized_request = _normalize_saved_request(rec.request, rec.result)
    base_result = rec.result or {}
    stored_blob = base_result.get("_stored") if isinstance(base_result, dict) else None

    if stored_blob:
        mutable_result = deepcopy(base_result) if isinstance(base_result, dict) else {}
        stored_blob = mutable_result.get("_stored") or {}
        if not isinstance(stored_blob, dict):
            stored_blob = {}

        preferences = stored_blob.get("preferences") or {}
        if not isinstance(preferences, dict):
            preferences = {}
        show_metadata_pref = bool(preferences.get("show_metadata", False))
        preferences_changed = False

        default_page_info = dict(stored_blob.get("default_page") or {})
        base_default_page = default_page_info.get("page", DEFAULT_CONCORDANCE_PAGE)
        base_default_sort_by = default_page_info.get("sort_by")
        base_default_sort_order = default_page_info.get("sort_order")

        existing_default_page_size = default_page_info.get("page_size")
        effective_page_size = (
            existing_default_page_size
            if isinstance(existing_default_page_size, int)
            and existing_default_page_size > 0
            else DEFAULT_CONCORDANCE_PAGE_SIZE
        )
        pref_page_size = preferences.get("page_size")
        if isinstance(pref_page_size, int) and pref_page_size > 0:
            effective_page_size = pref_page_size

        if query.page_size is not None:
            normalized_page_size = max(1, int(query.page_size))
            if normalized_page_size != pref_page_size:
                preferences["page_size"] = normalized_page_size
                preferences_changed = True
            effective_page_size = normalized_page_size

        requested_page = (
            query.page_number
            if query.page_number is not None
            else query.page
            if query.page is not None
            else base_default_page
        )
        if requested_page is None:
            requested_page = DEFAULT_CONCORDANCE_PAGE
        requested_page = max(1, int(requested_page))

        if query.show_metadata is not None:
            normalized_show_metadata = bool(query.show_metadata)
            if normalized_show_metadata != show_metadata_pref:
                preferences_changed = True
            show_metadata_pref = normalized_show_metadata
            preferences["show_metadata"] = show_metadata_pref

        stored_blob["preferences"] = preferences

        requested_page_size = effective_page_size
        requested_sort_by = (
            query.sort_by if query.sort_by is not None else base_default_sort_by
        )
        requested_sort_order = (
            query.sort_order
            if query.sort_order is not None
            else base_default_sort_order
        )
        if requested_sort_order is None:
            requested_sort_order = DEFAULT_CONCORDANCE_SORT_ORDER

        nodes_source = stored_blob.get("nodes") or {}
        if isinstance(nodes_source, dict):
            nodes_map: Dict[str, Dict[str, Any]] = {
                key: deepcopy(value) if isinstance(value, dict) else value
                for key, value in nodes_source.items()
            }
        else:
            nodes_map = {}
        label_to_node_source = stored_blob.get("label_to_node_map") or {}
        label_to_node: Dict[str, str] = (
            dict(label_to_node_source) if isinstance(label_to_node_source, dict) else {}
        )

        base_state = base_result.get("state", "successful")
        base_message = base_result.get("message", "ok")
        existing_params: Dict[str, Any] = {}
        if isinstance(mutable_result.get("analysis_params"), dict):
            existing_params = dict(mutable_result["analysis_params"])
        elif isinstance(normalized_request, dict):
            existing_params = dict(normalized_request)

        derived_page = requested_page
        derived_page_size = requested_page_size
        derived_sort_by = requested_sort_by
        derived_sort_order = requested_sort_order

        fetch_intent = (
            (query.page is not None)
            or (query.page_number is not None)
            or (query.node_id is not None)
            or (query.combined is True)
            or (query.sort_by is not None)
            or (query.sort_order is not None)
        )
        preference_only_request = (
            query.page_size is not None or query.show_metadata is not None
        ) and not fetch_intent
        update_only = bool(query.update_only) or preference_only_request

        response_data: Dict[str, Dict[str, Any]] = {}
        target_nodes: List[Tuple[str, str, Dict[str, Any]]] = []

        if not update_only:
            if query.combined or (query.node_id == "__COMBINED__"):
                combined_entry = nodes_map.get("__COMBINED__")
                if not isinstance(combined_entry, dict):
                    return {
                        "state": "failed",
                        "message": "Combined concordance view not available",
                        "data": None,
                    }
                target_nodes.append(("__COMBINED__", "__COMBINED__", combined_entry))
            elif query.node_id:
                lookup_key = query.node_id
                if lookup_key not in nodes_map and lookup_key in label_to_node:
                    lookup_key = label_to_node[lookup_key]
                entry = nodes_map.get(lookup_key)
                if not isinstance(entry, dict):
                    return {
                        "state": "failed",
                        "message": f"No stored concordance found for node {query.node_id}",
                        "data": None,
                    }
                label = entry.get("label") or lookup_key
                target_nodes.append((label, lookup_key, entry))
            else:
                for node_key, entry in nodes_map.items():
                    if node_key == "__COMBINED__":
                        continue
                    if not isinstance(entry, dict):
                        continue
                    label = entry.get("label") or node_key
                    target_nodes.append((label, node_key, entry))

        if update_only:
            preferences["page_size"] = derived_page_size
            preferences["show_metadata"] = show_metadata_pref
            stored_blob["preferences"] = preferences
            if preferences_changed:
                for node_key, entry in nodes_map.items():
                    if isinstance(entry, dict):
                        entry["default_page_size"] = derived_page_size
                stored_blob["nodes"] = nodes_map
            stored_blob["default_page"] = {
                "page": derived_page,
                "page_size": derived_page_size,
                "sort_by": derived_sort_by,
                "sort_order": derived_sort_order,
            }

            existing_preferences = (
                existing_params.get("preferences")
                if isinstance(existing_params.get("preferences"), dict)
                else {}
            )
            merged_preferences = {
                **existing_preferences,
                "page_size": derived_page_size,
                "show_metadata": show_metadata_pref,
            }
            analysis_params = {
                **existing_params,
                "page": derived_page,
                "page_size": derived_page_size,
                "sort_by": derived_sort_by,
                "sort_order": derived_sort_order,
                "pagination": {
                    "page": derived_page,
                    "page_size": derived_page_size,
                    "sort_by": derived_sort_by,
                    "sort_order": derived_sort_order,
                },
                "show_metadata": show_metadata_pref,
                "preferences": merged_preferences,
            }

            updated_payloads: Dict[str, Dict[str, Any]] = {}
            for node_key, entry in nodes_map.items():
                if not isinstance(entry, dict):
                    continue
                label = entry.get("label") or node_key
                try:
                    paginated = _paginate_stored_entry(
                        entry,
                        derived_page,
                        derived_page_size,
                        derived_sort_by,
                        derived_sort_order,
                    )
                except HTTPException:
                    continue
                updated_payloads[label] = paginated
                entry["default_sort_by"] = paginated["sorting"].get("sort_by")
                entry["default_sort_order"] = paginated["sorting"].get("sort_order")
                entry["default_page_size"] = paginated["pagination"]["page_size"]
                entry["default_page"] = paginated["pagination"]["page"]
                nodes_map[node_key] = entry

            stored_blob["nodes"] = nodes_map

            mutable_result["data"] = updated_payloads or mutable_result.get("data")
            mutable_result["analysis_params"] = analysis_params
            mutable_result["preferences"] = merged_preferences
            mutable_result["_stored"] = stored_blob

            try:
                from ....core.analysis_store import save_analysis

                request_dict = (
                    dict(rec.request) if isinstance(rec.request, dict) else {}
                )
                save_analysis(
                    user_id=user_id,
                    workspace_id=workspace_id,
                    task=rec.task,
                    request_dict=request_dict,
                    result_dict=mutable_result,
                )
            except Exception as exc:  # pragma: no cover
                logger.warning(
                    "Failed to persist concordance preference update: %s", exc
                )

            return {
                "state": "successful",
                "message": "saved",
            }

        for label, node_key, entry in target_nodes:
            payload = _paginate_stored_entry(
                entry,
                requested_page,
                requested_page_size,
                requested_sort_by,
                requested_sort_order,
            )
            response_data[label] = payload
            derived_page = payload["pagination"]["page"]
            derived_page_size = payload["pagination"]["page_size"]
            derived_sort_by = payload["sorting"].get("sort_by")
            derived_sort_order = payload["sorting"].get("sort_order")
            if isinstance(entry, dict):
                entry["default_sort_by"] = derived_sort_by
                entry["default_sort_order"] = derived_sort_order
                entry["default_page_size"] = derived_page_size
                entry["default_page"] = derived_page
                nodes_map[node_key] = entry

        preferences["page_size"] = derived_page_size
        preferences["show_metadata"] = show_metadata_pref
        stored_blob["preferences"] = preferences
        stored_blob["nodes"] = nodes_map
        stored_blob["default_page"] = {
            "page": derived_page,
            "page_size": derived_page_size,
            "sort_by": derived_sort_by,
            "sort_order": derived_sort_order,
        }

        existing_preferences = (
            existing_params.get("preferences")
            if isinstance(existing_params.get("preferences"), dict)
            else {}
        )
        merged_preferences = {
            **existing_preferences,
            "page_size": derived_page_size,
            "show_metadata": show_metadata_pref,
        }

        analysis_params = {
            **existing_params,
            "page": derived_page,
            "page_size": derived_page_size,
            "sort_by": derived_sort_by,
            "sort_order": derived_sort_order,
            "pagination": {
                "page": derived_page,
                "page_size": derived_page_size,
                "sort_by": derived_sort_by,
                "sort_order": derived_sort_order,
            },
            "show_metadata": show_metadata_pref,
            "preferences": merged_preferences,
        }
        if query.combined or (query.node_id == "__COMBINED__"):
            analysis_params["combined"] = True
        if query.node_id:
            lookup_key = query.node_id
            if lookup_key in label_to_node:
                lookup_key = label_to_node[lookup_key]
            analysis_params["selected_node_id"] = lookup_key

        existing_data = mutable_result.get("data")
        if isinstance(existing_data, dict):
            merged_data = {**existing_data, **response_data}
        else:
            merged_data = dict(response_data)
        mutable_result["data"] = merged_data
        mutable_result["analysis_params"] = analysis_params
        mutable_result["preferences"] = merged_preferences
        mutable_result["_stored"] = stored_blob

        try:
            from ....core.analysis_store import save_analysis

            request_dict = dict(rec.request) if isinstance(rec.request, dict) else {}
            save_analysis(
                user_id=user_id,
                workspace_id=workspace_id,
                task=rec.task,
                request_dict=request_dict,
                result_dict=mutable_result,
            )
        except Exception as exc:  # pragma: no cover
            logger.warning(
                "Failed to persist concordance current-result update: %s", exc
            )

        return {
            "state": base_state,
            "message": base_message,
            "data": response_data,
            "analysis_params": analysis_params,
            "preferences": merged_preferences,
            "combinable": stored_blob.get("combinable", False),
        }

    # Fallback: re-run concordance if storage unavailable
    if not normalized_request:
        return {
            "state": "failed",
            "message": "Unable to reconstruct prior concordance request",
            "data": None,
        }
    request_payload = normalized_request.copy()
    if query.node_id:
        request_payload["node_ids"] = [query.node_id]
        node_columns = request_payload.get("node_columns", {})
        if query.node_id not in node_columns:
            analysis_params = (rec.result or {}).get("analysis_params") or {}
            column_hint = analysis_params.get("column")
            if not column_hint:
                return {
                    "state": "failed",
                    "message": f"No column information available for node {query.node_id}",
                    "data": None,
                }
            node_columns[query.node_id] = column_hint
            request_payload["node_columns"] = node_columns
    if query.combined is not None:
        request_payload["combined"] = query.combined
    page_override = query.page_number if query.page_number is not None else query.page
    page_size_override = query.page_size
    sort_by_override = query.sort_by
    sort_order_override = query.sort_order

    try:
        next_request = ConcordanceAnalysisRequest(**request_payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid request parameters: {e}")

    return await _execute_concordance(
        workspace_id,
        next_request,
        current_user,
        page_override=page_override,
        page_size_override=page_size_override,
        sort_by_override=sort_by_override,
        sort_order_override=sort_order_override,
        show_metadata_override=query.show_metadata,
    )


@router.post("/{workspace_id}/concordance/clear")
async def clear_concordance_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    from ....core.analysis_admin import clear_analyses_and_cache

    summary = await clear_analyses_and_cache(user_id, workspace_id, task="concordance")
    return {"state": "successful", "cleared": summary}


@router.post("/{workspace_id}/concordance/cache/clear")
async def clear_concordance_cache(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    from ....core.analysis_admin import clear_concordance_cache_for

    removed = clear_concordance_cache_for(user_id, workspace_id)
    return {"state": "successful", "removed": removed}


@router.post("/{workspace_id}/concordance/multi-node/clear")
async def clear_multi_concordance_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import clear_analyses
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    removed = clear_analyses(user_id, workspace_id, task="multi_concordance")
    from ....core.analysis_admin import clear_concordance_cache_for

    cache_removed = clear_concordance_cache_for(user_id, workspace_id)
    return {
        "state": "successful",
        "cleared": {
            "analyses_removed": removed,
            "concordance_cache_removed": cache_removed,
        },
    }


# ---------------------------------------------------------------------------
# Concordance detach endpoint (base.py lines ~3432-3594)
# ---------------------------------------------------------------------------
@router.post("/{workspace_id}/nodes/{node_id}/concordance/detach")
async def detach_concordance(
    workspace_id: str,
    node_id: str,
    request: ConcordanceDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
        if workspace_dir is None:
            raise HTTPException(
                status_code=404,
                detail=f"Workspace folder not found for workspace {workspace_id}",
            )
        if hasattr(node.data, "columns"):
            available_columns = node.data.columns
        elif hasattr(node.data, "schema"):
            available_columns = list(node.data.schema.keys())
        else:
            available_columns = []
        if available_columns and request.column not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{request.column}' not found. Available columns: {available_columns}",
            )
        # Persist chosen text column for future analyses
        _prepare_doclazy_frame(node, request.column, user_id, workspace_id)
        if hasattr(node.data, "text"):
            cache_key = _concordance_cache_key(
                user_id,
                workspace_id,
                node_id,
                request.column,
                request.search_word,
                request.num_left_tokens,
                request.num_right_tokens,
                request.regex,
                request.case_sensitive,
            )
            concordance_result = _get_cached_concordance_df(cache_key)

            if concordance_result is None:
                concordance_result = node.data.text.concordance(
                    column=request.column,
                    search_word=request.search_word,
                    num_left_tokens=request.num_left_tokens,
                    num_right_tokens=request.num_right_tokens,
                    regex=request.regex,
                    case_sensitive=request.case_sensitive,
                    explode=True,
                    unnest=True,
                )
                _store_concordance_df(cache_key, concordance_result)

            if "document_idx" not in concordance_result.columns:
                concordance_with_idx = concordance_result.with_row_index("document_idx")
            else:
                concordance_with_idx = concordance_result
            if isinstance(node.data, pl.LazyFrame):
                underlying_df = node.data.collect()
            elif hasattr(node.data, "to_lazyframe"):
                underlying_df = node.data.to_lazyframe().collect()  # type: ignore
            elif hasattr(node.data, "_df") and not isinstance(node.data, pl.DataFrame):
                underlying_df = node.data._df  # type: ignore[attr-defined]
            else:
                underlying_df = node.data
            if isinstance(underlying_df, pl.LazyFrame):
                underlying_df = underlying_df.collect()
            if not isinstance(underlying_df, pl.DataFrame):
                raise HTTPException(
                    status_code=500,
                    detail="Failed to materialize underlying data for concordance detach",
                )
            original_with_idx = underlying_df.with_row_index("document_idx")
            other_df = concordance_with_idx.select([
                "document_idx",
                "left_context",
                "matched_text",
                "right_context",
                "start_idx",
                "end_idx",
                "l1",
                "r1",
                "l1_freq",
                "r1_freq",
            ])
            other_df = _filter_concordance_rows(other_df)
            final_data = original_with_idx.join(
                other_df, on="document_idx", how="right"
            ).drop("document_idx")
            if request.new_node_name:
                new_node_name = request.new_node_name
            else:
                original_name = (
                    node.name if hasattr(node, "name") and node.name else node_id
                )
                new_node_name = f"{original_name}_conc_{request.search_word}"
            document_column = getattr(node, "document", None) or getattr(
                node.data, "document_column", None
            )
            lazy_data = stage_dataframe_as_lazy(
                final_data, workspace_dir, new_node_name, document_column
            )
            new_node = workspace_manager.add_node_to_workspace(
                user_id=user_id,
                workspace_id=workspace_id,
                data=lazy_data,
                node_name=new_node_name,
                operation="concordance_detach",
                parents=[node],
            )
            if not new_node:
                raise HTTPException(
                    status_code=500, detail="Failed to create detached concordance node"
                )
            total_rows = final_data.height if hasattr(final_data, "height") else -1
            return {
                "success": True,
                "message": f"Successfully created detached concordance node '{new_node_name}' with {total_rows if total_rows >= 0 else 'unknown'} rows",
                "new_node_id": new_node.id,
                "new_node_name": new_node_name,
                "total_rows": total_rows,
                "concordance_matches": len(concordance_result),
            }
        else:
            raise HTTPException(
                status_code=400,
                detail="This node does not support text analysis (DocFrame text namespace not available)",
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR: Error in detach concordance: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error detaching concordance results: {str(e)}"
        )
