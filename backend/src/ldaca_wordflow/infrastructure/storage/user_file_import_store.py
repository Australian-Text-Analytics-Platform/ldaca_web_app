"""Atomic per-resource JSON persistence for retained User File Imports."""

from __future__ import annotations

import stat
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Literal, TypeVar

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread
from pydantic import BaseModel, ConfigDict, ValidationError

from ...domain import UserFileImport
from ...domain.background import BackgroundState
from .durable_fs import (
    AtomicWriteCapacityError,
    atomic_write_json,
    fsync_directory,
    mkdir_durable,
)
from .safe_paths import is_link_or_reparse

T = TypeVar("T")


class UserFileImportStoreError(ValueError):
    """One import record or its storage boundary is invalid."""


@dataclass(frozen=True, slots=True)
class StoredUserFileImport:
    user_id: str
    resource: UserFileImport


@dataclass(frozen=True, slots=True)
class UnavailableStoredUserFileImport:
    user_id: str
    import_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class PreparedStoredUserFileImport:
    user_id: str
    resource: UserFileImport


@dataclass(frozen=True, slots=True)
class UserFileImportStoreSnapshot:
    records: list[StoredUserFileImport]
    prepared_publications: list[PreparedStoredUserFileImport]
    unavailable_records: list[UnavailableStoredUserFileImport]
    corrupt_users: frozenset[str]


class _StoredUserFileImportEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    version: Literal[1] = 1
    resource: UserFileImport


class _PreparedUserFileImportEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    version: Literal[1] = 1
    resource: UserFileImport


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

    async def prepare_publication(
        self,
        user_id: str,
        resource: UserFileImport,
    ) -> None:
        await self._run_io(
            _save_prepared_publication,
            self._root_for_user(user_id),
            resource,
            self._max_record_bytes,
        )

    async def clear_prepared_publication(
        self,
        user_id: str,
        import_id: uuid.UUID,
    ) -> None:
        await self._run_io(
            _clear_prepared_publication,
            self._root_for_user(user_id),
            import_id,
        )

    async def delete(self, user_id: str, import_id: uuid.UUID) -> None:
        await self._run_io(_delete, self._root_for_user(user_id), import_id)

    async def _run_io(self, function: Callable[..., T], *args: object) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _require_real_directory(path: Path, *, create: bool) -> Path:
    if create:
        mkdir_durable(path)
    try:
        metadata = path.lstat()
    except FileNotFoundError as exc:
        raise UserFileImportStoreError("Import storage is missing") from exc
    if not stat.S_ISDIR(metadata.st_mode) or is_link_or_reparse(metadata):
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


def _prepared_path(root: Path, import_id: uuid.UUID) -> Path:
    return root / f".prepared-{import_id}.json"


def _save(root: Path, resource: UserFileImport, max_record_bytes: int) -> None:
    _require_real_directory(root, create=True)
    target = _record_path(root, resource.id)
    if target.exists():
        metadata = target.lstat()
        if not stat.S_ISREG(metadata.st_mode) or is_link_or_reparse(metadata):
            raise UserFileImportStoreError("Import record is unsafe")
    try:
        atomic_write_json(
            target,
            _StoredUserFileImportEnvelope(resource=resource).model_dump(mode="json"),
            max_bytes=max_record_bytes,
        )
    except AtomicWriteCapacityError as exc:
        raise UserFileImportStoreError("Import record exceeds its storage limit") from exc


def _save_prepared_publication(
    root: Path,
    resource: UserFileImport,
    max_record_bytes: int,
) -> None:
    if resource.state is not BackgroundState.SUCCEEDED or resource.result is None:
        raise UserFileImportStoreError(
            "Prepared publication must contain a successful import"
        )
    _require_real_directory(root, create=True)
    target = _prepared_path(root, resource.id)
    if target.exists():
        metadata = target.lstat()
        if not stat.S_ISREG(metadata.st_mode) or is_link_or_reparse(metadata):
            raise UserFileImportStoreError("Prepared publication is unsafe")
    try:
        atomic_write_json(
            target,
            _PreparedUserFileImportEnvelope(resource=resource).model_dump(mode="json"),
            max_bytes=max_record_bytes,
        )
    except AtomicWriteCapacityError as exc:
        raise UserFileImportStoreError(
            "Prepared publication exceeds its storage limit"
        ) from exc


def _clear_prepared_publication(root: Path, import_id: uuid.UUID) -> None:
    _require_real_directory(root, create=False)
    target = _prepared_path(root, import_id)
    try:
        metadata = target.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISREG(metadata.st_mode) or is_link_or_reparse(metadata):
        raise UserFileImportStoreError("Prepared publication is unsafe")
    target.unlink()
    fsync_directory(root)


