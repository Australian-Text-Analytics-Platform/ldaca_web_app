"""Independent fair scheduler for retained User File Imports."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import anyio
from anyio.abc import TaskGroup

from .fair_queue import FairUserQueue
from .user_file_import_execution_types import (
    UserFileImportKey,
    UserFileImportSchedulingStopped,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ScheduledUserFileImport:
    key: UserFileImportKey
    created_at: datetime


@dataclass(slots=True)
class _ActiveImport:
    scope: anyio.CancelScope | None = None
    cancellation_requested: bool = False


ImportRunner = Callable[[ScheduledUserFileImport], Awaitable[None]]
CancellationTarget = Literal["queued", "running", "missing"]


class UserFileImportScheduler:
    """Work-conserving import capacity with per-user round-robin selection."""

    def __init__(self, *, capacity: int, runner: ImportRunner) -> None:
        if capacity < 1:
            raise ValueError("User File Import capacity must be positive")
        self._capacity = capacity
        self._runner = runner
        self._pending = FairUserQueue[ScheduledUserFileImport]()
        self._active: dict[UserFileImportKey, _ActiveImport] = {}
        self._lock = anyio.Lock()
        self._wake = anyio.Event()
        self._idle = anyio.Event()
        self._idle.set()
        self._task_group: TaskGroup | None = None
        self._accepting = True
        self._stopping = False

    def start(self, task_group: TaskGroup) -> None:
        if self._task_group is not None:
            raise RuntimeError("User File Import scheduler already started")
        self._task_group = task_group
        task_group.start_soon(self._run)

    async def enqueue(
        self,
        key: UserFileImportKey,
        *,
        created_at: datetime,
    ) -> None:
        item = ScheduledUserFileImport(key, created_at)
        async with self._lock:
            if not self._accepting or self._task_group is None:
                raise UserFileImportSchedulingStopped(
                    "User File Import scheduler is not accepting work"
                )
            if key in self._active or any(
                queued.key == key for queued in self._pending.values()
            ):
                raise ValueError("User File Import is already scheduled")
            self._pending.add(
                key.user_id,
                item,
                order_key=lambda queued: (
                    queued.created_at,
                    queued.key.import_id,
                ),
            )
            self._wake.set()

    async def cancel(self, key: UserFileImportKey) -> CancellationTarget:
        async with self._lock:
            removed = self._pending.remove(
                key.user_id,
                lambda item: item.key == key,
            )
            if removed:
                self._wake.set()
                return "queued"
            active = self._active.get(key)
            if active is None:
                return "missing"
            active.cancellation_requested = True
            if active.scope is not None:
                active.scope.cancel()
            return "running"

    async def stop_dispatch(self) -> list[ScheduledUserFileImport]:
        async with self._lock:
            if self._stopping:
                return []
            self._accepting = False
            self._stopping = True
            queued = self._pending.clear()
            self._wake.set()
            return queued

    async def cancel_active(self) -> set[UserFileImportKey]:
        async with self._lock:
            keys = set(self._active)
            for active in self._active.values():
                active.cancellation_requested = True
                if active.scope is not None:
                    active.scope.cancel()
            return keys

    async def has_work(self) -> bool:
        """Return whether queued or running import execution still exists."""

        async with self._lock:
            return bool(self._pending or self._active)

    async def wait_idle(self) -> None:
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
                    self._active[item.key] = _ActiveImport()
                    assert self._task_group is not None
                    self._task_group.start_soon(self._run_one, item)
                    continue
                wake = self._wake
            await wake.wait()
            async with self._lock:
                if self._wake is wake:
                    self._wake = anyio.Event()

    async def _run_one(self, item: ScheduledUserFileImport) -> None:
        try:
            with anyio.CancelScope() as scope:
                async with self._lock:
                    active = self._active[item.key]
                    active.scope = scope
                    if active.cancellation_requested:
                        scope.cancel()
                await self._runner(item)
        except Exception:
            logger.exception(
                "User File Import runner escaped its resource boundary import_id=%s",
                item.key.import_id,
            )
        finally:
            with anyio.CancelScope(shield=True):
                async with self._lock:
                    self._active.pop(item.key, None)
                    if not self._active:
                        self._idle.set()
                    self._wake.set()


__all__ = ["ScheduledUserFileImport", "UserFileImportScheduler"]
