"""Bounded private TOML persistence beneath the per-user storage root."""

from __future__ import annotations

import os
import stat
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import Protocol, TypeVar

import anyio
import rtoml
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ...shared.errors import UnsafePathError
from .durable_fs import fsync_directory
from .safe_paths import SafePathResolver, is_link_or_reparse

T = TypeVar("T")
MAX_PRIVATE_TOML_BYTES = 1024 * 1024


class PrivateTomlError(ValueError):
    """Stored private TOML is unsafe, oversized, or malformed."""


class _Reservation(Protocol):
    async def recheck_path(
        self,
        staged_path: Path,
        *,
        replacing_path: Path | None = None,
    ) -> int: ...

    async def release(self) -> None: ...


class _StorageAdmission(Protocol):
    async def acquire(
        self,
        user_id: str,
        requested_bytes: int,
        *,
        requested_entries: int = 0,
    ) -> _Reservation: ...


class PrivateTomlPersistence:
    """Read and atomically replace small user-owned TOML documents."""

    def __init__(
        self,
        users_root: Path,
        storage_admission: _StorageAdmission,
        *,
        limiter: anyio.CapacityLimiter,
    ) -> None:
        self._users_root = users_root
        self._storage_admission = storage_admission
        self._limiter = limiter

    async def read(self, user_id: str, filename: str) -> dict[str, object] | None:
        resolver, destination = await self._run_io(
            _prepare_target,
            self._users_root,
            user_id,
            filename,
        )
        return await self._run_io(_read_private_toml, resolver, destination)

    async def write(
        self,
        user_id: str,
        filename: str,
        payload: dict[str, object],
    ) -> None:
        encoded = _encode_private_toml(payload)
        resolver, destination = await self._run_io(
            _prepare_target,
            self._users_root,
            user_id,
            filename,
        )
        replacing = await self._run_io(
            _replacement_path,
            resolver,
            destination,
        )
        reservation = await self._storage_admission.acquire(
            user_id,
            len(encoded),
            requested_entries=1,
        )
        temporary: Path | None = None
        try:
            temporary = await self._run_io(
                _stage_private_toml,
                resolver,
                destination,
                encoded,
            )
            await reservation.recheck_path(
                temporary,
                replacing_path=replacing,
            )
            await self._run_io(
                _publish_private_toml,
                resolver,
                temporary,
                destination,
            )
            temporary = None
        finally:
            with anyio.CancelScope(shield=True):
                if temporary is not None:
                    await self._run_io(_discard_staged_toml, resolver, temporary)
                await reservation.release()

    async def _run_io(
        self,
        function: Callable[..., T],
        *args: object,
    ) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _prepare_target(
    users_root: Path,
    user_id: str,
    filename: str,
) -> tuple[SafePathResolver, Path]:
    try:
        users = SafePathResolver(users_root)
        user_directory = users.resolve(user_id)
        try:
            metadata = user_directory.lstat()
        except FileNotFoundError:
            users.create_directory(user_directory)
        else:
            if is_link_or_reparse(metadata) or not stat.S_ISDIR(metadata.st_mode):
                raise PrivateTomlError("Private user storage is not a safe directory")
        resolver = SafePathResolver(user_directory)
        destination = resolver.resolve(filename)
    except (OSError, UnsafePathError) as exc:
        raise PrivateTomlError("Private TOML path is invalid") from exc
    return resolver, destination


def _replacement_path(
    resolver: SafePathResolver,
    destination: Path,
) -> Path | None:
    try:
        metadata = resolver.resolve(destination.name).lstat()
    except FileNotFoundError:
        return None
    if is_link_or_reparse(metadata) or not stat.S_ISREG(metadata.st_mode):
        raise PrivateTomlError("Stored file must be a contained regular file")
    return destination


def _read_private_toml(
    resolver: SafePathResolver,
    path: Path,
) -> dict[str, object] | None:
    try:
        path.lstat()
    except FileNotFoundError:
        return None
    try:
        checked = resolver.resolve(path.name)
        descriptor = os.open(
            checked,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
        )
    except (OSError, UnsafePathError) as exc:
        raise PrivateTomlError("Stored file must be a contained regular file") from exc
    try:
        metadata = os.fstat(descriptor)
        if is_link_or_reparse(metadata) or not stat.S_ISREG(metadata.st_mode):
            raise PrivateTomlError("Stored file must be a regular file")
        if metadata.st_size > MAX_PRIVATE_TOML_BYTES:
            raise PrivateTomlError("Stored TOML exceeds its byte limit")
        content = _read_bounded(descriptor)
    finally:
        os.close(descriptor)
    try:
        decoded = content.decode("utf-8", errors="strict")
        raw = rtoml.loads(decoded)
    except (UnicodeDecodeError, ValueError) as exc:
        raise PrivateTomlError("Stored TOML is invalid") from exc
    if not isinstance(raw, dict):
        raise PrivateTomlError("Stored TOML must contain a table")
    return raw


def _read_bounded(descriptor: int) -> bytes:
    chunks: list[bytes] = []
    remaining = MAX_PRIVATE_TOML_BYTES + 1
    while remaining:
        chunk = os.read(descriptor, min(64 * 1024, remaining))
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    content = b"".join(chunks)
    if len(content) > MAX_PRIVATE_TOML_BYTES:
        raise PrivateTomlError("Stored TOML exceeds its byte limit")
    return content


def _encode_private_toml(payload: dict[str, object]) -> bytes:
    try:
        encoded = rtoml.dumps(payload).encode("utf-8", errors="strict")
    except (TypeError, ValueError) as exc:
        raise PrivateTomlError("Private TOML payload is invalid") from exc
    if len(encoded) > MAX_PRIVATE_TOML_BYTES:
        raise PrivateTomlError("Private TOML exceeds its byte limit")
    return encoded


def _stage_private_toml(
    resolver: SafePathResolver,
    destination: Path,
    content: bytes,
) -> Path:
    descriptor, temporary = resolver.create_temporary_file(destination)
    try:
        os.fchmod(descriptor, 0o600)
        view = memoryview(content)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:  # pragma: no cover - defensive OS contract guard
                raise OSError("Private TOML write made no progress")
            view = view[written:]
        os.fsync(descriptor)
    except BaseException:
        os.close(descriptor)
        _discard_staged_toml(resolver, temporary)
        raise
    os.close(descriptor)
    return temporary


def _publish_private_toml(
    resolver: SafePathResolver,
    temporary: Path,
    destination: Path,
) -> None:
    temporary = resolver.recheck_for_write(temporary)
    destination = resolver.recheck_for_write(destination)
    metadata = temporary.lstat()
    if is_link_or_reparse(metadata) or not stat.S_ISREG(metadata.st_mode):
        raise PrivateTomlError("Staged TOML is not a regular file")
    os.replace(temporary, destination)
    destination.chmod(0o600)
    fsync_directory(destination.parent)


def _discard_staged_toml(resolver: SafePathResolver, temporary: Path) -> None:
    try:
        checked = resolver.recheck_for_write(temporary)
        metadata = checked.lstat()
    except FileNotFoundError:
        return
    if is_link_or_reparse(metadata) or not stat.S_ISREG(metadata.st_mode):
        raise PrivateTomlError("Staged TOML is not a regular file")
    checked.unlink()


__all__ = [
    "MAX_PRIVATE_TOML_BYTES",
    "PrivateTomlError",
    "PrivateTomlPersistence",
]
