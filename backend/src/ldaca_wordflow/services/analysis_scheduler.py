"""Private fair scheduler for Workspace-owned Analysis execution."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

import anyio
from anyio.abc import TaskGroup

from .analysis_execution_types import (
    AnalysisExecutionControl,
    AnalysisExecutionKey,
    AnalysisSchedulingStopped,
)
from .fair_queue import FairUserQueue

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ScheduledAnalysis:
    key: AnalysisExecutionKey
    created_at: datetime
    credential: str | None


AnalysisRunner = Callable[[ScheduledAnalysis], Awaitable[None]]
RunningCancellation = Callable[[AnalysisExecutionKey], Awaitable[None]]
WorkRemoved = Callable[[AnalysisExecutionKey], Awaitable[None]]


class AnalysisScheduler(AnalysisExecutionControl):
    """Work-conserving global capacity with per-user round-robin selection."""

    def __init__(
        self,
        *,
        capacity: int,
        runner: AnalysisRunner,
        cancel_running: RunningCancellation,
        work_removed: WorkRemoved,
    ) -> None:
        if capacity < 1:
            raise ValueError("Analysis execution capacity must be positive")
        self._capacity = capacity
        self._runner = runner
        self._cancel_running = cancel_running
        self._work_removed = work_removed
        self._pending = FairUserQueue[ScheduledAnalysis]()
        self._active: set[AnalysisExecutionKey] = set()
        self._lock = anyio.Lock()
        self._wake = anyio.Event()
        self._idle = anyio.Event()
        self._idle.set()
        self._task_group: TaskGroup | None = None
        self._accepting = True
        self._stopping = False

    def start(self, task_group: TaskGroup) -> None:
        """Start the sole dispatch loop in the runtime-owned task group."""

        if self._task_group is not None:
            raise RuntimeError("Analysis scheduler already started")
        self._task_group = task_group
        task_group.start_soon(self._run)

    async def enqueue(
        self,
        key: AnalysisExecutionKey,
        *,
        created_at: datetime,
        credential: str | None,
    ) -> None:
        """Add one already-durable queued Analysis to runtime scheduling."""

        item = ScheduledAnalysis(key, created_at, credential)
        async with self._lock:
            if not self._accepting or self._task_group is None:
                raise AnalysisSchedulingStopped(
                    "Analysis scheduler is not accepting work"
                )
            if key in self._active or any(
                queued.key == key
                for queued in self._pending.values()
            ):
                raise ValueError("Analysis is already scheduled")
            self._pending.add(
                key.user_id,
                item,
                order_key=lambda queued: (
                    queued.created_at,
                    queued.key.analysis_id,
                ),
            )
            self._wake.set()

    async def cancel(self, key: AnalysisExecutionKey) -> None:
        """Remove queued work or signal the private runner for active work."""

        active = False
        removed = False
        async with self._lock:
            removed = bool(
                self._pending.remove(
                    key.user_id,
                    lambda item: item.key == key,
                )
            )
            if removed:
                self._wake.set()
            active = key in self._active
        if removed:
            await self._work_removed(key)
            return
        if active:
            await self._cancel_running(key)

    async def has_workspace_work(self, user_id: str, workspace_id: str) -> bool:
        """Return whether one Workspace still owns queued or active execution."""

        async with self._lock:
            if any(
                item.key.workspace_id == workspace_id
                for item in self._pending.items_for(user_id)
            ):
                return True
            return any(
                key.user_id == user_id and key.workspace_id == workspace_id
                for key in self._active
            )

    async def cancel_workspace(self, user_id: str, workspace_id: str) -> None:
        """Remove queued work and signal active work before Workspace deletion."""

        async with self._lock:
            queued = [
                item
                for item in self._pending.items_for(user_id)
                if item.key.workspace_id == workspace_id
            ]
            for item in queued:
                self._pending.remove(
                    user_id,
                    lambda candidate, key=item.key: candidate.key == key,
                )
            active = [
                key
                for key in self._active
                if key.user_id == user_id and key.workspace_id == workspace_id
            ]
            if queued:
                self._wake.set()
        for key in active:
            await self._cancel_running(key)

    async def stop_dispatch(self) -> list[ScheduledAnalysis]:
        """Reject new work and return queued resources for interruption commits."""

        async with self._lock:
            if self._stopping:
                return []
            self._accepting = False
            self._stopping = True
            queued = self._pending.clear()
            self._wake.set()
            return queued

    async def active_keys(self) -> set[AnalysisExecutionKey]:
        async with self._lock:
            return set(self._active)

    async def has_work(self) -> bool:
        """Return whether queued or running Analysis execution still exists."""

        async with self._lock:
            return bool(self._pending or self._active)

    async def wait_idle(self) -> None:
        """Wait until every selected runner has left its capacity slot."""

        while True:
            async with self._lock:
                if not self._active:
                    return
                idle = self._idle
            await idle.wait()

    async def _run(self) -> None:
        while True:
            async with self._lock:
                if self._stopping:
                    return
                if self._pending and len(self._active) < self._capacity:
                    item = self._pending.pop()
                    if not self._active:
                        self._idle = anyio.Event()
                    self._active.add(item.key)
                    assert self._task_group is not None
                    self._task_group.start_soon(self._run_one, item)
                    continue
                wake = self._wake
            await wake.wait()
            async with self._lock:
                if self._wake is wake:
                    self._wake = anyio.Event()

    async def _run_one(self, item: ScheduledAnalysis) -> None:
        try:
            await self._runner(item)
        except Exception:
            logger.exception(
                "Analysis runner escaped its resource boundary analysis_id=%s",
                item.key.analysis_id,
            )
        finally:
            with anyio.CancelScope(shield=True):
                async with self._lock:
                    self._active.discard(item.key)
                    if not self._active:
                        self._idle.set()
                    self._wake.set()
                await self._work_removed(item.key)


__all__ = ["AnalysisScheduler", "ScheduledAnalysis"]
