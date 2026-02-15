"""Topic Modeling analysis endpoints (background-task based)."""

from __future__ import annotations

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.topic_modeling import (
    TopicModelingRequest as AnalysisTopicModelingRequest,
)
from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import TopicModelingRequest, TopicModelingResponse
from ..utils import ensure_task_synced, get_workspace_or_404

router = APIRouter(prefix="/workspaces", tags=["topic-modeling"])


@router.delete("/{workspace_id}/topic-modeling")
async def clear_topic_modeling_results(
    workspace_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    task_manager = get_task_manager(user_id, workspace_id)
    current_id = task_manager.get_current_task_ids("topic_modeling")
    if current_id:
        task_manager.clear_task(current_id[0])
    return {
        "state": "successful",
        "message": "Topic modeling analysis results have been cleared.",
    }


@router.post("/{workspace_id}/topic-modeling", response_model=TopicModelingResponse)
async def run_topic_modeling(
    workspace_id: str,
    request: TopicModelingRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )

    requested_node_columns = request.node_columns or {}

    node_columns: dict[str, str] = {}
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
        column_name = requested_node_columns.get(node_id)
        if not column_name:
            metadata = getattr(node, "metadata", {}) or {}
            if isinstance(metadata, dict):
                column_name = metadata.get("text_column")
            if not column_name:
                common_text_columns = [
                    col
                    for col in ["document", "text", "content", "body", "message"]
                    if col in available_columns
                ]
                if common_text_columns:
                    column_name = common_text_columns[0]

        if not column_name:
            raise HTTPException(
                status_code=400,
                detail=f"Could not determine text column for node {node_id}. Available columns: {available_columns}",
            )

        if column_name not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column_name}' not found in node {node_id}. Available columns: {available_columns}",
            )

        node_columns[node_id] = column_name

    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    # Match token-frequencies behavior: only short-circuit when the same analysis is
    # already running for this workspace/user.
    try:
        if await tm.any_running(
            task_type="topic_modeling", user_id=user_id, workspace_id=workspace_id
        ):
            latest = await tm.latest_by_type(
                "topic_modeling", user_id=user_id, workspace_id=workspace_id
            )
            return TopicModelingResponse(
                state="running",
                message="Topic Modeling analysis already running",
                data=None,
                metadata={"task_id": latest.id if latest else None},
            )
    except Exception:
        # Non-fatal: proceed to submit a new task.
        pass

    worker_task = await tm.submit_task(
        user_id=user_id,
        workspace_id=workspace_id,
        task_type="topic_modeling",
        task_args={
            "node_ids": request.node_ids,
            "node_columns": node_columns,
            "min_topic_size": request.min_topic_size,
            "use_ctfidf": request.use_ctfidf,
        },
        task_name="Topic Modeling",
    )

    analysis_tm = get_task_manager(user_id, workspace_id)
    analysis_request = AnalysisTopicModelingRequest(
        node_ids=request.node_ids,
        node_columns=node_columns,
        min_topic_size=request.min_topic_size,
        use_ctfidf=request.use_ctfidf,
    )
    analysis_tm.save_task(
        AnalysisTask(
            task_id=worker_task.id,
            user_id=user_id,
            workspace_id=workspace_id,
            request=analysis_request,
            status=AnalysisStatus.RUNNING,
        )
    )
    analysis_tm.set_current_task("topic_modeling", worker_task.id)

    return TopicModelingResponse(
        state="running",
        message="Topic Modeling analysis started",
        data=None,
        metadata={"task_id": worker_task.id},
    )


@router.get(
    "/{workspace_id}/topic-modeling/tasks/{task_id}/result",
    response_model=TopicModelingResponse,
)
async def topic_modeling_task_result(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    task = await ensure_task_synced(
        user_id, workspace_id, task_id, get_task_manager(user_id, workspace_id)
    )

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status == AnalysisStatus.RUNNING:
        return TopicModelingResponse(
            state="running",
            message="Topic Modeling analysis is running",
            data=None,
            metadata={"task_id": task_id},
        )

    if task.status == AnalysisStatus.FAILED:
        return TopicModelingResponse(
            state="failed",
            message=(task.error or "Topic Modeling analysis failed"),
            data=None,
            metadata={"task_id": task_id},
        )

    if task.status == AnalysisStatus.COMPLETED and task.result:
        payload = task.result.to_json()
        if not isinstance(payload, dict):
            payload = {}
        return TopicModelingResponse(
            state="successful",
            message="Topic Modeling analysis complete",
            data=payload,
            metadata={"task_id": task_id},
        )

    return TopicModelingResponse(
        state="failed",
        message="Topic Modeling analysis failed",
        data=None,
        metadata={"task_id": task_id},
    )
