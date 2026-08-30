"""Private fair scheduling mechanics shared by independent durable resources."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Hashable
from typing import Literal

import anyio
from anyio.abc import TaskGroup

from .fair_queue import FairUserQueue

CancellationTarget = Literal["queued", "running", "missing"]


class FairSchedulerKernel[K: Hashable, WorkT]:
    """Own fair FIFO dispatch, capacity, wakeup, cancellation, and idleness."""

    def __init__(
        self,
        *,
        name: str,
        capacity: int,
        key: Callable[[WorkT], K],
        user_id: Callable[[WorkT], str],
        order_key: Callable[[WorkT], object],
        runner: Callable[[WorkT], Awaitable[None]],
        finished: Callable[[WorkT], Awaitable[None]] | None = None,
    ) -> None:
        if capacity < 1:
            raise ValueError(f"{name} capacity must be positive")
        self._name = name
        self._capacity = capacity
        self._key = key
        self._user_id = user_id
        self._order_key = order_key
        self._runner = runner
        self._finished = finished
        self._pending = FairUserQueue[WorkT]()
        self._active: dict[K, WorkT] = {}
        self._lock = anyio.Lock()
        self._wake = anyio.Event()
        self._idle = anyio.Event()
        self._idle.set()
        self._task_group: TaskGroup | None = None
        self._accepting = True
        self._stopping = False
        self._logger = logging.getLogger(__name__)

    def start(self, task_group: TaskGroup) -> None:
        if self._task_group is not None:
            raise RuntimeError(f"{self._name} scheduler already started")
        self._task_group = task_group
        task_group.start_soon(self._run)

    async def enqueue(self, item: WorkT) -> None:
        item_key = self._key(item)
        async with self._lock:
            if not self._accepting or self._task_group is None:
                raise RuntimeError(f"{self._name} scheduler is not accepting work")
            if item_key in self._active or any(
                self._key(queued) == item_key for queued in self._pending.values()
            ):
                raise ValueError(f"{self._name} is already scheduled")
            self._pending.add(
                self._user_id(item),
                item,
                order_key=self._order_key,
            )
            self._wake.set()

    async def cancel(self, key: K, user_id: str) -> CancellationTarget:
        """Remove queued work or identify one active cancellation target."""

        async with self._lock:
            removed = self._pending.remove(
                user_id,
                lambda item: self._key(item) == key,
            )
            if removed:
                self._wake.set()
                return "queued"
            return "running" if key in self._active else "missing"

    async def remove_where(
        self,
        user_id: str,
        predicate: Callable[[WorkT], bool],
    ) -> list[WorkT]:
        async with self._lock:
            removed = self._pending.remove(user_id, predicate)
            if removed:
                self._wake.set()
            return removed

    async def pending_for(self, user_id: str) -> tuple[WorkT, ...]:
        async with self._lock:
            return self._pending.items_for(user_id)

    async def active_keys(self) -> set[K]:
        async with self._lock:
            return set(self._active)

    async def stop_dispatch(self) -> list[WorkT]:
        async with self._lock:
            if self._stopping:
                return []
            self._accepting = False
            self._stopping = True
            queued = self._pending.clear()
            self._wake.set()
            return queued

    async def has_work(self) -> bool:
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
                    self._active[self._key(item)] = item
                    assert self._task_group is not None
                    self._task_group.start_soon(self._run_one, item)
                    continue
                wake = self._wake
            await wake.wait()
            async with self._lock:
                if self._wake is wake:
                    self._wake = anyio.Event()

    async def _run_one(self, item: WorkT) -> None:
        key = self._key(item)
        try:
            await self._runner(item)
        except Exception:
            self._logger.exception(
                "%s runner escaped its resource boundary key=%s",
                self._name,
                key,
            )
        finally:
            with anyio.CancelScope(shield=True):
                async with self._lock:
                    self._active.pop(key, None)
                    if not self._active:
                        self._idle.set()
                    self._wake.set()
                if self._finished is not None:
                    await self._finished(item)


__all__ = ["CancellationTarget", "FairSchedulerKernel"]
