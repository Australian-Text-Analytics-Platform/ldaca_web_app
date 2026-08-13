"""One bounded lifespan-owned maintenance loop.

Used by ``runtime_context`` after all durable services have started. The loop
performs low-frequency cleanup without detached tasks or import-time state and
has an explicit close event so the AnyIO task group can unwind deterministically.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

import anyio
from anyio.abc import TaskGroup

logger = logging.getLogger(__name__)


class MaintenanceService:
    """Run one serialized cleanup callback at a fixed bounded cadence."""

    def __init__(
        self,
        cleanup: Callable[[], Awaitable[None]],
        *,
        interval_seconds: float = 3600,
    ) -> None:
        if interval_seconds <= 0:
            raise ValueError("Maintenance interval must be positive")
        self._cleanup = cleanup
        self._interval_seconds = interval_seconds
        self._stop = anyio.Event()
        self._started = False

    def start(self, task_group: TaskGroup) -> None:
        """Start exactly one loop in the runtime-owned task group."""

        if self._started:
            raise RuntimeError("Maintenance service already started")
        self._started = True
        task_group.start_soon(self._run)

    async def close(self) -> None:
        """Wake the loop so task-group shutdown never waits for the interval."""

        self._stop.set()

    async def _run(self) -> None:
        while True:
            with anyio.move_on_after(self._interval_seconds):
                await self._stop.wait()
            if self._stop.is_set():
                return
            try:
                await self._cleanup()
            except Exception:
                logger.exception("Background maintenance failed")
