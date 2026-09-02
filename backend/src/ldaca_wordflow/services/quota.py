"""Filesystem-derived per-principal durable storage quota.

Quota assignments are read from SQLite on every operation. Finite usage is a
fresh scan of owner-attributable durable storage plus process-local
reservations; no usage ledger, counter, watcher, or policy cache exists.
"""

from __future__ import annotations

import os
import stat
import tempfile
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Protocol, TypeVar

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..infrastructure.storage.layout import USER_FILE_IMPORT_STAGING_DIRECTORY
from ..infrastructure.storage.safe_paths import (
    is_link_or_reparse as _is_link_or_reparse,
)
from ..infrastructure.storage.workspace_access import (
    WorkspaceAccessInvalidError,
    read_workspace_owner,
)
from ..shared.errors import StorageQuotaExceededError

T = TypeVar("T")


class StorageQuotaRepository(Protocol):
    async def get_storage_quota_bytes(self, user_id: str) -> int | None: ...


@dataclass(frozen=True, slots=True)
class UnlimitedStorageStatus:
    policy: str = "unlimited"


@dataclass(frozen=True, slots=True)
class QuotaStorageStatus:
    limit_bytes: int
    used_bytes: int
    reserved_bytes: int
    available_bytes: int
    policy: str = "quota"


StorageStatus = UnlimitedStorageStatus | QuotaStorageStatus


@dataclass(slots=True)
class QuotaReservation:
    """One releasable finite-policy growth reservation."""

    _service: QuotaService
    user_id: str
    reserved_bytes: int
    _released: bool = False

    async def recheck(self, actual_growth_bytes: int) -> None:
        """Observe the latest policy and resize before atomic publication."""

        if self._released:
            raise RuntimeError("Storage quota reservation is already released")
        await self._service._recheck(self, actual_growth_bytes)

    async def recheck_estimate(
        self,
        requested_bytes: int,
        *,
        requested_entries: int = 0,
    ) -> None:
        """Rebuild a conservative allocation estimate under the latest policy."""

        if self._released:
            raise RuntimeError("Storage quota reservation is already released")
        await self._service._recheck_estimate(
            self,
            requested_bytes,
            requested_entries=requested_entries,
        )

    async def recheck_path(
        self,
        staged_path: Path,
        *,
        replacing_path: Path | None = None,
    ) -> int:
        """Measure a staged tree only when the latest policy is finite."""

        if self._released:
            raise RuntimeError("Storage quota reservation is already released")
        return await self._service._recheck_path(
            self,
            staged_path,
            replacing_path=replacing_path,
        )

    async def release(self) -> None:
        if self._released:
            return
        with anyio.CancelScope(shield=True):
            await self._service._release(self)
            self._released = True


@dataclass(slots=True)
class _UserGate:
    lock: anyio.Lock
    users: int = 0


