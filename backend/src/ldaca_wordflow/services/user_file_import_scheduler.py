"""Independent fair scheduler for retained User File Imports."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

import anyio
from anyio.abc import TaskGroup

from .fair_scheduler import CancellationTarget, FairSchedulerKernel
from .user_file_import_execution_types import (
    UserFileImportKey,
    UserFileImportSchedulingStopped,
)

@dataclass(frozen=True, slots=True)
class ScheduledUserFileImport:
    key: UserFileImportKey
    created_at: datetime


@dataclass(slots=True)
class _ActiveImport:
    scope: anyio.CancelScope | None = None
    cancellation_requested: bool = False


ImportRunner = Callable[[ScheduledUserFileImport], Awaitable[None]]


class UserFileImportScheduler:
    """Work-conserving import capacity with per-user round-robin selection."""

    def __init__(self, *, capacity: int, runner: ImportRunner) -> None:
        if capacity < 1:
            raise ValueError("User File Import capacity must be positive")
        self._runner = runner
        self._controls: dict[UserFileImportKey, _ActiveImport] = {}
        self._controls_lock = anyio.Lock()
        self._kernel = FairSchedulerKernel[
            UserFileImportKey, ScheduledUserFileImport
        ](
            name="User File Import",
            capacity=capacity,
            key=lambda item: item.key,
            user_id=lambda item: item.key.user_id,
            order_key=lambda item: (item.created_at, item.key.import_id),
            runner=self._run_import,
            finished=self._finished,
        )

    def start(self, task_group: TaskGroup) -> None:
        self._kernel.start(task_group)

    async def enqueue(
        self,
        key: UserFileImportKey,
        *,
        created_at: datetime,
    ) -> None:
        item = ScheduledUserFileImport(key, created_at)
        try:
            await self._kernel.enqueue(item)
        except RuntimeError as exc:
            raise UserFileImportSchedulingStopped(
                "User File Import scheduler is not accepting work"
            ) from exc

    async def cancel(self, key: UserFileImportKey) -> CancellationTarget:
        target = await self._kernel.cancel(key, key.user_id)
        if target == "running":
            await self._request_cancellation(key)
        return target

    async def stop_dispatch(self) -> list[ScheduledUserFileImport]:
        return await self._kernel.stop_dispatch()

    async def cancel_active(self) -> set[UserFileImportKey]:
        keys = await self._kernel.active_keys()
        for key in keys:
            await self._request_cancellation(key)
        return keys

    async def has_work(self) -> bool:
        """Return whether queued or running import execution still exists."""

        return await self._kernel.has_work()

    async def wait_idle(self) -> None:
        await self._kernel.wait_idle()

    async def _run_import(self, item: ScheduledUserFileImport) -> None:
        with anyio.CancelScope() as scope:
            async with self._controls_lock:
                control = self._controls.setdefault(item.key, _ActiveImport())
                control.scope = scope
                if control.cancellation_requested:
                    scope.cancel()
            await self._runner(item)

    async def _request_cancellation(self, key: UserFileImportKey) -> None:
        async with self._controls_lock:
            control = self._controls.setdefault(key, _ActiveImport())
            control.cancellation_requested = True
            if control.scope is not None:
                control.scope.cancel()

    async def _finished(self, item: ScheduledUserFileImport) -> None:
        async with self._controls_lock:
            self._controls.pop(item.key, None)


__all__ = ["ScheduledUserFileImport", "UserFileImportScheduler"]
