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
from ....models import ConcordanceAnalysisRequest, ConcordanceDetachRequest
from ..utils import get_workspace_or_404
from .concordance_core import (
    DEFAULT_CONCORDANCE_PAGE,
    DEFAULT_CONCORDANCE_PAGE_SIZE,
    build_concordance_response,
    concordance_non_empty_expr,
    normalize_saved_request,
    sanitize_request_for_storage,
)

_concordance_non_empty_expr = concordance_non_empty_expr
_normalize_saved_request = normalize_saved_request
_sanitize_request_for_storage = sanitize_request_for_storage

router = APIRouter(prefix="/workspaces", tags=["concordance"])


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
    normalized_request: dict[str, Any],
    query: ConcordanceResultQuery,
) -> dict[str, Any]:
    """Apply pagination/sorting overrides from ConcordanceResultQuery."""
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


@router.post("/{workspace_id}/concordance")
async def run_concordance(
    workspace_id: str,
    request: ConcordanceAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    task_manager = get_task_manager(user_id, workspace_id)

    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )

    validated_columns: dict[str, str] = {}
    node_columns = request.node_columns or {}

    for node_id in request.node_ids:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

        node_data = getattr(node, "data", None)
        if not isinstance(node_data, pl.LazyFrame):
            raise HTTPException(
                status_code=400,
                detail=f"Node {node_id} data must be a LazyFrame",
            )
        available_columns = list(node_data.collect_schema().names())

        column_name = node_columns.get(node_id)
        if not column_name:
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

        response = build_concordance_response(
            user_id,
            workspace_id,
            normalized_request,
        )
        response["metadata"] = {"task_id": task_id}
        return response
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to run concordance: {exc}")


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
    if not task or not task.request:
        return None

    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    normalized_request = _normalize_saved_request(req_dict) or {}
    _apply_result_query_overrides(normalized_request, query)
    return build_concordance_response(user_id, workspace_id, normalized_request)


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
    return build_concordance_response(user_id, workspace_id, normalized_request)


@router.post("/{workspace_id}/nodes/{node_id}/concordance/detach")
async def detach_concordance(
    workspace_id: str,
    node_id: str,
    request: ConcordanceDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

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

    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Error submitting detach task: {exc}"
        )
