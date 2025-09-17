"""
Centralized in-process task registry for LDaCA Web App backend.
Tracks per-user per-workspace analysis tasks with status and progress.

Status values: 'running' | 'successful' | 'failed' | 'cancelled'
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple

# Keyed by (user_id, workspace_id) -> { task_id: Task }
_TASKS: Dict[Tuple[str, str], Dict[str, "Task"]] = {}
# Mapping (user_id, workspace_id, task_id) -> asyncio.Task handle
_TASK_HANDLES: Dict[Tuple[str, str, str], asyncio.Task] = {}


@dataclass
class Task:
    task_id: str
    task_type: str  # e.g. 'topic_modeling', 'token_frequencies', etc.
    user_id: str
    workspace_id: str
    status: str  # 'running' | 'successful' | 'failed' | 'cancelled'
    message: str = ""
    progress: int = 0  # 0..100
    created_at: float = 0.0
    updated_at: float = 0.0
    metadata: Dict[str, Any] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # Convert timestamps to ISO-ish floats for simplicity
        return d


def _now_ts() -> float:
    return time.time()


def create_task(user_id: str, workspace_id: str, task_type: str, message: str = "", metadata: Optional[Dict[str, Any]] = None) -> Task:
    key = (user_id, workspace_id)
    if key not in _TASKS:
        _TASKS[key] = {}
    task_id = str(uuid.uuid4())
    t = Task(
        task_id=task_id,
        task_type=task_type,
        user_id=user_id,
        workspace_id=workspace_id,
        status="running",
        message=message or f"Task {task_type} started",
        progress=0,
        created_at=_now_ts(),
        updated_at=_now_ts(),
        metadata=metadata or {},
    )
    _TASKS[key][task_id] = t
    return t


def attach_handle(user_id: str, workspace_id: str, task_id: str, handle: asyncio.Task) -> None:
    _TASK_HANDLES[(user_id, workspace_id, task_id)] = handle


def set_task_status(user_id: str, workspace_id: str, task_id: str, status: str, *, progress: Optional[int] = None, message: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> Optional[Task]:
    key = (user_id, workspace_id)
    tasks = _TASKS.get(key)
    if not tasks:
        return None
    t = tasks.get(task_id)
    if not t:
        return None
    t.status = status
    if progress is not None:
        t.progress = max(0, min(100, progress))
    if message is not None:
        t.message = message
    if metadata is not None:
        # Merge metadata shallowly
        try:
            merged = dict(t.metadata or {})
            merged.update(metadata)
            t.metadata = merged
        except Exception:
            t.metadata = metadata
    t.updated_at = _now_ts()
    return t


def list_tasks(user_id: str, workspace_id: str) -> List[Dict[str, Any]]:
    key = (user_id, workspace_id)
    tasks = _TASKS.get(key, {})
    return [t.to_dict() for t in tasks.values()]


def cancel_task(user_id: str, workspace_id: str, task_id: str) -> bool:
    """Attempt to cancel a task; returns True if cancellation was initiated."""
    key = (user_id, workspace_id, task_id)
    handle = _TASK_HANDLES.get(key)
    if handle and not handle.done():
        handle.cancel()
        set_task_status(user_id, workspace_id, task_id, "cancelled", message="Task cancelled by user")
        return True
    # If no handle, we can still mark as cancelled
    set_task_status(user_id, workspace_id, task_id, "cancelled", message="Task cancelled (no handle)")
    return False


def cancel_tasks(user_id: str, workspace_id: str, *, task_type: Optional[str] = None) -> int:
    """Cancel all running tasks for the given workspace (optionally filtered by task_type). Returns number of tasks affected."""
    key = (user_id, workspace_id)
    tasks = _TASKS.get(key, {})
    count = 0
    for tid, t in list(tasks.items()):
        if task_type and t.task_type != task_type:
            continue
        # Only cancel running tasks
        if t.status == "running":
            cancel_task(user_id, workspace_id, tid)
            count += 1
    return count

