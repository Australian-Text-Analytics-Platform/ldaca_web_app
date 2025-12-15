import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import polars as pl
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from docframe import DocDataFrame, DocLazyFrame

from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import ConcordanceAnalysisRequest, ConcordanceDetachRequest
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


"""Concordance analysis endpoints.

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

This module supports the worker-backed `data.node_results` schema stored in
`analysis_store`.
"""

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["concordance"])


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


@router.post("/{workspace_id}/concordance")
async def run_concordance(
    workspace_id: str,
    request: ConcordanceAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    existing_task = analysis_manager.get_current_task("concordance")
    if existing_task and existing_task.status == "running":
        if await tm.any_running(
            task_type="concordance", user_id=user_id, workspace_id=workspace_id
        ):
            return {
                "state": "running",
                "message": "Concordance analysis already running",
                "data": None,
                "metadata": {"task_id": existing_task.task_id},
            }

    # Safety net: if the task manager thinks something is running, return it.
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

        # Persist request as the single "current" run for this analysis.
        from ....analysis.implementations.concordance import ConcordanceRequest

        analysis_request = ConcordanceRequest(
            task_id=task_info.id,
            node_ids=request.node_ids,
            node_columns=validated_columns,
            search_word=request.search_word,
            num_left_tokens=request.num_left_tokens,
            num_right_tokens=request.num_right_tokens,
            regex=request.regex,
            case_sensitive=request.case_sensitive,
        )

        analysis_manager.create_task("concordance", analysis_request)

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
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        return None

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    task = analysis_manager.get_current_task("concordance")
    if not task:
        return None

    # Convert request model to dict for response
    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    normalized_request = _normalize_saved_request(req_dict)
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
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        return None

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    task = analysis_manager.get_current_task("concordance")
    if not task:
        return None

    # If task is running, check if it finished in TM
    if task.status == "running":
        tm = workspace_manager.get_task_manager(user_id, workspace_id)
        tm_task = await tm.get_task(task.task_id)
        if tm_task:
            if tm_task.status == "successful":
                # Task finished, update result
                # Result from TM is likely a dict with node_results
                result_data = tm_task.result

                from ....analysis.results import GenericAnalysisResult

                task.complete(GenericAnalysisResult(result_data))
                analysis_manager.update_task(task)

            elif tm_task.status == "failed":
                task.fail(tm_task.error or "Task failed")
                analysis_manager.update_task(task)
                return None  # Or return error info?

    if not task.result:
        return None

    # Process result for response
    # The result data is in task.result.data (if GenericAnalysisResult)
    result_data = task.result.to_json()

    # Need request for pagination params
    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    normalized_request = _normalize_saved_request(req_dict) or {}
    _apply_result_query_overrides(normalized_request, query)

    # result_data should be the dict with "node_results"
    if not isinstance(result_data, dict) or "node_results" not in result_data:
        # Maybe it's the old format or something else?
        # If it's GenericAnalysisResult, it returns self.data.
        pass

    return _process_dataframe_result(result_data, normalized_request)


@router.post("/{workspace_id}/concordance/current-result")
async def concordance_current_result_post(
    workspace_id: str,
    query: ConcordanceResultQuery,
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

    task = analysis_manager.get_current_task("concordance")
    if not task:
        return {
            "state": "failed",
            "message": "No analysis found for concordance",
            "data": None,
        }

    # If task is running, check if it finished in TM (same logic as GET)
    if task.status == "running":
        tm = workspace_manager.get_task_manager(user_id, workspace_id)
        tm_task = await tm.get_task(task.task_id)
        if tm_task:
            if tm_task.status == "successful":
                result_data = tm_task.result
                from ....analysis.results import GenericAnalysisResult

                task.complete(GenericAnalysisResult(result_data))
                analysis_manager.update_task(task)
            elif tm_task.status == "failed":
                task.fail(tm_task.error or "Task failed")
                analysis_manager.update_task(task)
                return {
                    "state": "failed",
                    "message": f"Analysis failed: {task.error}",
                    "data": None,
                }

    if not task.result:
        return {
            "state": "failed",
            "message": "No concordance results available",
            "data": None,
        }

    result_data = task.result.to_json()

    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    normalized_request = _normalize_saved_request(req_dict) or {}
    _apply_result_query_overrides(normalized_request, query)

    if not isinstance(result_data, dict) or "node_results" not in result_data:
        # Handle unexpected result format
        pass

    return _process_dataframe_result(result_data, normalized_request)


@router.post("/{workspace_id}/concordance/clear")
async def clear_concordance_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if ws:
        analysis_manager = getattr(ws, "analysis", None)
        if not analysis_manager:
            from ....analysis.manager import get_analysis_manager

            analysis_manager = get_analysis_manager(user_id, workspace_id)

        analysis_manager.clear_current_result("concordance")

    return {"state": "successful", "cleared": ["concordance"]}


@router.post("/{workspace_id}/concordance/cache/clear")
async def clear_concordance_cache(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    # Cache is removed, so this is a no-op or alias to clear results
    return await clear_concordance_results(workspace_id, current_user)
    # Cache is removed, so this is a no-op or alias to clear results
    return await clear_concordance_results(workspace_id, current_user)


@router.post("/{workspace_id}/concordance/multi-node/clear")
async def clear_multi_concordance_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    from ....core.analysis_admin import clear_analyses_and_cache

    summary = await clear_analyses_and_cache(
        user_id, workspace_id, task="multi_concordance"
    )
    return {"state": "successful", "cleared": summary}


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
            # Compute concordance directly (no caching)
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
