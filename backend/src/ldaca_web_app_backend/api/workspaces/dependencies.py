"""Shared FastAPI dependency helpers for workspace routes."""

from fastapi import Depends, HTTPException

from ..core.auth import get_current_user  # type: ignore
from ..core.workspace import workspace_manager  # type: ignore


def get_user_id(current_user: dict = Depends(get_current_user)) -> str:
    return current_user["id"]


def get_workspace_manager():  # pragma: no cover - thin accessor
    return workspace_manager


def get_task_manager(user_id: str, workspace_id: str):  # pragma: no cover
    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    if not tm:
        raise HTTPException(status_code=404, detail="Task manager unavailable")
    return tm
