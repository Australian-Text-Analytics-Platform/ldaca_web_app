"""Bounded response-lifetime snapshots outside mutable user resources."""

from __future__ import annotations

import os
import shutil
import stat
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import TypeVar

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..shared.errors import ResourceTooLargeError
from .storage_admission import StorageAdmissionService, StorageReservation

T = TypeVar("T")


@dataclass(slots=True)
class ResponseSnapshot:
    """Immutable response file whose async cleanup releases all admission."""

    path: Path
    _reservation: StorageReservation
    _slots: anyio.Semaphore
    _limiter: anyio.CapacityLimiter
    _closed: bool = False

    async def cleanup(self) -> None:
        """Delete and release exactly once after response completion/failure."""

        if self._closed:
            return
        self._closed = True
        try:
            await run_sync_in_worker_thread(
                partial(self.path.unlink, missing_ok=True),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
        finally:
            await self._reservation.release()
            self._slots.release()


class ResponseSnapshotService:
    """Own bounded hard-link/copy snapshots shared by download routes."""

    def __init__(
        self,
        root: Path,
        storage_admission: StorageAdmissionService,
        *,
        max_snapshot_bytes: int,
        max_concurrent_snapshots: int,
        limiter: anyio.CapacityLimiter,
    ) -> None:
        if min(max_snapshot_bytes, max_concurrent_snapshots) < 1:
            raise ValueError("Response snapshot limits must be positive")
        self._root = root
        self._storage_admission = storage_admission
        self._max_snapshot_bytes = max_snapshot_bytes
        self._slots = anyio.Semaphore(max_concurrent_snapshots)
        self._limiter = limiter

    async def create(self, source: Path) -> ResponseSnapshot:
        """Reserve worst-case copy bytes and retain a concurrency slot."""

        metadata = await self._run_io(source.lstat)
        if not stat.S_ISREG(metadata.st_mode) or source.is_symlink():
            raise ValueError("Response source is not a regular file")
        if metadata.st_size > self._max_snapshot_bytes:
            raise ResourceTooLargeError("Download exceeds the response snapshot limit")
        await self._slots.acquire()
        reservation: StorageReservation | None = None
        path: Path | None = None
        try:
            reservation = await self._storage_admission.acquire_transient(
                metadata.st_size,
            )
            path = await self._run_io(
                _create_snapshot,
                self._root,
                source,
                self._max_snapshot_bytes,
            )
            return ResponseSnapshot(path, reservation, self._slots, self._limiter)
        except BaseException:
            if path is not None:
                await self._run_io(path.unlink, missing_ok=True)
            if reservation is not None:
                with anyio.CancelScope(shield=True):
                    await reservation.release()
            self._slots.release()
            raise

    async def create_generated(
        self,
        *,
        suffix: str,
        max_output_bytes: int,
        reservation_bytes: int,
        producer: Callable[[Path, int], None],
    ) -> ResponseSnapshot:
        """Run one bounded synchronous producer under shared admission."""

        await self._slots.acquire()
        reservation: StorageReservation | None = None
        path: Path | None = None
        try:
            reservation = await self._storage_admission.acquire_transient(
                reservation_bytes,
            )
            path = await self._run_io(
                _create_generated_snapshot,
                self._root,
                suffix,
                max_output_bytes,
                producer,
            )
            return ResponseSnapshot(path, reservation, self._slots, self._limiter)
        except BaseException:
            if path is not None:
                await self._run_io(path.unlink, missing_ok=True)
            if reservation is not None:
                with anyio.CancelScope(shield=True):
                    await reservation.release()
            self._slots.release()
            raise

    async def reconcile(self) -> None:
        """Remove only this process family's abandoned response directory."""

        await self._run_io(_remove_root, self._root)

    async def _run_io(
        self, function: Callable[..., T], *args: object, **kwargs: object
    ) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args, **kwargs),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _create_snapshot(root: Path, source: Path, max_bytes: int) -> Path:
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        raise RuntimeError("Response snapshot root is unsafe")
    destination = root / f"response-{uuid.uuid4()}{source.suffix}"
    copied = 0
    try:
        with source.open("rb") as input_file, destination.open("xb") as output_file:
            while chunk := input_file.read(1024 * 1024):
                copied += len(chunk)
                if copied > max_bytes:
                    raise ResourceTooLargeError(
                        "Download exceeds the response snapshot limit"
                    )
                output_file.write(chunk)
            output_file.flush()
            os.fsync(output_file.fileno())
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return destination


def _create_generated_snapshot(
    root: Path,
    suffix: str,
    max_output_bytes: int,
    producer: Callable[[Path, int], None],
) -> Path:
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        raise RuntimeError("Response snapshot root is unsafe")
    destination = root / f"response-{uuid.uuid4()}{suffix}"
    try:
        producer(destination, max_output_bytes)
        metadata = destination.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > max_output_bytes:
            raise ResourceTooLargeError("Generated response exceeds its storage limit")
        return destination
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


def _remove_root(root: Path) -> None:
    try:
        metadata = root.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISDIR(metadata.st_mode) or root.is_symlink():
        raise RuntimeError("Response snapshot root is unsafe")
    shutil.rmtree(root)


__all__ = ["ResponseSnapshot", "ResponseSnapshotService"]
