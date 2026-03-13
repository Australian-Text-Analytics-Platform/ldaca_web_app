"""Concordance analysis endpoints.

Includes:
    - POST /workspaces/{workspace_id}/concordance
    - GET  /workspaces/{workspace_id}/concordance/tasks/{task_id}/result
    - POST /workspaces/{workspace_id}/concordance/tasks/{task_id}/result
    - POST /workspaces/{workspace_id}/nodes/{node_id}/concordance/detach
"""

from __future__ import annotations

from typing import Any, Optional
from uuid import uuid4

import polars as pl
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import (
    ConcordanceAnalysisRequest,
    ConcordanceDetachNodeOption,
    ConcordanceDetachOptionsResponse,
    ConcordanceDetachRequest,
)
from .concordance_core import (
    CORE_CONCORDANCE_COLUMNS,
    DEFAULT_CONCORDANCE_PAGE,
    DEFAULT_CONCORDANCE_PAGE_SIZE,
    build_concordance_response,
    normalize_saved_request,
)
from .current_tasks import get_current_task_ids_for_analysis

router = APIRouter(prefix="/workspaces", tags=["concordance"])


class ConcordanceResultQuery(BaseModel):
    """Query overrides for reading persisted concordance results.

    Used by:
    - `concordance_task_result`
    - `concordance_task_result_post`

    Why:
    - Allows pagination and sorting updates without recomputing concordance.
    """

    node_id: Optional[str] = None
    combined: Optional[bool] = None
    page: Optional[int] = None
    page_number: Optional[int] = None
    page_size: Optional[int] = None
    sort_by: Optional[str] = None
    descending: Optional[bool] = None
    show_metadata: Optional[bool] = None
    update_only: bool = False


def _apply_result_query_overrides(
    normalized_request: dict[str, Any],
    query: ConcordanceResultQuery,
) -> dict[str, Any]:
    """Apply request overrides from query parameters.

    Used by:
    - `concordance_task_result`
    - `concordance_task_result_post`

    Why:
    - Reuses one normalization path for GET and POST result retrieval APIs.
    """
    page = query.page_number if query.page_number is not None else query.page
    if page is not None:
        normalized_request["page"] = page
    if query.page_size is not None:
        normalized_request["page_size"] = query.page_size
    if query.sort_by is not None:
        normalized_request["sort_by"] = query.sort_by
    if query.descending is not None:
        normalized_request["descending"] = query.descending
    if query.combined is not None:
        if query.combined:
            normalized_request["combined"] = True
        else:
            normalized_request.pop("combined", None)
    return normalized_request


@router.post("/concordance")
async def run_concordance(
    request: ConcordanceAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run concordance immediately and store task metadata for retrieval.

    Used by:
    - Frontend run route: `POST /workspaces/{id}/concordance`

    Why:
    - Keeps API behavior aligned with other analyses by returning task-linked
        responses while using shared concordance response builders.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task_manager = get_task_manager(user_id)

    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )

    for nid in request.node_ids:
        if nid not in request.node_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Missing text column selection for node {nid}",
            )

    try:
        from ....analysis.implementations.concordance import ConcordanceRequest

        analysis_request = ConcordanceRequest(
            node_ids=request.node_ids,
            node_columns=request.node_columns,
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
            normalize_saved_request(analysis_request.model_dump()) or {}
        )
        normalized_request.setdefault("page", DEFAULT_CONCORDANCE_PAGE)
        normalized_request.setdefault("page_size", DEFAULT_CONCORDANCE_PAGE_SIZE)
        if request.sort_by:
            normalized_request["sort_by"] = request.sort_by
        normalized_request["descending"] = request.descending
        if request.combined:
            normalized_request["combined"] = True

        response = build_concordance_response(
            user_id,
            workspace_id,
            normalized_request,
        )
        response["metadata"] = {"task_id": task_id}
        return response
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to run concordance: {exc}")


@router.get("/concordance/tasks/current")
async def concordance_current_tasks(
    current_user: dict = Depends(get_current_user),
):
    """Return current task IDs for concordance analysis."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    return await get_current_task_ids_for_analysis(
        user_id,
        workspace_id,
        ["concordance_analysis", "concordance-analysis", "concordance"],
    )


@router.get("/concordance/tasks/{task_id}/request")
async def concordance_task_request(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return stored request payload for a concordance task."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    request = task.request
    return request.model_dump()


@router.get("/concordance/tasks/{task_id}/result")
async def concordance_task_result(
    task_id: str,
    query: ConcordanceResultQuery = Depends(),
    current_user: dict = Depends(get_current_user),
):
    """Read concordance result with optional pagination/sort overrides.

    Used by:
    - Frontend polling route: `GET /workspaces/{id}/concordance/tasks/{id}/result`

    Why:
    - Hydrates saved concordance state while allowing query-time view changes.

        Refactor note:
        - Can likely be merged with `concordance_task_result_post` through a shared
            result-read helper that accepts normalized override input.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    task_manager = get_task_manager(user_id)

    task = task_manager.get_task(task_id)
    if not task or not task.request:
        return None

    req_dict = task.request.model_dump()
    normalized_request = normalize_saved_request(req_dict) or {}
    _apply_result_query_overrides(normalized_request, query)
    return build_concordance_response(user_id, workspace_id, normalized_request)


