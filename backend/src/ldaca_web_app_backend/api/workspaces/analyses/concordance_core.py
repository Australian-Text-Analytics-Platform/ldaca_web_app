"""Core concordance computation helpers shared by route handlers."""

from __future__ import annotations

import math
from typing import Any, Optional

import polars as pl
from fastapi import HTTPException

from ....core.analysis_helpers import normalize_sort_order as _normalize_sort_order
from ....core.workspace import workspace_manager

CORE_CONCORDANCE_COLUMNS = {
    "left_context",
    "matched_text",
    "right_context",
    "start_idx",
    "end_idx",
    "l1",
    "r1",
}

DEFAULT_CONCORDANCE_PAGE = 1
DEFAULT_CONCORDANCE_PAGE_SIZE = 20
DEFAULT_CONCORDANCE_SORT_ORDER = "asc"

_REQUEST_EXCLUDE_KEYS = {
    "page",
    "page_size",
    "sort_by",
    "sort_order",
    "pagination",
}


def normalize_saved_request(raw_request: Optional[dict]) -> Optional[dict]:
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
    normalized = normalize_saved_request(request_dict)
    return normalized or {}


def concordance_non_empty_expr() -> pl.Expr:
    return pl.any_horizontal([
        pl
        .col("matched_text")
        .cast(pl.Utf8, strict=False)
        .str.strip_chars()
        .str.len_chars()
        .fill_null(0)
        > 0,
        pl
        .col("left_context")
        .cast(pl.Utf8, strict=False)
        .str.strip_chars()
        .str.len_chars()
        .fill_null(0)
        > 0,
        pl
        .col("right_context")
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
        .unnest("concordance")
        .filter(concordance_non_empty_expr())
    )


def resolve_node_sources(
    user_id: str,
    workspace_id: str,
    request: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, str], dict[str, str]]:
    node_ids = request.get("node_ids") or []
    node_columns = request.get("node_columns") or {}

    node_sources: dict[str, dict[str, Any]] = {}
    label_to_node_map: dict[str, str] = {}
    node_labels: dict[str, str] = {}

    for node_id in node_ids:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
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
    sort_order: Optional[str],
    node_label: Optional[str] = None,
) -> dict[str, Any]:
    total_source_rows = base_lf.select(pl.len()).collect().item()

    effective_sort_by: Optional[str] = None
    if sort_by:
        try:
            schema = base_lf.collect_schema()
            if sort_by in schema and sort_by not in CORE_CONCORDANCE_COLUMNS:
                base_lf = base_lf.sort(sort_by, descending=(sort_order == "desc"))
                effective_sort_by = sort_by
        except Exception:
            pass

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
            "sort_order": sort_order or DEFAULT_CONCORDANCE_SORT_ORDER,
        },
    }


def empty_concordance_page(page: int, page_size: int) -> dict[str, Any]:
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
        "sorting": {"sort_by": None, "sort_order": DEFAULT_CONCORDANCE_SORT_ORDER},
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
    sort_order: Optional[str],
    left_label: Optional[str] = None,
    right_label: Optional[str] = None,
) -> dict[str, Any]:
    left_result = compute_concordance_page(
        left_base_lf,
        left_column,
        request,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        node_label=left_label,
    )
    right_result = compute_concordance_page(
        right_base_lf,
        right_column,
        request,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
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
            "sort_order": sort_order or DEFAULT_CONCORDANCE_SORT_ORDER,
        },
    }


def build_concordance_response(
    user_id: str,
    workspace_id: str,
    request: dict[str, Any],
) -> dict[str, Any]:
    page = int(request.get("page") or DEFAULT_CONCORDANCE_PAGE)
    page_size = int(request.get("page_size") or DEFAULT_CONCORDANCE_PAGE_SIZE)
    sort_by = request.get("sort_by")
    sort_order = _normalize_sort_order(request.get("sort_order"))
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
                    sort_order=sort_order,
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
                    sort_order=sort_order,
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
                "sorting": {"sort_by": sort_by, "sort_order": sort_order},
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
                sort_order=sort_order,
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
