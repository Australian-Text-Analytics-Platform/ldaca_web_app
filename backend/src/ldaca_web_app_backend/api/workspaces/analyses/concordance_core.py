"""Core concordance computation helpers shared by route handlers."""

from __future__ import annotations

import logging
import math
from typing import Any, Optional

import polars as pl
from fastapi import HTTPException

from ....core.workspace import workspace_manager
from .generated_columns import (
    CONC_LEFT_CONTEXT_COLUMN,
    CONC_MATCHED_TEXT_COLUMN,
    CONC_RIGHT_CONTEXT_COLUMN,
    CORE_CONCORDANCE_COLUMNS,
    concordance_struct_projection,
)

logger = logging.getLogger(__name__)

DEFAULT_CONCORDANCE_PAGE = 1
DEFAULT_CONCORDANCE_PAGE_SIZE = 20
DEFAULT_CONCORDANCE_DESCENDING = True

_REQUEST_EXCLUDE_KEYS = {
    "page",
    "page_size",
    "sort_by",
    "descending",
    "pagination",
}


def normalize_saved_request(raw_request: Optional[dict]) -> Optional[dict]:
    """Normalize stored concordance request payloads.

    Used by:
    - `sanitize_request_for_storage`
    - concordance result endpoints before response rebuild

    Why:
    - Ensures persisted requests omit view-only keys and keep stable defaults.
    """
    if not raw_request:
        return None
    if "node_ids" not in raw_request or "node_columns" not in raw_request:
        return None

    normalized_request = dict(raw_request)
    if not normalized_request.get("combined"):
        normalized_request.pop("combined", None)
    for field in _REQUEST_EXCLUDE_KEYS:
        normalized_request.pop(field, None)

    normalized_request = {
        key: value for key, value in normalized_request.items() if value is not None
    }
    return normalized_request


def sanitize_request_for_storage(request_dict: dict[str, Any]) -> dict[str, Any]:
    """Return a storage-safe concordance request snapshot.

    Used by:
    - Concordance route handlers when persisting task requests.

    Why:
    - Prevents transient pagination/sorting fields from polluting saved inputs.
    """
    normalized = normalize_saved_request(request_dict)
    return normalized or {}


def concordance_non_empty_expr() -> pl.Expr:
    """Build an expression that removes empty concordance rows.

    Used by:
    - `build_concordance_lazyframe`

    Why:
    - Drops rows with no meaningful matched/context text before pagination.
    """
    return pl.any_horizontal([
        pl
        .col(CONC_MATCHED_TEXT_COLUMN)
        .cast(pl.Utf8, strict=False)
        .str.strip_chars()
        .str.len_chars()
        .fill_null(0)
        > 0,
        pl
        .col(CONC_LEFT_CONTEXT_COLUMN)
        .cast(pl.Utf8, strict=False)
        .str.strip_chars()
        .str.len_chars()
        .fill_null(0)
        > 0,
        pl
        .col(CONC_RIGHT_CONTEXT_COLUMN)
        .cast(pl.Utf8, strict=False)
        .str.strip_chars()
        .str.len_chars()
        .fill_null(0)
        > 0,
    ])


def build_concordance_lazyframe(
    node_data: pl.LazyFrame,
    column: str,
    request: dict[str, Any],
) -> pl.LazyFrame:
    """Create concordance rows from a source LazyFrame and request options.

    Used by:
    - `compute_concordance_page`

    Why:
    - Encapsulates `polars_text.concordance` expansion and filtering in one
      reusable transformation step.
    """
    import polars_text as pt

    expr = pt.concordance(
        pl.col(column),
        request["search_word"],
        num_left_tokens=request["num_left_tokens"],
        num_right_tokens=request["num_right_tokens"],
        regex=request["regex"],
        case_sensitive=request["case_sensitive"],
    )
    return (
        node_data
        .select([pl.all(), expr.alias("concordance")])
        .explode("concordance")
        .select([
            pl.exclude("concordance"),
            *concordance_struct_projection("concordance"),
        ])
        .filter(concordance_non_empty_expr())
    )