@router.post("/concordance/tasks/{task_id}/result")
async def concordance_task_result_post(
    task_id: str,
    query: ConcordanceResultQuery,
    current_user: dict = Depends(get_current_user),
):
    """Read concordance result using POST body overrides.

    Used by:
    - Frontend state-sync route:
        `POST /workspaces/{id}/concordance/tasks/{id}/result`

    Why:
    - Preserves compatibility with clients that send result preferences in body
        payloads instead of query parameters.

        Refactor note:
        - Mostly duplicates `concordance_task_result`; both routes could delegate to
            one internal helper and keep only transport-layer differences.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    task_manager = get_task_manager(user_id)
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

    req_dict = task.request.model_dump()
    normalized_request = normalize_saved_request(req_dict) or {}
    _apply_result_query_overrides(normalized_request, query)
    return build_concordance_response(user_id, workspace_id, normalized_request)


@router.post("/nodes/{node_id}/concordance/detach")
async def detach_concordance(
    node_id: str,
    request: ConcordanceDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    """Submit a background task to create a concordance-detached node.

    Used by:
    - Frontend detach action:
        `POST /workspaces/{id}/nodes/{node_id}/concordance/detach`

    Why:
    - Runs potentially expensive row extraction out-of-band and returns task id
        for progress tracking.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    tm = workspace_manager.get_task_manager(user_id)
    node = ws.nodes[node_id]

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(
            status_code=400, detail="Selected node data must be a LazyFrame"
        )

    if request.column not in node_data.collect_schema().names():
        raise HTTPException(
            status_code=400, detail=f"Column '{request.column}' not found"
        )

    schema_names = node_data.collect_schema().names()
    include_document_column = False
    columns_to_select: list[str] = []
    if request.selected_columns:
        for col in request.selected_columns:
            if col == request.column:
                include_document_column = True
                continue
            if col in schema_names:
                columns_to_select.append(col)

    corpus_df = (
        node_data
        .select([pl.col(request.column)] + [pl.col(c) for c in columns_to_select])
        .filter(
            pl
            .col(request.column)
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .str.len_chars()
            .fill_null(0)
            > 0
        )
        .collect()
    )
    node_corpus = [
        str(value) if value is not None else ""
        for value in corpus_df.get_column(request.column).to_list()
    ]

    extra_columns_data: dict[str, list] = {}
    for col in columns_to_select:
        if col != request.column:
            extra_columns_data[col] = corpus_df.get_column(col).to_list()

    workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
    if workspace_dir is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    try:
        task_info = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="concordance_detach",
            task_args={
                "workspace_dir": str(workspace_dir),
                "node_corpus": node_corpus,
                "parent_node_id": node_id,
                "document_column": request.column,
                "search_word": request.search_word,
                "num_left_tokens": request.num_left_tokens,
                "num_right_tokens": request.num_right_tokens,
                "regex": request.regex,
                "case_sensitive": request.case_sensitive,
                "new_node_name": request.new_node_name,
                "include_document_column": include_document_column,
                "extra_columns_data": extra_columns_data
                if extra_columns_data
                else None,
            },
        )

        return {
            "state": "running",
            "message": "Concordance detach started",
            "data": None,
            "metadata": {"task_id": task_info.id},
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Error submitting detach task: {exc}"
        )


@router.get(
    "/nodes/{node_id}/concordance/detach-options",
    response_model=ConcordanceDetachOptionsResponse,
)
async def concordance_detach_options(
    node_id: str,
    column: str,
    current_user: dict = Depends(get_current_user),
):
    """Return detachable concordance columns for one node.

    Used by:
    - Frontend concordance detach dialog

    Why:
    - Keeps mandatory generated concordance columns and optional metadata
      columns aligned with backend detach behavior.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = ws.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(
            status_code=400, detail="Selected node data must be a LazyFrame"
        )

    available_schema_columns = list(node_data.collect_schema().names())
    if column not in available_schema_columns:
        raise HTTPException(status_code=400, detail=f"Column '{column}' not found")

    mandatory_columns = list(CORE_CONCORDANCE_COLUMNS)
    mandatory_set = set(mandatory_columns)
    optional_columns = [
        col for col in [column, *available_schema_columns] if col not in mandatory_set
    ]
    ordered_available_columns = list(
        dict.fromkeys(mandatory_columns + optional_columns)
    )
    ordered_available_columns = [
        column,
        *[col for col in ordered_available_columns if col != column],
    ]
    node_option = ConcordanceDetachNodeOption(
        node_id=node_id,
        node_name=getattr(node, "name", None) or node_id,
        text_column=column,
        available_columns=ordered_available_columns,
        disabled_columns=mandatory_columns,
    )

    return ConcordanceDetachOptionsResponse(
        state="successful",
        message="Concordance detach options loaded",
        data={"nodes": [node_option]},
        metadata=None,
    )
