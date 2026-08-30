"""Private fair scheduler for Workspace-owned Analysis execution."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
import uuid

from anyio.abc import TaskGroup

from .analysis_execution_types import (
    AnalysisExecutionControl,
    AnalysisExecutionKey,
    AnalysisSchedulingStopped,
)
from .fair_scheduler import FairSchedulerKernel


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
        self._cancel_running = cancel_running
        self._work_removed = work_removed
        self._kernel = FairSchedulerKernel[AnalysisExecutionKey, ScheduledAnalysis](
            name="Analysis",
            capacity=capacity,
            key=lambda item: item.key,
            user_id=lambda item: item.key.user_id,
            order_key=lambda item: (item.created_at, item.key.analysis_id),
            runner=runner,
            finished=self._finished,
        )

    def start(self, task_group: TaskGroup) -> None:
        """Start the sole dispatch loop in the runtime-owned task group."""

        self._kernel.start(task_group)

    async def enqueue(
        self,
        key: AnalysisExecutionKey,
        *,
        created_at: datetime,
        credential: str | None,
    ) -> None:
        """Add one already-durable queued Analysis to runtime scheduling."""

        item = ScheduledAnalysis(key, created_at, credential)
        try:
            await self._kernel.enqueue(item)
        except RuntimeError as exc:
            raise AnalysisSchedulingStopped(
                "Analysis scheduler is not accepting work"
            ) from exc

    async def cancel(self, key: AnalysisExecutionKey) -> None:
        """Remove queued work or signal the private runner for active work."""

        target = await self._kernel.cancel(key, key.user_id)
        if target == "queued":
            await self._work_removed(key)
            return
        if target == "running":
            await self._cancel_running(key)

    async def has_workspace_work(
        self, user_id: str, workspace_id: uuid.UUID
    ) -> bool:
        """Return whether one Workspace still owns queued or active execution."""

        if any(
            item.key.workspace_id == workspace_id
            for item in await self._kernel.pending_for(user_id)
        ):
            return True
        return any(
            key.user_id == user_id and key.workspace_id == workspace_id
            for key in await self._kernel.active_keys()
        )

    async def cancel_workspace(self, user_id: str, workspace_id: uuid.UUID) -> None:
        """Remove queued work and signal active work before Workspace deletion."""

        await self._kernel.remove_where(
            user_id,
            lambda item: item.key.workspace_id == workspace_id,
        )
        active = [
            key
            for key in await self._kernel.active_keys()
            if key.user_id == user_id and key.workspace_id == workspace_id
        ]
        for key in active:
            await self._cancel_running(key)

    async def stop_dispatch(self) -> list[ScheduledAnalysis]:
        """Reject new work and return queued resources for interruption commits."""

        return await self._kernel.stop_dispatch()

    async def active_keys(self) -> set[AnalysisExecutionKey]:
        return await self._kernel.active_keys()

    async def has_work(self) -> bool:
        """Return whether queued or running Analysis execution still exists."""

        return await self._kernel.has_work()

    async def wait_idle(self) -> None:
        """Wait until every selected runner has left its capacity slot."""

        await self._kernel.wait_idle()

    async def _finished(self, item: ScheduledAnalysis) -> None:
        await self._work_removed(item.key)


__all__ = ["AnalysisScheduler", "ScheduledAnalysis"]
