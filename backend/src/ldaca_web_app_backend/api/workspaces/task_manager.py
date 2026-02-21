"""Task-id based analysis endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ...analysis.manager import get_task_manager
from ...core.auth import get_current_user
from .utils import ensure_task_synced

router = APIRouter(prefix="/workspaces", tags=["analysis-task-manager"])


@router.get("/{workspace_id}/{analysis}/current")
async def get_current_tasks(
    workspace_id: str,
    analysis: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, list[str]]:
    """Return current task ids registered for one analysis tab.

    Used by:
    - frontend analysis-result rehydration flows

    Why:
    - Lets clients resolve latest task id(s) before fetching request/result.
    """
    user_id = current_user["id"]
    manager = get_task_manager(user_id, workspace_id)
    return {"task_ids": manager.get_current_task_ids(analysis)}


@router.get("/{workspace_id}/tasks/{task_id}/request")
async def get_task_request(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """Return stored request payload for a task id.

    Used by:
    - frontend result panels that need original analysis parameters

    Why:
    - Preserves reproducibility and UI state reconstruction from saved tasks.
    """
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
    """Return stored task result, syncing with worker if still running."""
    user_id = current_user["id"]
    manager = get_task_manager(user_id, workspace_id)

    # Sync with worker if running using shared utility
    task = await ensure_task_synced(user_id, workspace_id, task_id, manager)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = task.result
    if result is None:
        return {"state": "pending", "metadata": {"task_id": task_id}}

    return result.to_json() if hasattr(result, "to_json") else result


@router.post("/{workspace_id}/tasks/{task_id}/clear")
async def clear_task(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, str]:
    """Clear one stored task record by id.

    Used by:
    - frontend cleanup controls for generic task-manager routes

    Why:
    - Removes stale in-memory task entries without deleting analysis artifacts.
    """
    user_id = current_user["id"]
    manager = get_task_manager(user_id, workspace_id)
    task = manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    manager.clear_task(task_id)
    return {"state": "successful", "message": "Task cleared"}


__all__ = ["router"]
