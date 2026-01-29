"""Task-id based analysis endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ...analysis.manager import get_task_manager
from ...core.auth import get_current_user

router = APIRouter(prefix="/workspaces", tags=["analysis-task-manager"])


@router.get("/{workspace_id}/{analysis}/current")
async def get_current_tasks(
    workspace_id: str,
    analysis: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, list[str]]:
    """Return the current task id(s) for an analysis tab."""
    user_id = current_user["id"]
    manager = get_task_manager(user_id, workspace_id)
    return {"task_ids": manager.get_current_task_ids(analysis)}


@router.get("/{workspace_id}/tasks/{task_id}/request")
async def get_task_request(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """Return the stored request for a task id."""
    user_id = current_user["id"]
    manager = get_task_manager(user_id, workspace_id)
    task = manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    request = task.request
    return request.model_dump() if hasattr(request, "model_dump") else request


@router.get("/{workspace_id}/tasks/{task_id}/result")
async def get_task_result(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """Return the stored result for a task id."""
    user_id = current_user["id"]
    manager = get_task_manager(user_id, workspace_id)
    task = manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    result = task.result
    if result is None:
        return {"state": "pending"}
    return result.to_json() if hasattr(result, "to_json") else result


@router.post("/{workspace_id}/tasks/{task_id}/clear")
async def clear_task(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, str]:
    """Clear a stored task by id."""
    user_id = current_user["id"]
    manager = get_task_manager(user_id, workspace_id)
    task = manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    manager.clear_task(task_id)
    return {"state": "successful", "message": "Task cleared"}


__all__ = ["router"]
