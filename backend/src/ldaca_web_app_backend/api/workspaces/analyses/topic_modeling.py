"""Topic modeling (BERTopic) analysis endpoints extracted from base.py.

Provides:
  - GET  /workspaces/{workspace_id}/topic-modeling/current-request
  - GET  /workspaces/{workspace_id}/topic-modeling/current-result
  - POST /workspaces/{workspace_id}/topic-modeling

Behavior preserved verbatim; only relocation for modular clarity.
"""

from __future__ import annotations

from typing import Dict

from fastapi import APIRouter, Depends, HTTPException

from docframe import DocDataFrame, DocLazyFrame

from ....analysis.implementations.topic_modeling import (
    TopicModelingRequest as AnalysisTopicModelingRequest,
)
from ....analysis.models import AnalysisStatus
from ....core.auth import get_current_user
from ....core.json_utils import json_sanitize
from ....core.workspace import workspace_manager
from ....models import TopicModelingRequest, TopicModelingResponse

router = APIRouter(prefix="/workspaces", tags=["topic-modeling"])


@router.get("/{workspace_id}/topic-modeling/current-request")
async def topic_modeling_current_request(
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

    task = analysis_manager.get_current_task("topic_modeling")
    if not task:
        return None

    req = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    return {
        "state": "successful",
        "message": "ok",
        "data": json_sanitize(req),
    }


@router.get("/{workspace_id}/topic-modeling/current-result")
async def topic_modeling_current_result(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Get current topic modeling result - read-only endpoint."""
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        return None

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    task = analysis_manager.get_current_task("topic_modeling")
    if not task:
        return None

    if task.result:
        result = task.result.to_json()
        if isinstance(result, dict) and "data" in result:
            return {
                "state": result.get("state", result.get("status", "successful")),
                "message": result.get("message", "ok"),
                "data": json_sanitize(result["data"]),
            }
        return {"state": "successful", "message": "ok", "data": json_sanitize(result)}

    # If task exists but no result, check status
    if task.status == AnalysisStatus.RUNNING:
        return {"state": "running", "message": "Task is still running", "data": None}
    if task.status == AnalysisStatus.FAILED:
        return {
            "state": "failed",
            "message": "Task failed",
            "data": None,
        }
    return {
        "state": "running",
        "message": "Task completed, result being processed",
        "data": None,
    }


@router.post("/{workspace_id}/topic-modeling/clear")
async def clear_topic_modeling_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Clear persisted topic modeling analyses for the workspace."""
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if ws:
        analysis_manager = getattr(ws, "analysis", None)
        if not analysis_manager:
            from ....analysis.manager import get_analysis_manager

            analysis_manager = get_analysis_manager(user_id, workspace_id)

        analysis_manager.clear_current_result("topic_modeling")

    return {"state": "successful", "cleared": ["topic_modeling"]}


@router.post(
    "/{workspace_id}/topic-modeling",
    response_model=TopicModelingResponse,
    summary="Run topic modeling (BERTopic) across one or two nodes",
    description="Starts a background topic modeling task over up to two nodes and returns a running task id.",
)
async def run_topic_modeling(
    workspace_id: str,
    request: TopicModelingRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )
    if len(request.node_ids) > 2:
        raise HTTPException(
            status_code=400, detail="Maximum of 2 nodes can be compared"
        )
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    existing_task = analysis_manager.get_current_task("topic_modeling")
    if existing_task:
        # Check if running
        if existing_task.status == AnalysisStatus.RUNNING:
            return {
                "state": "running",
                "message": "Topic modeling already running",
                "data": None,
                "metadata": {"task_id": existing_task.task_id},
            }

        # If completed, require clear
        raise HTTPException(
            status_code=409,
            detail="Clear current topic modeling results before starting a new run",
        )

    try:
        if await tm.any_running(
            task_type="topic_modeling", user_id=user_id, workspace_id=workspace_id
        ):
            latest = await tm.latest_by_type(
                "topic_modeling", user_id=user_id, workspace_id=workspace_id
            )
            return {
                "state": "running",
                "message": "Topic modeling already running",
                "data": None,
                "metadata": {"task_id": latest.id if latest else None},
            }
    except Exception:
        pass
    try:
        node_columns = request.node_columns or {}
        validated_columns: Dict[str, str] = {}
        for node_id in request.node_ids:
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
            node_data = getattr(node, "data", node)
            if hasattr(node_data, "columns"):
                available_columns = node_data.columns  # type: ignore[attr-defined]
            elif hasattr(node_data, "collect_schema"):
                available_columns = list(node_data.collect_schema().keys())  # type: ignore
            elif hasattr(node_data, "schema"):
                available_columns = list(node_data.schema.keys())  # type: ignore
            else:
                available_columns = []
            column_name = node_columns.get(node_id)
            if not column_name:
                if isinstance(node_data, (DocDataFrame, DocLazyFrame)):
                    doc_col = getattr(node_data, "document_column", None)
                    if doc_col:
                        column_name = doc_col
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
                    detail=f"Could not determine text column for node {node_id}. Available: {available_columns}",
                )
            if column_name not in available_columns:
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{column_name}' not in node {node_id}. Available: {available_columns}",
                )
            validated_columns[node_id] = column_name
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation error: {e}")
    try:
        task_info = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="topic_modeling",
            task_args={
                "node_ids": request.node_ids,
                "node_columns": validated_columns,
                "min_topic_size": request.min_topic_size or 5,
                "use_ctfidf": bool(request.use_ctfidf),
            },
        )

        # Create AnalysisTask
        analysis_request = AnalysisTopicModelingRequest(
            task_id=task_info.id,
            node_ids=request.node_ids,
            node_columns=validated_columns,
            min_topic_size=request.min_topic_size,
            use_ctfidf=request.use_ctfidf,
        )

        analysis_manager.create_task("topic_modeling", analysis_request)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to submit task: {e}")
    return {
        "state": "running",
        "message": "Topic modeling started",
        "data": None,
        "metadata": {"task_id": task_info.id},
    }


__all__ = ["router"]


__all__ = ["router"]

__all__ = ["router"]