def _delete(root: Path, import_id: uuid.UUID) -> None:
    _require_real_directory(root, create=False)
    target = _record_path(root, import_id)
    try:
        metadata = target.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISREG(metadata.st_mode) or is_link_or_reparse(metadata):
        raise UserFileImportStoreError("Import record is unsafe")
    target.unlink()
    fsync_directory(root)


def _load_record(
    path: Path,
    import_id: uuid.UUID,
    max_record_bytes: int,
) -> UserFileImport:
    metadata = path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or is_link_or_reparse(metadata)
        or metadata.st_size > max_record_bytes
    ):
        raise UserFileImportStoreError("Import record is invalid")
    try:
        envelope = _StoredUserFileImportEnvelope.model_validate_json(path.read_bytes())
    except (OSError, ValidationError, ValueError) as exc:
        raise UserFileImportStoreError("Import record is invalid") from exc
    resource = envelope.resource
    if resource.id != import_id:
        raise UserFileImportStoreError("Import record identity is invalid")
    return resource


def _load_prepared_publication(
    path: Path,
    import_id: uuid.UUID,
    max_record_bytes: int,
) -> UserFileImport:
    metadata = path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or is_link_or_reparse(metadata)
        or metadata.st_size > max_record_bytes
    ):
        raise UserFileImportStoreError("Prepared publication is invalid")
    try:
        envelope = _PreparedUserFileImportEnvelope.model_validate_json(
            path.read_bytes()
        )
    except (OSError, ValidationError, ValueError) as exc:
        raise UserFileImportStoreError("Prepared publication is invalid") from exc
    resource = envelope.resource
    if (
        resource.id != import_id
        or resource.state is not BackgroundState.SUCCEEDED
        or resource.result is None
    ):
        raise UserFileImportStoreError("Prepared publication is invalid")
    return resource


def _load_user(
    root: Path,
    max_record_bytes: int,
) -> tuple[list[UserFileImport], list[UserFileImport], list[uuid.UUID]]:
    _require_real_directory(root, create=False)
    records: list[UserFileImport] = []
    prepared: list[UserFileImport] = []
    unavailable: list[uuid.UUID] = []
    for path in root.iterdir():
        if path.name.startswith(".prepared-") and path.suffix == ".json":
            try:
                raw_import_id = path.name.removeprefix(".prepared-").removesuffix(
                    ".json"
                )
                import_id = uuid.UUID(raw_import_id)
                prepared.append(
                    _load_prepared_publication(path, import_id, max_record_bytes)
                )
            except (UserFileImportStoreError, ValueError):
                continue
            continue
        if path.name.startswith("."):
            continue
        try:
            import_id = uuid.UUID(path.stem)
        except ValueError as exc:
            raise UserFileImportStoreError("Import record name is invalid") from exc
        if path.suffix != ".json":
            raise UserFileImportStoreError("Import record name is invalid")
        try:
            records.append(_load_record(path, import_id, max_record_bytes))
        except UserFileImportStoreError:
            unavailable.append(import_id)
    return records, prepared, unavailable


def _load_all(
    all_users_root: Path,
    max_record_bytes: int,
) -> UserFileImportStoreSnapshot:
    if not all_users_root.exists():
        return UserFileImportStoreSnapshot([], [], [], frozenset())
    _require_real_directory(all_users_root, create=False)
    records: list[StoredUserFileImport] = []
    prepared_publications: list[PreparedStoredUserFileImport] = []
    unavailable_records: list[UnavailableStoredUserFileImport] = []
    corrupt_users: set[str] = set()
    for user_root in all_users_root.iterdir():
        if user_root.name.startswith("."):
            continue
        try:
            metadata = user_root.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(metadata.st_mode) or is_link_or_reparse(metadata):
            continue
        imports_root = user_root / "imports"
        if not imports_root.exists():
            continue
        try:
            user_records, user_prepared, user_unavailable = _load_user(
                imports_root,
                max_record_bytes,
            )
        except UserFileImportStoreError:
            corrupt_users.add(user_root.name)
            continue
        records.extend(
            StoredUserFileImport(user_root.name, resource)
            for resource in user_records
        )
        prepared_publications.extend(
            PreparedStoredUserFileImport(user_root.name, resource)
            for resource in user_prepared
        )
        unavailable_records.extend(
            UnavailableStoredUserFileImport(user_root.name, import_id)
            for import_id in user_unavailable
        )
    return UserFileImportStoreSnapshot(
        records,
        prepared_publications,
        unavailable_records,
        frozenset(corrupt_users),
    )


__all__ = [
    "StoredUserFileImport",
    "PreparedStoredUserFileImport",
    "UnavailableStoredUserFileImport",
    "UserFileImportStore",
    "UserFileImportStoreError",
    "UserFileImportStoreSnapshot",
]
