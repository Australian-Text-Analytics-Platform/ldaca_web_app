"""Task management endpoints for workspace operations.

Separated from base.py during modularization. Provides endpoints to:
- list tasks
- cancel tasks (single or all by type)
- clear task records (single or by type)
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from ...core.auth import get_current_user
from ...core.workspace import workspace_manager

router = APIRouter(prefix="/workspaces", tags=["workspace-tasks"])


@router.get("/tasks")
async def list_workspace_tasks(current_user: dict = Depends(get_current_user)):
    """List worker tasks for a workspace.

    Used by:
    - frontend task manager panel and polling views

    Why:
    - Exposes normalized task state for cancellation/clear operations.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise ValueError("No active workspace selected")
    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    data = await tm.list()
    return {
        "state": "successful",
        "data": data,
        "message": "Tasks retrieved successfully.",
    }


@router.post("/tasks/cancel")
async def cancel_workspace_tasks(
    task_type: Optional[str] = None,
    task_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Cancel workspace tasks by id or by optional type filter.

    Used by:
    - frontend task controls

    Why:
    - Supports both granular and bulk task interruption from one endpoint.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise ValueError("No active workspace selected")
    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    if task_id:
        ok = await tm.cancel_task(task_id)
        return {
            "state": "successful",
            "data": {"cancelled": ok},
            "message": "Task cancelled successfully.",
        }
    count = await tm.cancel_all(task_type=task_type)
    return {
        "state": "successful",
        "data": {"cancelled_count": count},
        "message": "All tasks cancelled successfully.",
    }


@router.post("/tasks/clear")
async def clear_workspace_tasks(
    task_type: Optional[str] = None,
    task_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Clear (remove) task records for this workspace. This only removes task tracking records, not analysis results.

        If task_id provided, clear only that task. Otherwise clear all completed tasks,
        optionally filtered by task_type.
    Analysis results are preserved and only task records are removed from memory.

        Used by:
        - frontend cleanup actions after completed/failed analyses

        Why:
        - Lets users reset task lists without deleting persisted analysis outputs.

        Refactor note:
        - Shares response schema with cancel endpoint; small response helper could
            reduce repeated payload construction.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise ValueError("No active workspace selected")
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    if task_id:
        cleared = await tm.clear_task(task_id)
        return {
            "state": "successful",
            "data": {"cleared_count": 1 if cleared else 0},
            "message": "Task cleared successfully.",
        }
    count = await tm.clear_tasks(
        task_type=task_type, user_id=user_id, workspace_id=workspace_id
    )
    return {
        "state": "successful",
        "data": {"cleared_count": count},
        "message": "All tasks cleared successfully.",
    }


__all__ = ["router"]
