"""Analysis storage manager."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from pydantic import BaseModel

from .models import AnalysisStatus, AnalysisTask, BaseAnalysisRequest

# In-memory storage: (user_id, workspace_id) -> TaskManagerStore
# Structure:
# _TASK_MANAGER_STORE[workspace_key] = TaskManagerStore


class TaskManagerStore:
    """Per-workspace in-memory storage for analysis task records.

    Used by:
    - `TaskManager`

    Why:
    - Keeps task persistence lightweight and scoped by `(user_id, workspace_id)`.
    """

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


_TASK_MANAGER_STORE: Dict[Tuple[str, str], TaskManagerStore] = {}


class TaskManager:
    """Task storage keyed by task_id with per-tab current mapping."""

    def __init__(self, user_id: str, workspace_id: str) -> None:
        self.user_id = user_id
        self.workspace_id = workspace_id
        self.key = (user_id, workspace_id)
        if self.key not in _TASK_MANAGER_STORE:
            _TASK_MANAGER_STORE[self.key] = TaskManagerStore()
        self.store = _TASK_MANAGER_STORE[self.key]

    def create_task(self, request: BaseModel | dict | BaseAnalysisRequest) -> str:
        """Create and store a new pending analysis task.

        Used by:
        - analysis route handlers before launching work

        Why:
        - Gives routes a stable task id and normalized request snapshot.
        """
        task_id = str(uuid4())
        normalized_request = self._normalize_request(request)
        task = AnalysisTask(
            task_id=task_id,
            user_id=self.user_id,
            workspace_id=self.workspace_id,
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

    def get_all_tasks(self) -> List[AnalysisTask]:
        return self.store.get_all_tasks()

    def _normalize_request(
        self, request: BaseModel | dict | BaseAnalysisRequest
    ) -> BaseModel:
        if isinstance(request, BaseModel):
            return request
        return BaseAnalysisRequest.model_validate(request)


def get_task_manager(user_id: str, workspace_id: str) -> TaskManager:
    """Return the analysis task manager for a user/workspace pair.

    Used by:
    - analysis API routes and worker result persistence paths

    Why:
    - Centralizes access to per-workspace in-memory analysis task storage.
    """
    return TaskManager(user_id, workspace_id)