class QuotaService:
    """Authoritative total-disk quota admission and point-in-time status."""

    def __init__(
        self,
        repository: StorageQuotaRepository,
        *,
        data_root: Path,
        user_root: Callable[[str], Path],
        workspaces_root: Path,
        limiter: anyio.CapacityLimiter,
    ) -> None:
        self._repository = repository
        self._data_root = data_root
        self._user_root = user_root
        self._workspaces_root = workspaces_root
        self._limiter = limiter
        self._reserved_by_user: dict[str, int] = {}
        self._gates: dict[str, _UserGate] = {}
        self._gate_registry_lock = anyio.Lock()
        self._allocation_unit: int | None = None
        self._allocation_unit_lock = anyio.Lock()

    async def initialize(self, *, require_finite_capability: bool) -> None:
        """Fail readiness when the deployment requires unsupported accounting."""

        if require_finite_capability:
            await self._get_allocation_unit()

    async def status(self, user_id: str) -> StorageStatus:
        """Capture one policy/usage/reservation snapshot under its admission gate."""

        async with self._user_gate(user_id):
            limit = await self._repository.get_storage_quota_bytes(user_id)
            if limit is None:
                return UnlimitedStorageStatus()
            used = await self._scan_used(user_id)
            reserved = self._reserved_by_user.get(user_id, 0)
            return QuotaStorageStatus(
                limit_bytes=limit,
                used_bytes=used,
                reserved_bytes=reserved,
                available_bytes=max(0, limit - used - reserved),
            )

    async def reserve(
        self,
        user_id: str,
        requested_bytes: int,
        *,
        requested_entries: int = 0,
    ) -> QuotaReservation:
        """Reserve positive allocated growth before a write starts."""

        if requested_bytes < 0 or requested_entries < 0:
            raise ValueError("Storage quota reservation cannot be negative")
        async with self._user_gate(user_id):
            limit = await self._repository.get_storage_quota_bytes(user_id)
            if limit is None or (requested_bytes == 0 and requested_entries == 0):
                return QuotaReservation(self, user_id, 0)
            unit = await self._get_allocation_unit()
            requested = _reservation_bytes(requested_bytes, requested_entries, unit)
            used = await self._scan_used(user_id, allocation_unit=unit)
            reserved = self._reserved_by_user.get(user_id, 0)
            if used + reserved + requested > limit:
                raise StorageQuotaExceededError(
                    limit_bytes=limit,
                    used_bytes=used,
                    reserved_bytes=reserved,
                    requested_growth_bytes=requested,
                )
            self._reserved_by_user[user_id] = reserved + requested
            return QuotaReservation(self, user_id, requested)

    async def measure_path(self, path: Path) -> int:
        """Measure exact allocated bytes for a staged or durable tree."""

        unit = await self._get_allocation_unit()
        return await self._run_io(_allocated_tree_bytes, path, unit)

    async def _recheck(
        self,
        reservation: QuotaReservation,
        actual_growth_bytes: int,
    ) -> None:
        if actual_growth_bytes < 0:
            raise ValueError("Actual storage growth cannot be negative")
        async with self._user_gate(reservation.user_id):
            current = reservation.reserved_bytes
            total = self._reserved_by_user.get(reservation.user_id, 0)
            other = max(0, total - current)
            limit = await self._repository.get_storage_quota_bytes(reservation.user_id)
            if limit is None:
                self._set_reserved(reservation.user_id, other)
                reservation.reserved_bytes = 0
                return
            await self._apply_finite_recheck(
                reservation,
                limit=limit,
                total=total,
                other=other,
                actual_growth_bytes=actual_growth_bytes,
            )

    async def _recheck_estimate(
        self,
        reservation: QuotaReservation,
        requested_bytes: int,
        *,
        requested_entries: int,
    ) -> None:
        if requested_bytes < 0 or requested_entries < 0:
            raise ValueError("Storage quota reservation cannot be negative")
        async with self._user_gate(reservation.user_id):
            current = reservation.reserved_bytes
            total = self._reserved_by_user.get(reservation.user_id, 0)
            other = max(0, total - current)
            limit = await self._repository.get_storage_quota_bytes(reservation.user_id)
            if limit is None:
                self._set_reserved(reservation.user_id, other)
                reservation.reserved_bytes = 0
                return
            unit = await self._get_allocation_unit()
            estimated_growth = _reservation_bytes(
                requested_bytes,
                requested_entries,
                unit,
            )
            await self._apply_finite_recheck(
                reservation,
                limit=limit,
                total=total,
                other=other,
                actual_growth_bytes=estimated_growth,
            )

    async def _recheck_path(
        self,
        reservation: QuotaReservation,
        staged_path: Path,
        *,
        replacing_path: Path | None,
    ) -> int:
        async with self._user_gate(reservation.user_id):
            current = reservation.reserved_bytes
            total = self._reserved_by_user.get(reservation.user_id, 0)
            other = max(0, total - current)
            limit = await self._repository.get_storage_quota_bytes(reservation.user_id)
            if limit is None:
                self._set_reserved(reservation.user_id, other)
                reservation.reserved_bytes = 0
                return 0
            unit = await self._get_allocation_unit()
            staged = await self._run_io(_allocated_tree_bytes, staged_path, unit)
            replaced = (
                await self._run_io(_allocated_tree_bytes, replacing_path, unit)
                if replacing_path is not None
                else 0
            )
            actual_growth = max(0, staged - replaced)
            await self._apply_finite_recheck(
                reservation,
                limit=limit,
                total=total,
                other=other,
                actual_growth_bytes=actual_growth,
            )
            return actual_growth

    async def _apply_finite_recheck(
        self,
        reservation: QuotaReservation,
        *,
        limit: int,
        total: int,
        other: int,
        actual_growth_bytes: int,
    ) -> None:
        if actual_growth_bytes == 0:
            self._set_reserved(reservation.user_id, other)
            reservation.reserved_bytes = 0
            return
        used = await self._scan_used(reservation.user_id)
        requested_growth = max(0, actual_growth_bytes - reservation.reserved_bytes)
        if used + other + actual_growth_bytes > limit:
            raise StorageQuotaExceededError(
                limit_bytes=limit,
                used_bytes=used,
                reserved_bytes=total,
                requested_growth_bytes=requested_growth,
            )
        self._set_reserved(
            reservation.user_id,
            other + actual_growth_bytes,
        )
        reservation.reserved_bytes = actual_growth_bytes

    async def _release(self, reservation: QuotaReservation) -> None:
        if reservation.reserved_bytes == 0:
            return
        async with self._user_gate(reservation.user_id):
            total = self._reserved_by_user.get(reservation.user_id, 0)
            self._set_reserved(
                reservation.user_id,
                max(0, total - reservation.reserved_bytes),
            )
            reservation.reserved_bytes = 0

    def _set_reserved(self, user_id: str, value: int) -> None:
        if value:
            self._reserved_by_user[user_id] = value
        else:
            self._reserved_by_user.pop(user_id, None)

    async def _scan_used(
        self,
        user_id: str,
        *,
        allocation_unit: int | None = None,
    ) -> int:
        unit = allocation_unit or await self._get_allocation_unit()
        return await self._run_io(
            _owned_allocated_bytes,
            self._user_root(user_id),
            self._workspaces_root,
            user_id,
            unit,
        )

    async def _get_allocation_unit(self) -> int:
        if self._allocation_unit is not None:
            return self._allocation_unit
        async with self._allocation_unit_lock:
            if self._allocation_unit is None:
                self._allocation_unit = await self._run_io(
                    _probe_allocation_unit,
                    self._data_root,
                )
            return self._allocation_unit

    @asynccontextmanager
    async def _user_gate(self, user_id: str) -> AsyncIterator[None]:
        async with self._gate_registry_lock:
            gate = self._gates.get(user_id)
            if gate is None:
                gate = _UserGate(anyio.Lock())
                self._gates[user_id] = gate
            gate.users += 1
        try:
            async with gate.lock:
                yield
        finally:
            async with self._gate_registry_lock:
                gate.users -= 1
                if gate.users == 0:
                    self._gates.pop(user_id, None)

    async def _run_io(self, function: Callable[..., T], *args: object) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _reservation_bytes(requested_bytes: int, entries: int, unit: int) -> int:
    content = ((requested_bytes + unit - 1) // unit) * unit if requested_bytes else 0
    return content + entries * unit


def _probe_allocation_unit(data_root: Path) -> int:
    statvfs = getattr(os, "statvfs", None)
    if statvfs is None:
        raise RuntimeError("Data Root does not expose filesystem allocation metrics")
    try:
        unit = int(statvfs(data_root).f_frsize)
    except OSError as exc:
        raise RuntimeError(
            "Data Root does not expose filesystem allocation metrics"
        ) from exc
    if unit < 1:
        raise RuntimeError("Data Root filesystem allocation unit is invalid")
    descriptor, raw_path = tempfile.mkstemp(prefix=".quota-probe-", dir=data_root)
    probe = Path(raw_path)
    try:
        os.write(descriptor, b"wordflow")
        os.fsync(descriptor)
        metadata = os.fstat(descriptor)
        blocks = getattr(metadata, "st_blocks", None)
        if not isinstance(blocks, int) or blocks < 1:
            raise RuntimeError("Data Root does not expose allocated filesystem blocks")
    finally:
        os.close(descriptor)
        probe.unlink(missing_ok=True)
    return unit


def _entry_allocated_bytes(metadata: os.stat_result, unit: int) -> int:
    blocks = getattr(metadata, "st_blocks", None)
    if not isinstance(blocks, int) or blocks < 0:
        raise RuntimeError("Filesystem entry lacks allocated-block metrics")
    return max(blocks * 512, unit)


def _allocated_tree_bytes(
    root: Path,
    unit: int,
    *,
    exclude_unpublished: bool = False,
) -> int:
    try:
        root_metadata = root.lstat()
    except FileNotFoundError:
        return 0
    if _is_link_or_reparse(root_metadata):
        return 0
    if stat.S_ISREG(root_metadata.st_mode):
        return 0 if exclude_unpublished else _entry_allocated_bytes(root_metadata, unit)
    if not stat.S_ISDIR(root_metadata.st_mode):
        return 0
    total = _entry_allocated_bytes(root_metadata, unit)
    for current_root, directory_names, file_names in os.walk(
        root,
        topdown=True,
        followlinks=False,
    ):
        current = Path(current_root)
        safe_directories: list[str] = []
        for name in directory_names:
            if exclude_unpublished and name == USER_FILE_IMPORT_STAGING_DIRECTORY:
                continue
            candidate = current / name
            try:
                metadata = candidate.lstat()
            except FileNotFoundError:
                continue
            if _is_link_or_reparse(metadata) or not stat.S_ISDIR(metadata.st_mode):
                continue
            safe_directories.append(name)
            total += _entry_allocated_bytes(metadata, unit)
        directory_names[:] = safe_directories
        for name in file_names:
            if exclude_unpublished and name.startswith(".") and name.endswith(
                ".upload"
            ):
                continue
            candidate = current / name
            try:
                metadata = candidate.lstat()
            except FileNotFoundError:
                continue
            if stat.S_ISREG(metadata.st_mode) and not _is_link_or_reparse(metadata):
                total += _entry_allocated_bytes(metadata, unit)
    return total


def _owned_workspace_bytes(root: Path, user_id: str, unit: int) -> int:
    if not root.is_dir() or root.is_symlink():
        return 0
    total = 0
    for candidate in root.iterdir():
        if candidate.name.startswith("."):
            continue
        try:
            metadata = candidate.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(metadata.st_mode) or _is_link_or_reparse(metadata):
            continue
        try:
            owner_id = read_workspace_owner(candidate)
        except WorkspaceAccessInvalidError:
            continue
        if owner_id == user_id:
            total += _allocated_tree_bytes(candidate, unit)
    return total


def _owned_allocated_bytes(
    user_root: Path,
    workspaces_root: Path,
    user_id: str,
    unit: int,
) -> int:
    total = _allocated_tree_bytes(user_root, unit, exclude_unpublished=True)
    total += _owned_workspace_bytes(workspaces_root, user_id, unit)
    total += _owned_workspace_bytes(workspaces_root / ".trash", user_id, unit)
    return total


__all__ = [
    "QuotaReservation",
    "QuotaService",
    "QuotaStorageStatus",
    "StorageQuotaRepository",
    "StorageStatus",
    "UnlimitedStorageStatus",
]
