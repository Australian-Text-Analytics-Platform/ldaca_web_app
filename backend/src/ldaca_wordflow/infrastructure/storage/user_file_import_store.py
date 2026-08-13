"""Atomic per-resource JSON persistence for retained User File Imports."""

from __future__ import annotations

import os
import stat
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import TypeVar

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread
from pydantic import ValidationError

from ...domain import UserFileImport
from .durable_fs import (
    AtomicWriteCapacityError,
    atomic_write_json,
    fsync_directory,
    mkdir_durable,
)

T = TypeVar("T")


class UserFileImportStoreError(ValueError):
    """One import record or its storage boundary is invalid."""


@dataclass(frozen=True, slots=True)
class StoredUserFileImport:
    user_id: str
    resource: UserFileImport


@dataclass(frozen=True, slots=True)
class UserFileImportStoreSnapshot:
    records: list[StoredUserFileImport]
    corrupt_users: frozenset[str]


class UserFileImportStore:
    """Persist each exact import independently below its owning user root."""

    def __init__(
        self,
        root_for_user: Callable[[str], Path],
        *,
        all_users_root: Path,
        max_record_bytes: int,
        limiter: anyio.CapacityLimiter,
    ) -> None:
        if max_record_bytes < 1:
            raise ValueError("User File Import record limit must be positive")
        self._root_for_user = root_for_user
        self._all_users_root = all_users_root
        self._max_record_bytes = max_record_bytes
        self._limiter = limiter

    async def load_all(self) -> UserFileImportStoreSnapshot:
        return await self._run_io(
            _load_all,
            self._all_users_root,
            self._max_record_bytes,
        )

    async def save(self, user_id: str, resource: UserFileImport) -> None:
        await self._run_io(
            _save,
            self._root_for_user(user_id),
            resource,
            self._max_record_bytes,
        )

    async def delete(self, user_id: str, import_id: uuid.UUID) -> None:
        await self._run_io(_delete, self._root_for_user(user_id), import_id)

    async def _run_io(self, function: Callable[..., T], *args: object) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _is_link_or_reparse(metadata: os.stat_result) -> bool:
    attributes = int(getattr(metadata, "st_file_attributes", 0))
    reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    return stat.S_ISLNK(metadata.st_mode) or bool(attributes & reparse)


def _require_real_directory(path: Path, *, create: bool) -> Path:
    if create:
        mkdir_durable(path)
    try:
        metadata = path.lstat()
    except FileNotFoundError as exc:
        raise UserFileImportStoreError("Import storage is missing") from exc
    if not stat.S_ISDIR(metadata.st_mode) or _is_link_or_reparse(metadata):
        raise UserFileImportStoreError("Import storage is unsafe")
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise UserFileImportStoreError("Import storage is unavailable") from exc
    if resolved != path:
        raise UserFileImportStoreError("Import storage contains a link")
    return path


def _record_path(root: Path, import_id: uuid.UUID) -> Path:
    return root / f"{import_id}.json"


def _save(root: Path, resource: UserFileImport, max_record_bytes: int) -> None:
    _require_real_directory(root, create=True)
    target = _record_path(root, resource.id)
    if target.exists():
        metadata = target.lstat()
        if not stat.S_ISREG(metadata.st_mode) or _is_link_or_reparse(metadata):
            raise UserFileImportStoreError("Import record is unsafe")
    try:
        atomic_write_json(
            target,
            resource.model_dump(mode="json"),
            max_bytes=max_record_bytes,
        )
    except AtomicWriteCapacityError as exc:
        raise UserFileImportStoreError("Import record exceeds its storage limit") from exc


def _delete(root: Path, import_id: uuid.UUID) -> None:
    _require_real_directory(root, create=False)
    target = _record_path(root, import_id)
    try:
        metadata = target.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISREG(metadata.st_mode) or _is_link_or_reparse(metadata):
        raise UserFileImportStoreError("Import record is unsafe")
    target.unlink()
    fsync_directory(root)


def _load_record(path: Path, max_record_bytes: int) -> UserFileImport:
    metadata = path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or _is_link_or_reparse(metadata)
        or metadata.st_size > max_record_bytes
    ):
        raise UserFileImportStoreError("Import record is invalid")
    try:
        resource = UserFileImport.model_validate_json(path.read_bytes())
    except (OSError, ValidationError, ValueError) as exc:
        raise UserFileImportStoreError("Import record is invalid") from exc
    if path.name != f"{resource.id}.json":
        raise UserFileImportStoreError("Import record identity is invalid")
    return resource


def _load_user(root: Path, max_record_bytes: int) -> list[UserFileImport]:
    _require_real_directory(root, create=False)
    records: list[UserFileImport] = []
    for path in root.iterdir():
        if path.name.startswith("."):
            continue
        try:
            uuid.UUID(path.stem)
        except ValueError as exc:
            raise UserFileImportStoreError("Import record name is invalid") from exc
        if path.suffix != ".json":
            raise UserFileImportStoreError("Import record name is invalid")
        records.append(_load_record(path, max_record_bytes))
    return records


def _load_all(
    all_users_root: Path,
    max_record_bytes: int,
) -> UserFileImportStoreSnapshot:
    if not all_users_root.exists():
        return UserFileImportStoreSnapshot([], frozenset())
    _require_real_directory(all_users_root, create=False)
    records: list[StoredUserFileImport] = []
    corrupt_users: set[str] = set()
    for user_root in all_users_root.iterdir():
        if user_root.name.startswith("."):
            continue
        try:
            metadata = user_root.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(metadata.st_mode) or _is_link_or_reparse(metadata):
            continue
        imports_root = user_root / "imports"
        if not imports_root.exists():
            continue
        try:
            user_records = _load_user(imports_root, max_record_bytes)
        except UserFileImportStoreError:
            corrupt_users.add(user_root.name)
            continue
        records.extend(
            StoredUserFileImport(user_root.name, resource)
            for resource in user_records
        )
    return UserFileImportStoreSnapshot(records, frozenset(corrupt_users))


__all__ = [
    "StoredUserFileImport",
    "UserFileImportStore",
    "UserFileImportStoreError",
    "UserFileImportStoreSnapshot",
]
