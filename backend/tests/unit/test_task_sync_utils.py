from types import SimpleNamespace

import pytest
from ldaca_web_app_backend.analysis.models import (
    AnalysisStatus,
    AnalysisTask,
    BaseAnalysisRequest,
)
from ldaca_web_app_backend.api.workspaces.utils import ensure_task_synced
from ldaca_web_app_backend.core.workspace import workspace_manager


class _DummyRequest(BaseAnalysisRequest):
    pass


class _MemoryTaskManager:
    def __init__(self, task: AnalysisTask):
        self._task = task
        self.saved = False

    def get_task(self, task_id: str):
        if task_id != self._task.task_id:
            return None
        return self._task

    def save_task(self, task: AnalysisTask):
        self._task = task
        self.saved = True


@pytest.mark.anyio
async def test_ensure_task_synced_updates_pending_task_on_worker_success(monkeypatch):
    task = AnalysisTask[
        _DummyRequest,
        object,
    ](
        task_id="task-123",
        user_id="user-1",
        workspace_id="ws-1",
        request=_DummyRequest(),
        status=AnalysisStatus.PENDING,
    )
    memory_task_manager = _MemoryTaskManager(task)

    worker_task = SimpleNamespace(status="successful", result={"state": "successful"})

    class _WorkerTaskManager:
        async def get_task(self, _task_id: str):
            return worker_task

    monkeypatch.setattr(
        workspace_manager,
        "get_task_manager",
        lambda _user_id: _WorkerTaskManager(),
    )

    synced = await ensure_task_synced(
        "user-1",
        "ws-1",
        "task-123",
        memory_task_manager,
    )

    assert synced is not None
    assert synced.status == AnalysisStatus.COMPLETED
    assert synced.result is not None
    assert memory_task_manager.saved is True


@pytest.mark.anyio
async def test_ensure_task_synced_updates_pending_task_on_worker_failure(monkeypatch):
    task = AnalysisTask[
        _DummyRequest,
        object,
    ](
        task_id="task-456",
        user_id="user-1",
        workspace_id="ws-1",
        request=_DummyRequest(),
        status=AnalysisStatus.PENDING,
    )
    memory_task_manager = _MemoryTaskManager(task)

    worker_task = SimpleNamespace(status="failed", error="boom")

    class _WorkerTaskManager:
        async def get_task(self, _task_id: str):
            return worker_task

    monkeypatch.setattr(
        workspace_manager,
        "get_task_manager",
        lambda _user_id: _WorkerTaskManager(),
    )

    synced = await ensure_task_synced(
        "user-1",
        "ws-1",
        "task-456",
        memory_task_manager,
    )

    assert synced is not None
    assert synced.status == AnalysisStatus.FAILED
    assert synced.error == "boom"
    assert memory_task_manager.saved is True
