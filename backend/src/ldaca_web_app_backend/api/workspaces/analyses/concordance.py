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
    normalize_saved_request,
)
from .text_column_prefs import resolve_text_columns_for_nodes

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
    sort_order: Optional[str] = None
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
    """Run concordance immediately and store task metadata for retrieval.

    Used by:
    - Frontend run route: `POST /workspaces/{id}/concordance`

    Why:
    - Keeps API behavior aligned with other analyses by returning task-linked
        responses while using shared concordance response builders.
    """
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    task_manager = get_task_manager(user_id, workspace_id)

    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )

    validated_columns = resolve_text_columns_for_nodes(
        user_id=user_id,
        workspace_id=workspace_id,
        node_ids=request.node_ids,
        requested_node_columns=request.node_columns or {},
        persist_preference=True,
    )

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
            normalize_saved_request(analysis_request.model_dump()) or {}
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
    task_manager = get_task_manager(user_id, workspace_id)

    task = task_manager.get_task(task_id)
    if not task or not task.request:
        return None

    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    normalized_request = normalize_saved_request(req_dict) or {}
    _apply_result_query_overrides(normalized_request, query)
    return build_concordance_response(user_id, workspace_id, normalized_request)


@router.post("/{workspace_id}/concordance/tasks/{task_id}/result")
async def concordance_task_result_post(
    workspace_id: str,
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
    normalized_request = normalize_saved_request(req_dict) or {}
    _apply_result_query_overrides(normalized_request, query)
    return build_concordance_response(user_id, workspace_id, normalized_request)


@router.post("/{workspace_id}/nodes/{node_id}/concordance/detach")
async def detach_concordance(
    workspace_id: str,
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
