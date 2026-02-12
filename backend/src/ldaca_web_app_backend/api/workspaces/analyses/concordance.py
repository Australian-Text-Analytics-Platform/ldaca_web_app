import logging
import math
from typing import Any, Dict, Optional
from uuid import uuid4

import polars as pl
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import ConcordanceAnalysisRequest, ConcordanceDetachRequest

"""Concordance analysis endpoints.

Includes:
    - POST /workspaces/{workspace_id}/concordance
    - GET  /workspaces/{workspace_id}/concordance/tasks/{task_id}/result
    - POST /workspaces/{workspace_id}/concordance/tasks/{task_id}/result
    - POST /workspaces/{workspace_id}/nodes/{node_id}/concordance/detach

Pagination is source-row based: a page of N source rows is sliced from the
sorted table, then concordance is computed only on those rows and exploded.
The result count per page may vary but source-row pagination is deterministic
and enables total-page reporting.
"""

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["concordance"])


# ---------------------------------------------------------------------------
# Unified concordance helpers and endpoints
# ---------------------------------------------------------------------------
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


def _normalize_sort_order(sort_order: Optional[str]) -> str:
    if isinstance(sort_order, str) and sort_order.lower() == "desc":
        return "desc"
    return "asc"


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
    if query.combined is not None:
        if query.combined:
            normalized_request["combined"] = True
        else:
            normalized_request.pop("combined", None)
    return normalized_request


def _normalize_saved_request(
    raw_request: Optional[dict],
) -> Optional[dict]:
    if not raw_request:
        return None
    if "node_ids" not in raw_request or "node_columns" not in raw_request:
        return None

    normalized_request = dict(raw_request)
    if not normalized_request.get("combined"):
        normalized_request.pop("combined", None)
    for field in _REQUEST_EXCLUDE_KEYS:
        normalized_request.pop(field, None)

    # Keep output compact and deterministic for API responses and storage.
    # Do not drop `False` values (e.g., regex=False); only drop null-like fields.
    normalized_request = {
        key: value for key, value in normalized_request.items() if value is not None
    }
    return normalized_request


def _sanitize_request_for_storage(request_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Sanitize a concordance request dict before persisting.

    For simplicity, the stored/requested format must already be the modern schema:
    `node_ids` + `node_columns`.
    """

    normalized = _normalize_saved_request(request_dict)
    return normalized or {}


def _ensure_lazyframe(node_data: Any) -> pl.LazyFrame:
    if isinstance(node_data, pl.LazyFrame):
        return node_data
    if isinstance(node_data, pl.DataFrame):
        return node_data.lazy()
    return pl.DataFrame(node_data).lazy()


def _concordance_non_empty_expr() -> pl.Expr:
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


def _is_metadata_sort_column(lf: pl.LazyFrame, sort_by: Optional[str]) -> bool:
    if not sort_by:
        return False
    try:
        schema = lf.collect_schema()
    except Exception:
        return False
    return sort_by in schema and sort_by not in CORE_CONCORDANCE_COLUMNS


def _build_concordance_lazyframe(
    node_data: Any,
    column: str,
    request: Dict[str, Any],
) -> pl.LazyFrame:
    import polars_text as pt

    lf = _ensure_lazyframe(node_data)
    expr = pt.concordance(
        pl.col(column),
        request["search_word"],
        num_left_tokens=request["num_left_tokens"],
        num_right_tokens=request["num_right_tokens"],
        regex=request["regex"],
        case_sensitive=request["case_sensitive"],
    )
    return (
        lf
        .select([pl.all(), expr.alias("concordance")])
        .explode("concordance")
        .unnest("concordance")
        .filter(_concordance_non_empty_expr())
    )


def _resolve_node_sources(
    user_id: str,
    workspace_id: str,
    request: Dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, str], dict[str, str]]:
    """Resolve node LazyFrames and labels from the workspace graph.

    Returns (node_sources, label_to_node_map, node_labels).
    """
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
        column = node_columns.get(node_id)
        if not column:
            continue
        node_sources[node_id] = {
            "lf": _ensure_lazyframe(node_data),
            "column": column,
            "label": node_label,
        }

    return node_sources, label_to_node_map, node_labels


def _compute_concordance_page(
    base_lf: pl.LazyFrame,
    column: str,
    request: Dict[str, Any],
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    sort_order: Optional[str],
    node_label: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute concordance results for one page of source rows.

    The logic is: ``lf.sort().slice((page-1)*page_size, page_size).concordance().explode().collect()``.
    Pagination boundaries are defined by source rows, so the result count per
    page may vary but total pages are deterministic.
    """

    # 1. Compute total source rows for pagination metadata
    total_source_rows = base_lf.select(pl.len()).collect().item()

    # 2. Apply metadata sort to the source LazyFrame (before concordance)
    effective_sort_by: Optional[str] = None
    if sort_by:
        try:
            schema = base_lf.collect_schema()
            if sort_by in schema and sort_by not in CORE_CONCORDANCE_COLUMNS:
                base_lf = base_lf.sort(sort_by, descending=(sort_order == "desc"))
                effective_sort_by = sort_by
        except Exception:
            pass

    # 3. Slice source rows for the requested page
    start = max(page - 1, 0) * page_size
    page_lf = base_lf.slice(start, page_size)

    # 4. Run concordance on the sliced source rows → explode → filter
    concordance_lf = _build_concordance_lazyframe(page_lf, column, request)
    if node_label:
        concordance_lf = concordance_lf.with_columns(
            pl.lit(node_label).alias("__source_node")
        )
    result_df = concordance_lf.collect()

    columns = result_df.columns if result_df.height > 0 else []
    page_rows = result_df.to_dicts()

    total_source_pages = max(1, math.ceil(total_source_rows / page_size))
    has_next = page < total_source_pages
    has_prev = page > 1

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
            "has_next": has_next,
            "has_prev": has_prev,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "sort_order": sort_order or DEFAULT_CONCORDANCE_SORT_ORDER,
        },
    }


