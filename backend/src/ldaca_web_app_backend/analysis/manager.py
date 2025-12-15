"""Analysis storage manager."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from .models import AnalysisStatus, AnalysisTask, BaseAnalysisRequest

# In-memory storage: (user_id, workspace_id) -> WorkspaceAnalysisStore
# Structure:
# _STORE[workspace_key] = WorkspaceAnalysisStore


class WorkspaceAnalysisStore:
    def __init__(self):
        # task_id -> Task
        self.tasks: Dict[str, AnalysisTask] = {}
        # analysis_type -> current_task_id
        self.current_tasks: Dict[str, str] = {}

    def get_task(self, task_id: str) -> Optional[AnalysisTask]:
        return self.tasks.get(task_id)

    def save_task(self, task: AnalysisTask) -> None:
        self.tasks[task.task_id] = task
        # Also update current task pointer
        self.current_tasks[task.analysis_type] = task.task_id

    def get_current_task_id(self, analysis_type: str) -> Optional[str]:
        return self.current_tasks.get(analysis_type)

    def clear_current_task(self, analysis_type: str) -> None:
        if analysis_type in self.current_tasks:
            task_id = self.current_tasks[analysis_type]
            del self.current_tasks[analysis_type]
            # Optionally delete the task itself?
            # For now, we keep history in self.tasks unless explicitly deleted.
            # But to match "clear" semantics, we probably want to remove it.
            if task_id in self.tasks:
                del self.tasks[task_id]

    def get_all_tasks(self) -> List[AnalysisTask]:
        return list(self.tasks.values())


_GLOBAL_STORE: Dict[Tuple[str, str], WorkspaceAnalysisStore] = {}


class AnalysisManager:
    """Manager for accessing analysis storage."""

    def __init__(self, user_id: str, workspace_id: str):
        self.user_id = user_id
        self.workspace_id = workspace_id
        self.key = (user_id, workspace_id)
        if self.key not in _GLOBAL_STORE:
            _GLOBAL_STORE[self.key] = WorkspaceAnalysisStore()
        self.store = _GLOBAL_STORE[self.key]

    def create_task(
        self, analysis_type: str, request: BaseAnalysisRequest
    ) -> AnalysisTask:
        """Create and save a new analysis task."""
        task_id = getattr(request, "task_id", str(uuid4()))
        task = AnalysisTask(
            task_id=task_id,
            analysis_type=analysis_type,
            user_id=self.user_id,
            workspace_id=self.workspace_id,
            request=request,
            status=AnalysisStatus.PENDING,
        )
        self.store.save_task(task)
        return task

    def get_task(self, task_id: str) -> Optional[AnalysisTask]:
        return self.store.get_task(task_id)

    def get_current_task(self, analysis_type: str) -> Optional[AnalysisTask]:
        task_id = self.store.get_current_task_id(analysis_type)
        if task_id:
            return self.get_task(task_id)
        return None

    def update_task(self, task: AnalysisTask) -> None:
        self.store.save_task(task)

    def delete_task(self, analysis_type: str) -> Optional[str]:
        """Clear the current task for a given analysis type."""
        task_id = self.store.get_current_task_id(analysis_type)
        self.store.clear_current_task(analysis_type)
        return task_id

    def clear_all(self) -> List[str]:
        """Clear all analysis data for this workspace."""
        ids = []
        if self.key in _GLOBAL_STORE:
            ids = list(_GLOBAL_STORE[self.key].tasks.keys())
            del _GLOBAL_STORE[self.key]
            # Re-initialize empty store
            _GLOBAL_STORE[self.key] = WorkspaceAnalysisStore()
        return ids

    def get_all_tasks(self) -> List[AnalysisTask]:
        return self.store.get_all_tasks()


def get_analysis_manager(user_id: str, workspace_id: str) -> AnalysisManager:
    return AnalysisManager(user_id, workspace_id)
