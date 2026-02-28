"""Analysis storage manager.

Provides per-user in-memory storage for analysis task records.  Each
``AnalysisTask`` tracks the ``workspace_id`` it was created for, so
tasks can be bulk-cleared when a workspace is unloaded.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel

from .models import AnalysisStatus, AnalysisTask, BaseAnalysisRequest

# In-memory storage: user_id -> TaskManagerStore
_TASK_MANAGER_STORE: Dict[str, TaskManagerStore] = {}


class TaskManagerStore:
    """Per-user in-memory storage for analysis task records."""

    def __init__(self) -> None:
        self.tasks: Dict[str, AnalysisTask] = {}
        self.current_task_ids: Dict[str, str] = {}

    def get_task(self, task_id: str) -> Optional[AnalysisTask]:
        return self.tasks.get(task_id)

    def save_task(self, task: AnalysisTask) -> None:
        self.tasks[task.task_id] = task

    def get_all_tasks(self) -> List[AnalysisTask]:
        return list(self.tasks.values())

    def set_current_task(self, tab: str, task_id: str) -> None:
        self.current_task_ids[tab] = task_id

    def get_current_task_ids(self, tab: str) -> List[str]:
        task_id = self.current_task_ids.get(tab)
        return [task_id] if task_id else []

    def clear_task(self, task_id: str) -> None:
        if task_id in self.tasks:
            del self.tasks[task_id]
        for tab, current_id in list(self.current_task_ids.items()):
            if current_id == task_id:
                del self.current_task_ids[tab]

    def clear_all(self) -> List[str]:
        ids = list(self.tasks.keys())
        self.tasks.clear()
        self.current_task_ids.clear()
        return ids

    def clear_workspace(self, workspace_id: str) -> List[str]:
        """Remove all tasks belonging to *workspace_id* and return their IDs."""
        to_remove = [
            tid for tid, task in self.tasks.items() if task.workspace_id == workspace_id
        ]
        for tid in to_remove:
            self.clear_task(tid)
        return to_remove


class TaskManager:
    """Per-user task storage keyed by task_id with per-tab current mapping."""

    def __init__(self, user_id: str) -> None:
        self.user_id = user_id
        if user_id not in _TASK_MANAGER_STORE:
            _TASK_MANAGER_STORE[user_id] = TaskManagerStore()
        self.store = _TASK_MANAGER_STORE[user_id]

    def create_task(
        self,
        request: BaseModel | dict | BaseAnalysisRequest,
    ) -> str:
        """Create and store a new pending analysis task.

        The current workspace is resolved automatically from
        ``workspace_manager`` so callers don't need to pass it.
        """
        from ..core.workspace import workspace_manager

        workspace_id = workspace_manager.get_current_workspace_id(self.user_id) or ""
        task_id = str(uuid4())
        normalized_request = self._normalize_request(request)
        task = AnalysisTask(
            task_id=task_id,
            user_id=self.user_id,
            workspace_id=workspace_id,
            request=normalized_request,
            status=AnalysisStatus.PENDING,
        )
        self.store.save_task(task)
        return task_id

    def get_task(self, task_id: str) -> Optional[AnalysisTask]:
        return self.store.get_task(task_id)

    def save_task(self, task: AnalysisTask) -> None:
        self.store.save_task(task)

    def set_current_task(self, tab: str, task_id: str) -> None:
        self.store.set_current_task(tab, task_id)

    def get_current_task_ids(self, tab: str) -> List[str]:
        return self.store.get_current_task_ids(tab)

    def update_task(self, task_id: str, result: Any) -> None:
        task = self.store.get_task(task_id)
        if task is None:
            return
        task.result = result
        task.status = AnalysisStatus.COMPLETED
        task.updated_at = datetime.now()
        self.store.save_task(task)

    def clear_task(self, task_id: str) -> None:
        self.store.clear_task(task_id)

    def clear_all(self) -> List[str]:
        return self.store.clear_all()

    def clear_workspace(self, workspace_id: str) -> List[str]:
        """Clear all tasks belonging to *workspace_id*."""
        return self.store.clear_workspace(workspace_id)

    def get_all_tasks(self) -> List[AnalysisTask]:
        return self.store.get_all_tasks()

    def _normalize_request(
        self, request: BaseModel | dict | BaseAnalysisRequest
    ) -> BaseModel:
        if isinstance(request, BaseModel):
            return request
        return BaseAnalysisRequest.model_validate(request)


def get_task_manager(user_id: str) -> TaskManager:
    """Return the analysis task manager for a user.

    A single user can only have one workspace loaded at a time, so the
    manager is keyed by *user_id* only.  Individual tasks track their
    ``workspace_id`` internally.
    """
    return TaskManager(user_id)