def resolve_node_sources(
    user_id: str,
    workspace_id: str,
    request: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, str], dict[str, str]]:
    """Resolve workspace nodes into validated concordance source metadata.

    Used by:
    - `build_concordance_response`

    Why:
    - Centralizes node lookup, label mapping, and LazyFrame/type validation.
    """
    node_ids = request.get("node_ids") or []
    node_columns = request.get("node_columns") or {}

    node_sources: dict[str, dict[str, Any]] = {}
    label_to_node_map: dict[str, str] = {}
    node_labels: dict[str, str] = {}
    if workspace_manager.get_current_workspace_id(user_id) != workspace_id:
        if not workspace_manager.set_current_workspace(user_id, workspace_id):
            raise HTTPException(status_code=404, detail="Workspace not found")
    workspace = workspace_manager.get_current_workspace(user_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    for node_id in node_ids:
        node = workspace.nodes.get(node_id)
        if node is None:
            continue
        node_label = getattr(node, "name", None) or node_id
        label_to_node_map[node_label] = node_id
        node_labels[node_id] = node_label
        node_data = getattr(node, "data", node)
        if not isinstance(node_data, pl.LazyFrame):
            raise HTTPException(
                status_code=400,
                detail=f"Node {node_id} data must be a LazyFrame",
            )
        column = node_columns.get(node_id)
        if not column:
            continue
        node_sources[node_id] = {
            "lf": node_data,
            "column": column,
            "label": node_label,
        }

    return node_sources, label_to_node_map, node_labels


def compute_concordance_page(
    base_lf: pl.LazyFrame,
    column: str,
    request: dict[str, Any],
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    descending: bool,
    node_label: Optional[str] = None,
) -> dict[str, Any]:
    """Compute one concordance page for a single node source.

    Used by:
    - `build_concordance_response`
    - `collect_interleaved_combined`

    Why:
    - Produces a stable page payload shape shared by single-node and combined
      result views.
    """
    total_source_rows = base_lf.select(pl.len()).collect().item()

    effective_sort_by: Optional[str] = None
    if sort_by:
        try:
            schema = base_lf.collect_schema()
            if sort_by in schema and sort_by not in CORE_CONCORDANCE_COLUMNS:
                base_lf = base_lf.sort(sort_by, descending=descending)
                effective_sort_by = sort_by
        except Exception as exc:
            logger.debug(
                "Ignoring unsupported sort_by '%s' for concordance page: %s",
                sort_by,
                exc,
            )

    start = max(page - 1, 0) * page_size
    page_lf = base_lf.slice(start, page_size)

    concordance_lf = build_concordance_lazyframe(page_lf, column, request)
    if node_label:
        concordance_lf = concordance_lf.with_columns(
            pl.lit(node_label).alias("__source_node")
        )
    result_df = concordance_lf.collect()

    columns = result_df.columns if result_df.height > 0 else []
    page_rows = result_df.to_dicts()

    total_source_pages = max(1, math.ceil(total_source_rows / page_size))

    metadata = {
        "concordance_columns": [c for c in columns if c in CORE_CONCORDANCE_COLUMNS],
        "metadata_columns": [c for c in columns if c not in CORE_CONCORDANCE_COLUMNS],
        "all_columns": columns,
    }

    return {
        "data": page_rows,
        "columns": columns,
        "metadata": metadata,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_source_rows": total_source_rows,
            "total_source_pages": total_source_pages,
            "result_count": len(page_rows),
            "has_next": page < total_source_pages,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "descending": descending,
        },
    }


def empty_concordance_page(page: int, page_size: int) -> dict[str, Any]:
    """Return an empty concordance page payload with metadata defaults.

    Used by:
    - `build_concordance_response` fallback paths

    Why:
    - Keeps response contracts consistent when no source rows are available.
    """
    return {
        "data": [],
        "columns": [],
        "metadata": {
            "concordance_columns": [],
            "metadata_columns": [],
            "all_columns": [],
        },
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_source_rows": 0,
            "total_source_pages": 0,
            "result_count": 0,
            "has_next": False,
            "has_prev": page > 1,
        },
        "sorting": {"sort_by": None, "descending": DEFAULT_CONCORDANCE_DESCENDING},
    }


def collect_interleaved_combined(
    left_base_lf: pl.LazyFrame,
    left_column: str,
    right_base_lf: pl.LazyFrame,
    right_column: str,
    request: dict[str, Any],
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    descending: bool,
    left_label: Optional[str] = None,
    right_label: Optional[str] = None,
) -> dict[str, Any]:
    """Combine two node concordance pages using left-right interleaving.

    Used by:
    - `build_concordance_response` when `combined=True` and two nodes are set.

    Why:
    - Preserves per-node page semantics while presenting a merged comparison view.
    """
    left_result = compute_concordance_page(
        left_base_lf,
        left_column,
        request,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        descending=descending,
        node_label=left_label,
    )
    right_result = compute_concordance_page(
        right_base_lf,
        right_column,
        request,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        descending=descending,
        node_label=right_label,
    )

    left_all_rows = left_result["data"]
    right_all_rows = right_result["data"]

    all_interleaved: list[dict[str, Any]] = []
    li, ri = 0, 0
    use_left = True
    while li < len(left_all_rows) or ri < len(right_all_rows):
        if use_left:
            if li < len(left_all_rows):
                all_interleaved.append(left_all_rows[li])
                li += 1
            elif ri < len(right_all_rows):
                all_interleaved.append(right_all_rows[ri])
                ri += 1
                use_left = not use_left
                continue
            else:
                break
        else:
            if ri < len(right_all_rows):
                all_interleaved.append(right_all_rows[ri])
                ri += 1
            elif li < len(left_all_rows):
                all_interleaved.append(left_all_rows[li])
                li += 1
                use_left = not use_left
                continue
            else:
                break
        use_left = not use_left

    columns = left_result.get("columns") or right_result.get("columns") or []
    if left_result.get("columns") and right_result.get("columns"):
        columns = list(dict.fromkeys(left_result["columns"] + right_result["columns"]))

    metadata = {
        "concordance_columns": [c for c in columns if c in CORE_CONCORDANCE_COLUMNS],
        "metadata_columns": [c for c in columns if c not in CORE_CONCORDANCE_COLUMNS],
        "all_columns": columns,
    }

    effective_sort_by = left_result["sorting"].get("sort_by") or right_result[
        "sorting"
    ].get("sort_by")

    left_pag = left_result["pagination"]
    right_pag = right_result["pagination"]
    total_source_rows = max(
        left_pag.get("total_source_rows", 0),
        right_pag.get("total_source_rows", 0),
    )
    total_source_pages = max(
        left_pag.get("total_source_pages", 0),
        right_pag.get("total_source_pages", 0),
    )

    return {
        "data": all_interleaved,
        "columns": columns,
        "metadata": metadata,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_source_rows": total_source_rows,
            "total_source_pages": total_source_pages,
            "result_count": len(all_interleaved),
            "has_next": page < total_source_pages,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "descending": descending,
        },
    }


