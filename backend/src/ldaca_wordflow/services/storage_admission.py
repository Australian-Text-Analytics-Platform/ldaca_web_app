"""One writer-facing admission boundary for quota and physical disk safety."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import TypeVar

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..shared.errors import StorageCapacityExceededError
from .quota import QuotaReservation, QuotaService

T = TypeVar("T")


@dataclass(slots=True)
class StorageReservation:
    """Idempotently releasable quota plus physical-capacity reservation."""

    _service: "StorageAdmissionService"
    _quota: QuotaReservation | None
    physical_bytes: int
    _released: bool = False

    async def recheck(self, actual_growth_bytes: int) -> None:
        """Recheck the latest finite policy before publication."""

        if self._released:
            raise RuntimeError("Storage reservation is already released")
        if self._quota is not None:
            await self._quota.recheck(actual_growth_bytes)

    async def recheck_estimate(
        self,
        requested_bytes: int,
        *,
        requested_entries: int = 0,
    ) -> None:
        """Rebuild an entry-aware quota estimate before publication."""

        if self._released:
            raise RuntimeError("Storage reservation is already released")
        if self._quota is not None:
            await self._quota.recheck_estimate(
                requested_bytes,
                requested_entries=requested_entries,
            )

    async def recheck_path(
        self,
        staged_path: Path,
        *,
        replacing_path: Path | None = None,
    ) -> int:
        """Measure and recheck a staged publication under the current policy."""

        if self._released:
            raise RuntimeError("Storage reservation is already released")
        if self._quota is None:
            return 0
        return await self._quota.recheck_path(
            staged_path,
            replacing_path=replacing_path,
        )

    async def release(self) -> None:
        if self._released:
            return
        with anyio.CancelScope(shield=True):
            if self._quota is not None:
                await self._quota.release()
            await self._service._release_physical(self.physical_bytes)
            self.physical_bytes = 0
            self._released = True


class StorageAdmissionService:
    """Check user quota first, then reserve shared Data Root headroom."""

    def __init__(
        self,
        data_root: Path,
        quota_service: QuotaService,
        *,
        min_free_disk_bytes: int,
        limiter: anyio.CapacityLimiter,
    ) -> None:
        if min_free_disk_bytes < 0:
            raise ValueError("Physical storage reserve cannot be negative")
        self._data_root = data_root
        self._quota_service = quota_service
        self._min_free_disk_bytes = min_free_disk_bytes
        self._limiter = limiter
        self._reserved_total = 0
        self._lock = anyio.Lock()

    async def acquire(
        self,
        user_id: str,
        requested_bytes: int,
        *,
        requested_entries: int = 0,
    ) -> StorageReservation:
        """Admit one durable write without conflating quota and host pressure."""

        if requested_bytes < 0 or requested_entries < 0:
            raise ValueError("Storage reservation cannot be negative")
        quota = await self._quota_service.reserve(
            user_id,
            requested_bytes,
            requested_entries=requested_entries,
        )
        physical = max(requested_bytes, quota.reserved_bytes)
        try:
            await self._reserve_physical(physical)
        except BaseException:
            with anyio.CancelScope(shield=True):
                await quota.release()
            raise
        return StorageReservation(self, quota, physical)

    async def acquire_transient(self, requested_bytes: int) -> StorageReservation:
        """Reserve shared headroom for non-user-attributed temporary output."""

        if requested_bytes < 0:
            raise ValueError("Storage reservation cannot be negative")
        await self._reserve_physical(requested_bytes)
        return StorageReservation(self, None, requested_bytes)

    async def _reserve_physical(self, requested_bytes: int) -> None:
        async with self._lock:
            free = await self._run_io(_free_bytes, self._data_root)
            if (
                free - self._reserved_total - requested_bytes
                < self._min_free_disk_bytes
            ):
                raise StorageCapacityExceededError()
            self._reserved_total += requested_bytes

    async def _release_physical(self, requested_bytes: int) -> None:
        async with self._lock:
            self._reserved_total = max(0, self._reserved_total - requested_bytes)

    async def _run_io(self, function: Callable[..., T], *args: object) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _free_bytes(root: Path) -> int:
    return shutil.disk_usage(root).free


__all__ = ["StorageAdmissionService", "StorageReservation"]
