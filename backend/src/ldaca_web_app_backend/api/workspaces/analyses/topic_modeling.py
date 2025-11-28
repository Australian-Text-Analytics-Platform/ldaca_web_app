"""Topic modeling (BERTopic) analysis endpoints extracted from base.py.

Provides:
  - GET  /workspaces/{workspace_id}/topic-modeling/current-request
  - GET  /workspaces/{workspace_id}/topic-modeling/current-result
  - POST /workspaces/{workspace_id}/topic-modeling

Behavior preserved verbatim; only relocation for modular clarity.
"""

from __future__ import annotations

import asyncio
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException

from ....core.analysis_admin import clear_analyses_and_cache
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
    try:
        from ldaca_web_app_backend.core.analysis_store import get_latest_analysis
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = await asyncio.to_thread(
        get_latest_analysis, user_id, workspace_id, "topic_modeling"
    )
    if not rec:
        return None
    return {
        "state": "successful",
        "message": "ok",
        "data": json_sanitize(rec.request),
    }


@router.get("/{workspace_id}/topic-modeling/current-result")
async def topic_modeling_current_result(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Get current topic modeling result - read-only endpoint."""
    user_id = current_user["id"]
    try:
        from ldaca_web_app_backend.core.analysis_store import get_latest_analysis
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")

    rec = await asyncio.to_thread(
        get_latest_analysis, user_id, workspace_id, "topic_modeling"
    )
    if rec and getattr(rec, "result", None):
        result = rec.result
        if isinstance(result, dict) and "data" in result:
            return {
                "state": result.get("state", result.get("status", "successful")),
                "message": result.get("message", "ok"),
                "data": json_sanitize(result["data"]),
            }
        return {"state": "successful", "message": "ok", "data": json_sanitize(result)}

    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    latest = await tm.latest_by_type(
        "topic_modeling", user_id=user_id, workspace_id=workspace_id
    )
    if latest is None:
        return None
    status_val = (
        latest.status.value if hasattr(latest.status, "value") else str(latest.status)
    )
    if status_val == "running":
        return {"state": "running", "message": "Task is still running", "data": None}
    if status_val == "failed":
        return {
            "state": "failed",
            "message": latest.error or "Task failed",
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

    summary = await clear_analyses_and_cache(
        user_id, workspace_id, task="topic_modeling"
    )
    return {"state": "successful", "cleared": summary}


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
        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            raise HTTPException(
                status_code=404, detail=f"Workspace {workspace_id} not found"
            )
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
                try:
                    from docframe import DocDataFrame, DocLazyFrame  # type: ignore

                    if isinstance(node_data, (DocDataFrame, DocLazyFrame)) and getattr(
                        node_data, "document_column", None
                    ):
                        column_name = node_data.document_column  # type: ignore[attr-defined]
                    else:
                        common = [
                            c
                            for c in ["document", "text", "content", "body", "message"]
                            if c in available_columns
                        ]
                        if common:
                            column_name = common[0]
                except ImportError:
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
        try:  # persist request
            from ldaca_web_app_backend.core.analysis_store import save_analysis

            req_dict = (
                request.model_dump()
                if hasattr(request, "model_dump")
                else request.dict()
            )
            await asyncio.to_thread(
                save_analysis, user_id, workspace_id, "topic_modeling", req_dict, {}
            )
        except Exception as _e:  # pragma: no cover
            print(f"[analysis_persist] save running request failed: {_e}")
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