def build_concordance_response(
    user_id: str,
    workspace_id: str,
    request: dict[str, Any],
) -> dict[str, Any]:
    """Build the full concordance API response from a normalized request.

    Used by:
    - `concordance.run_concordance`
    - `concordance_task_result`
    - `concordance_task_result_post`

    Why:
    - Provides one shared response builder for run and retrieval endpoints,
      avoiding payload drift across routes.
    """
    page = int(request.get("page") or DEFAULT_CONCORDANCE_PAGE)
    page_size = int(request.get("page_size") or DEFAULT_CONCORDANCE_PAGE_SIZE)
    sort_by = request.get("sort_by")
    descending = bool(request.get("descending", DEFAULT_CONCORDANCE_DESCENDING))
    combined = bool(request.get("combined"))

    node_ids = request.get("node_ids") or []

    node_sources, label_to_node_map, _node_labels = resolve_node_sources(
        user_id, workspace_id, request
    )
    data: dict[str, Any] = {}

    if combined and node_ids:
        if len(node_ids) == 2:
            left_id, right_id = node_ids
            left_src = node_sources.get(left_id)
            right_src = node_sources.get(right_id)
            if left_src and right_src:
                data["__COMBINED__"] = collect_interleaved_combined(
                    left_src["lf"],
                    left_src["column"],
                    right_src["lf"],
                    right_src["column"],
                    request,
                    page=page,
                    page_size=page_size,
                    sort_by=sort_by,
                    descending=descending,
                    left_label=left_src.get("label"),
                    right_label=right_src.get("label"),
                )
            else:
                data["__COMBINED__"] = empty_concordance_page(page, page_size)
        else:
            all_rows: list[dict[str, Any]] = []
            columns: list[str] = []
            max_total_source_rows = 0
            max_total_source_pages = 0
            for node_id in node_ids:
                src = node_sources.get(node_id)
                if not src:
                    continue
                node_result = compute_concordance_page(
                    src["lf"],
                    src["column"],
                    request,
                    page=page,
                    page_size=page_size,
                    sort_by=sort_by,
                    descending=descending,
                    node_label=src.get("label"),
                )
                all_rows.extend(node_result["data"])
                if not columns and node_result["columns"]:
                    columns = node_result["columns"]
                pag = node_result["pagination"]
                max_total_source_rows = max(
                    max_total_source_rows, pag.get("total_source_rows", 0)
                )
                max_total_source_pages = max(
                    max_total_source_pages, pag.get("total_source_pages", 0)
                )

            metadata = {
                "concordance_columns": [
                    c for c in columns if c in CORE_CONCORDANCE_COLUMNS
                ],
                "metadata_columns": [
                    c for c in columns if c not in CORE_CONCORDANCE_COLUMNS
                ],
                "all_columns": columns,
            }
            data["__COMBINED__"] = {
                "data": all_rows,
                "columns": columns,
                "metadata": metadata,
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total_source_rows": max_total_source_rows,
                    "total_source_pages": max_total_source_pages,
                    "result_count": len(all_rows),
                    "has_next": page < max_total_source_pages,
                    "has_prev": page > 1,
                },
                "sorting": {"sort_by": sort_by, "descending": descending},
            }
        combinable = len(node_ids) > 1
    else:
        for node_id in node_ids:
            src = node_sources.get(node_id)
            if not src:
                continue
            data[node_id] = compute_concordance_page(
                src["lf"],
                src["column"],
                request,
                page=page,
                page_size=page_size,
                sort_by=sort_by,
                descending=descending,
                node_label=src.get("label"),
            )
        combinable = len(node_ids) > 1

    analysis_params = dict(request)
    if label_to_node_map:
        analysis_params["label_to_node_map"] = label_to_node_map

    return {
        "state": "successful",
        "message": "Concordance analysis complete",
        "data": data,
        "analysis_params": analysis_params,
        "combinable": combinable,
    }
