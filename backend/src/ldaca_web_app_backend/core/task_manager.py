from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional, List, Awaitable


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESSFUL = "successful"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TaskInfo:
    id: str
    task: asyncio.Task
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    status: TaskStatus = TaskStatus.PENDING
    result: Any = None
    error: Optional[str] = None
    progress: float = 0.0  # 0..1 for UI progress bars
    metadata: Dict[str, Any] = field(default_factory=dict)


class TaskManager:
    def __init__(self) -> None:
        self._tasks: Dict[str, TaskInfo] = {}
        self._lock = asyncio.Lock()

    async def add_task(self, coro: Awaitable[Any], *, task_type: str, name: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> TaskInfo:
        async def _runner():
            return await coro

        t = asyncio.create_task(_runner())
        task_id = str(uuid.uuid4())
        info = TaskInfo(
            id=task_id,
            task=t,
            status=TaskStatus.RUNNING,
            started_at=time.time(),
            metadata={"task_type": task_type, "name": name or task_type, **(metadata or {})},
        )
        async with self._lock:
            self._tasks[task_id] = info

        def _done_cb(_t: asyncio.Task):
            try:
                res = _t.result()
                info.result = res
                info.status = TaskStatus.SUCCESSFUL
                info.finished_at = time.time()
            except asyncio.CancelledError:
                info.status = TaskStatus.CANCELLED
                info.finished_at = time.time()
            except Exception as e:  # noqa: BLE001
                info.error = str(e)
                info.status = TaskStatus.FAILED
                info.finished_at = time.time()

        t.add_done_callback(_done_cb)
        return info

    async def cancel_task(self, task_id: str) -> bool:
        async with self._lock:
            info = self._tasks.get(task_id)
            if not info:
                return False
            if info.task.done():
                return False
            info.task.cancel()
            return True

    async def cancel_all(self, *, task_type: Optional[str] = None) -> int:
        count = 0
        async with self._lock:
            for ti in list(self._tasks.values()):
                if task_type and ti.metadata.get("task_type") != task_type:
                    continue
                if not ti.task.done():
                    ti.task.cancel()
                    count += 1
        return count

    async def list(self) -> List[Dict[str, Any]]:
        async with self._lock:
            out: List[Dict[str, Any]] = []
            for ti in self._tasks.values():
                d = {
                    "task_id": ti.id,
                    "status": ti.status.value,
                    "created_at": ti.created_at,
                    "started_at": ti.started_at,
                    "finished_at": ti.finished_at,
                    "progress": ti.progress,
                    "metadata": ti.metadata,
                    # Back-compat fields used by UI
                    "task_type": ti.metadata.get("task_type"),
                    "message": ti.error or ("Task running" if ti.status == TaskStatus.RUNNING else "Task finished"),
                }
                out.append(d)
            return out

    async def any_running(self, *, task_type: Optional[str] = None) -> bool:
        async with self._lock:
            for ti in self._tasks.values():
                if ti.status == TaskStatus.RUNNING and (task_type is None or ti.metadata.get("task_type") == task_type):
                    return True
            return False

    async def latest_by_type(self, task_type: str) -> Optional[TaskInfo]:
        async with self._lock:
            items = [ti for ti in self._tasks.values() if ti.metadata.get("task_type") == task_type]
            if not items:
                return None
            items.sort(key=lambda x: x.created_at, reverse=True)
            return items[0]

    async def clear_tasks(self, task_type: Optional[str] = None) -> int:
        """Clear and remove task records of the specified type (or all if None).
        Returns the number of tasks removed."""
        count = 0
        async with self._lock:
            task_ids_to_remove = []
            for task_id, ti in self._tasks.items():
                if task_type is None or ti.metadata.get("task_type") == task_type:
                    if not ti.task.done():
                        ti.task.cancel()
                    task_ids_to_remove.append(task_id)
            
            for task_id in task_ids_to_remove:
                del self._tasks[task_id]
                count += 1
        
        return count