def _empty_concordance_page(page: int, page_size: int) -> Dict[str, Any]:
    """Return an empty concordance result page."""
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


def _collect_interleaved_combined(
    left_base_lf: pl.LazyFrame,
    left_column: str,
    right_base_lf: pl.LazyFrame,
    right_column: str,
    request: Dict[str, Any],
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    sort_order: Optional[str],
    left_label: Optional[str] = None,
    right_label: Optional[str] = None,
) -> Dict[str, Any]:
    """Interleave concordance results from two nodes using source-row slicing.

    Each node contributes its own page-slice of source rows independently.
    Results are then interleaved alternating left/right.
    """

    left_result = _compute_concordance_page(
        left_base_lf,
        left_column,
        request,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        node_label=left_label,
    )
    right_result = _compute_concordance_page(
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

    # Interleave rows alternating left/right
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

    # Use max total source pages from either side for pagination
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


def _build_concordance_response(
    user_id: str,
    workspace_id: str,
    request: Dict[str, Any],
) -> Dict[str, Any]:
    page = int(request.get("page") or DEFAULT_CONCORDANCE_PAGE)
    page_size = int(request.get("page_size") or DEFAULT_CONCORDANCE_PAGE_SIZE)
    sort_by = request.get("sort_by")
    sort_order = _normalize_sort_order(request.get("sort_order"))
    combined = bool(request.get("combined"))

    node_ids = request.get("node_ids") or []

    node_sources, label_to_node_map, _node_labels = _resolve_node_sources(
        user_id, workspace_id, request
    )
    data: Dict[str, Any] = {}

    if combined and node_ids:
        if len(node_ids) == 2:
            left_id, right_id = node_ids
            left_src = node_sources.get(left_id)
            right_src = node_sources.get(right_id)
            if left_src and right_src:
                data["__COMBINED__"] = _collect_interleaved_combined(
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
                data["__COMBINED__"] = _empty_concordance_page(page, page_size)
        else:
            # 3+ nodes: each node contributes its own page-slice, then concatenate
            all_rows: list[dict[str, Any]] = []
            columns: list[str] = []
            max_total_source_rows = 0
            max_total_source_pages = 0
            for node_id in node_ids:
                src = node_sources.get(node_id)
                if not src:
                    continue
                node_result = _compute_concordance_page(
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
            data[node_id] = _compute_concordance_page(
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


@router.post("/{workspace_id}/concordance")
async def run_concordance(
    workspace_id: str,
    request: ConcordanceAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    task_manager = get_task_manager(user_id, workspace_id)

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
        if hasattr(node_data, "collect_schema"):
            available_columns = list(node_data.collect_schema().names())
        elif hasattr(node_data, "columns"):
            available_columns = node_data.columns
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
        from ....analysis.implementations.concordance import ConcordanceRequest

        analysis_request = ConcordanceRequest(
            node_ids=request.node_ids,
            node_columns=validated_columns,
            search_word=request.search_word,
            num_left_tokens=request.num_left_tokens,
            num_right_tokens=request.num_right_tokens,
            regex=request.regex,
            case_sensitive=request.case_sensitive,
            combined=bool(request.combined),
        )

        task_id = str(uuid4())
        task_manager.save_task(
            AnalysisTask(
                task_id=task_id,
                user_id=user_id,
                workspace_id=workspace_id,
                request=analysis_request,
                status=AnalysisStatus.COMPLETED,
                result=GenericAnalysisResult({"ready": True}),
            )
        )
        task_manager.set_current_task("concordance", task_id)

        normalized_request = (
            _normalize_saved_request(analysis_request.model_dump()) or {}
        )
        normalized_request.setdefault("page", DEFAULT_CONCORDANCE_PAGE)
        normalized_request.setdefault("page_size", DEFAULT_CONCORDANCE_PAGE_SIZE)
        if request.sort_by:
            normalized_request["sort_by"] = request.sort_by
        if request.sort_order:
            normalized_request["sort_order"] = request.sort_order
        if request.combined:
            normalized_request["combined"] = True

        response = _build_concordance_response(
            user_id,
            workspace_id,
            normalized_request,
        )
        response["metadata"] = {"task_id": task_id}
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run concordance: {e}")


@router.get("/{workspace_id}/concordance/tasks/{task_id}/result")
async def concordance_task_result(
    workspace_id: str,
    task_id: str,
    query: ConcordanceResultQuery = Depends(),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id, workspace_id)

    task = task_manager.get_task(task_id)
    if not task:
        return None
    if not task.request:
        return None

    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    normalized_request = _normalize_saved_request(req_dict) or {}
    _apply_result_query_overrides(normalized_request, query)
    return _build_concordance_response(user_id, workspace_id, normalized_request)


@router.post("/{workspace_id}/concordance/tasks/{task_id}/result")
async def concordance_task_result_post(
    workspace_id: str,
    task_id: str,
    query: ConcordanceResultQuery,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id, workspace_id)
    task = task_manager.get_task(task_id)
    if not task:
        return {
            "state": "failed",
            "message": "No analysis found for concordance",
            "data": None,
        }
    if not task.request:
        return {
            "state": "failed",
            "message": "No concordance request available",
            "data": None,
        }

    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    normalized_request = _normalize_saved_request(req_dict) or {}
    _apply_result_query_overrides(normalized_request, query)
    return _build_concordance_response(user_id, workspace_id, normalized_request)


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
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    # Validate node existence before submitting
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        task_info = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="concordance_detach",
            task_args={
                "node_id": node_id,
                "column": request.column,
                "search_word": request.search_word,
                "num_left_tokens": request.num_left_tokens,
                "num_right_tokens": request.num_right_tokens,
                "regex": request.regex,
                "case_sensitive": request.case_sensitive,
                "new_node_name": request.new_node_name,
            },
            task_name=f"Detach Concordance: {request.search_word}",
        )

        return {
            "state": "running",
            "message": "Concordance detach started",
            "data": None,
            "metadata": {"task_id": task_info.id},
        }

    except Exception as e:
        print(f"ERROR: Error in detach concordance task submission: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error submitting detach task: {str(e)}"
        )
