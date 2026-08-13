"""Runtime-owned filesystem boundary for user data files.

Used by:
- file CRUD and download routes after authentication supplies a user id.

Why:
- user-controlled paths, partial uploads, and filesystem races need one
  FastAPI-independent owner rather than route-specific checks and direct I/O.

Flow:
- Resolve every path through ``SafePathResolver``.
- Serialize mutations per user while allowing different users to proceed in
  parallel.
- Stream uploads to an exclusive temporary file on the destination filesystem,
  enforce the byte limit from bytes actually read, fsync, recheck containment,
  and atomically replace only after confirming the destination is absent.
- Run blocking filesystem calls in non-abandoned AnyIO worker threads so a
  cancelled request cannot release service coordination while a write continues.
"""

from __future__ import annotations

import os
import json
import logging
import shutil
import stat
import tempfile
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import Any, Protocol, TypeVar

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..infrastructure.storage.data_loading import (
    detect_file_type,
    is_loadable_file,
)
from ..shared.errors import (
    FileNotFoundError as FileResourceNotFoundError,
    InternalServiceError,
    InvalidInputError,
    NotFoundError,
    ResourceConflictError,
    UnsafePathError,
    UserFileTreeTooLargeError,
    UploadTooLargeError,
)
from ..infrastructure.storage.layout import (
    USER_FILE_IMPORT_STAGING_DIRECTORY,
    validate_display_name,
)
from ..infrastructure.storage.durable_fs import (
    fsync_directory as _fsync_directory,
    fsync_file as _fsync_file,
)
from .storage_admission import StorageAdmissionService, StorageReservation
from .safe_paths import SafePathResolver
from .response_snapshots import ResponseSnapshot, ResponseSnapshotService

_IMPORT_OWNER_MARKER = ".wordflow-import-owner"
T = TypeVar("T")
logger = logging.getLogger(__name__)


class AsyncUploadSource(Protocol):
    """Minimal streaming input accepted from HTTP adapters and tests."""

    async def read(self, size: int) -> bytes: ...


@dataclass(slots=True)
class _UserGate:
    lock: anyio.Lock
    users: int = 0


class UserFileStore:
    """Own all per-user data-file path resolution and mutations."""

    def __init__(
        self,
        user_root: Callable[[str], Path],
        *,
        storage_admission: StorageAdmissionService,
        limiter: anyio.CapacityLimiter,
        all_users_root: Path,
        response_snapshots: ResponseSnapshotService,
        max_upload_bytes: int = 512 * 1024 * 1024,
        max_tree_response_bytes: int = 8 * 1024 * 1024,
        upload_chunk_size: int = 1024 * 1024,
    ) -> None:
        if (
            max_upload_bytes < 1
            or max_tree_response_bytes < 1
            or upload_chunk_size < 1
        ):
            raise ValueError("User File safety limits must be positive")
        self._user_root = user_root
        self._storage_admission = storage_admission
        self._max_upload_bytes = max_upload_bytes
        self._max_tree_response_bytes = max_tree_response_bytes
        self._upload_chunk_size = upload_chunk_size
        self._limiter = limiter
        self._all_users_root = all_users_root
        self._response_snapshots = response_snapshots
        self._user_locks: dict[str, _UserGate] = {}
        self._lock_registry = anyio.Lock()

    async def list_tree(self, user_id: str) -> list[dict[str, Any]]:
        """Return the complete deterministic public User File tree."""

        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            return await self._run_sync(
                _list_tree,
                resolver.root,
                self._max_tree_response_bytes,
            )

    async def resource(self, user_id: str, relative_path: str) -> dict[str, Any]:
        """Return one direct file-or-directory resource without host paths."""

        _require_public_path(relative_path)
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            target = resolver.resolve(relative_path)
            try:
                return await self._run_sync(_file_resource, resolver.root, target)
            except FileNotFoundError as exc:
                raise FileResourceNotFoundError(
                    f"File {relative_path} not found"
                ) from exc

    async def existing_directories(
        self,
        user_id: str,
        relative_paths: list[str],
    ) -> set[str]:
        """Resolve a bounded known set and return exactly the existing folders.

        Used by sample catalogue status projection. This is intentionally not
        a recursive listing API: the caller supplies the server-validated
        collection paths it needs to check, all under one per-user gate.
        """

        if len(relative_paths) > 500:
            raise ValueError("Directory existence query exceeds its bound")
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            existing: set[str] = set()
            for relative_path in relative_paths:
                _require_public_path(relative_path)
                target = resolver.resolve(relative_path)
                if await self._run_sync(_is_real_directory, target):
                    existing.add(relative_path)
            return existing

    async def create_folder(
        self,
        user_id: str,
        *,
        name: str,
        parent_path: str,
    ) -> dict[str, Any]:
        """Create one validated child folder and return its direct resource."""

        is_valid, reason = validate_display_name(name)
        if not is_valid:
            raise InvalidInputError(f"Invalid folder name: {reason}")
        clean_name = name.strip()
        _require_public_path(parent_path)

        reservation = await self._storage_admission.acquire(
            user_id,
            0,
            requested_entries=1,
        )
        try:
            return await self._create_folder_admitted(
                user_id,
                clean_name=clean_name,
                parent_path=parent_path,
            )
        finally:
            with anyio.CancelScope(shield=True):
                await reservation.release()

    async def _create_folder_admitted(
        self,
        user_id: str,
        *,
        clean_name: str,
        parent_path: str,
    ) -> dict[str, Any]:
        """Create the directory after central entry-count admission."""

        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            parent = (
                resolver.root
                if not parent_path.strip()
                else resolver.resolve(parent_path.strip())
            )
            if not await self._run_sync(_is_real_directory, parent):
                raise NotFoundError(f"Folder {parent_path or '.'} not found")
            relative = (
                clean_name
                if parent == resolver.root
                else f"{parent.relative_to(resolver.root).as_posix()}/{clean_name}"
            )
            destination = resolver.resolve(relative)
            if await self._run_sync(destination.exists):
                raise ResourceConflictError(f"Folder {clean_name} already exists")
            try:
                await self._run_sync(_mkdir_checked, resolver, destination)
            except FileExistsError as exc:
                raise ResourceConflictError(
                    f"Folder {clean_name} already exists"
                ) from exc
            except OSError as exc:
                raise InternalServiceError("Failed to create folder") from exc
            return await self._run_sync(_file_resource, resolver.root, destination)

    async def move(
        self,
        user_id: str,
        *,
        source_path: str,
        target_directory_path: str,
    ) -> dict[str, Any]:
        """Move one file without replacing it and return the direct resource."""

        _require_public_path(source_path)
        _require_public_path(target_directory_path)
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            source = resolver.resolve(source_path)
            target_directory = (
                resolver.root
                if not target_directory_path.strip()
                else resolver.resolve(target_directory_path.strip())
            )
            if not await self._run_sync(_is_real_file, source):
                raise FileResourceNotFoundError(f"File {source_path} not found")
            if not await self._run_sync(_is_real_directory, target_directory):
                raise NotFoundError(f"Folder {target_directory_path} not found")
            target_relative = (
                source.name
                if target_directory == resolver.root
                else (
                    f"{target_directory.relative_to(resolver.root).as_posix()}"
                    f"/{source.name}"
                )
            )
            destination = resolver.resolve(target_relative)
            if await self._run_sync(destination.exists):
                raise ResourceConflictError(
                    f"File {destination.name} already exists in destination"
                )
            try:
                await self._run_sync(
                    _move_checked,
                    resolver,
                    source,
                    destination,
                )
            except FileExistsError as exc:
                raise ResourceConflictError(
                    f"File {destination.name} already exists in destination"
                ) from exc
            except OSError as exc:
                raise InternalServiceError("Failed to move file") from exc
            return await self._run_sync(_file_resource, resolver.root, destination)

    async def upload(
        self,
        user_id: str,
        relative_path: str,
        source: AsyncUploadSource,
    ) -> dict[str, int | str]:
        """Reserve quota, then stream through a same-filesystem atomic boundary."""

        reservation = await self._storage_admission.acquire(
            user_id,
            self._max_upload_bytes,
            requested_entries=1,
        )
        try:
            return await self._upload_admitted(
                user_id,
                relative_path,
                source,
                reservation,
            )
        finally:
            with anyio.CancelScope(shield=True):
                await reservation.release()

    async def _upload_admitted(
        self,
        user_id: str,
        relative_path: str,
        source: AsyncUploadSource,
        reservation: StorageReservation,
    ) -> dict[str, int | str]:
        """Write one upload after central storage admission has succeeded."""

        _require_public_path(relative_path)
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            destination = resolver.resolve(relative_path)
            if not await self._run_sync(_is_real_directory, destination.parent):
                raise NotFoundError("Destination folder not found")
            if await self._run_sync(destination.exists):
                raise ResourceConflictError(f"File {destination.name} already exists")

            descriptor, temporary_path = await self._run_sync(
                resolver.create_temporary_file,
                destination,
            )
            total = 0
            descriptor_open = True
            try:
                while True:
                    chunk = await source.read(self._upload_chunk_size)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > self._max_upload_bytes:
                        raise UploadTooLargeError(
                            f"Upload exceeds {self._max_upload_bytes} bytes"
                        )
                    await self._run_sync(_write_all, descriptor, chunk)

                await self._run_sync(os.fsync, descriptor)
                await self._run_sync(os.close, descriptor)
                descriptor_open = False
                await reservation.recheck_path(temporary_path)
                await self._run_sync(resolver.publish_file, temporary_path, destination)
                metadata = await self._run_sync(destination.stat)
                return _file_resource(resolver.root, destination, metadata=metadata)
            finally:
                # Cancellation can arrive while waiting for the next request
                # chunk. Shield cleanup so the same-filesystem temp never
                # survives an interrupted upload.
                with anyio.CancelScope(shield=True):
                    if descriptor_open:
                        try:
                            await self._run_sync(os.close, descriptor)
                        except OSError:
                            logger.warning(
                                "Could not close interrupted User File upload",
                                exc_info=True,
                            )
                    try:
                        if await self._run_sync(temporary_path.exists):
                            await self._run_sync(resolver.delete, temporary_path)
                    except OSError, UnsafePathError:
                        logger.warning(
                            "Could not remove interrupted User File upload path=%s",
                            temporary_path,
                            exc_info=True,
                        )

    async def delete(self, user_id: str, relative_path: str) -> None:
        """Delete exactly one file or directory resource."""

        _require_public_path(relative_path)
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            target = resolver.resolve(relative_path)
            if not await self._run_sync(target.exists):
                raise FileResourceNotFoundError(f"File {relative_path} not found")
            try:
                await self._run_sync(_delete_checked, resolver, target)
            except OSError as exc:
                raise InternalServiceError("Failed to delete file") from exc

    async def response_snapshot(
        self,
        user_id: str,
        relative_path: str,
    ) -> ResponseSnapshot:
        """Snapshot a regular file outside mutable user storage for FileResponse."""

        _require_public_path(relative_path)
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            target = resolver.resolve(relative_path)
            if not await self._run_sync(_is_real_file, target):
                raise FileResourceNotFoundError(f"File {relative_path} not found")
            return await self._response_snapshots.create(target)

    @asynccontextmanager
    async def read_path(
        self,
        user_id: str,
        relative_path: str,
    ) -> AsyncIterator[Path]:
        """Hold the user's file gate while a service snapshots one regular file."""

        _require_public_path(relative_path)
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            target = resolver.resolve(relative_path)
            if not await self._run_sync(_is_real_file, target):
                raise FileResourceNotFoundError(f"File {relative_path} not found")
            yield target

    async def prepare_import_staging(self, user_id: str, import_id: str) -> Path:
        """Create one private same-filesystem directory for a User File Import."""

        try:
            import_id = str(uuid.UUID(import_id))
        except ValueError as exc:
            raise InvalidInputError("Invalid User File Import identifier") from exc
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            staging_root = resolver.root / USER_FILE_IMPORT_STAGING_DIRECTORY
            staging = staging_root / import_id
            try:
                await self._run_sync(
                    _prepare_import_staging, resolver, staging_root, staging
                )
            except FileExistsError as exc:
                raise ResourceConflictError("Import staging already exists") from exc
            return staging

    async def install_import_staging(
        self,
        user_id: str,
        import_id: str,
        destination_path: str,
    ) -> str:
        """Atomically publish one complete import into visible User Files."""

        _require_public_path(destination_path)
        try:
            import_id = str(uuid.UUID(import_id))
        except ValueError as exc:
            raise InvalidInputError("Invalid User File Import identifier") from exc
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            staging = resolver.root / USER_FILE_IMPORT_STAGING_DIRECTORY / import_id
            destination = resolver.resolve(destination_path)
            if await self._run_sync(destination.exists):
                owner = await self._run_sync(_read_import_owner, destination)
                if owner == import_id:
                    return destination.relative_to(resolver.root).as_posix()
                raise ResourceConflictError(
                    f"Destination {destination_path} already exists"
                )
            try:
                await self._run_sync(_fsync_import_staging_tree, staging)
                await self._run_sync(_mark_import_staging, staging, import_id)
                await self._run_sync(
                    _install_import_staging,
                    resolver,
                    staging,
                    destination,
                )
            except FileNotFoundError as exc:
                raise NotFoundError("Import staging is unavailable") from exc
            except FileExistsError as exc:
                raise ResourceConflictError(
                    f"Destination {destination_path} already exists"
                ) from exc
            return destination.relative_to(resolver.root).as_posix()

    async def cleanup_import_staging(self, user_id: str, import_id: str) -> None:
        """Idempotently remove one import's private staging directory."""

        try:
            import_id = str(uuid.UUID(import_id))
        except ValueError:
            return
        async with self._lock_for(user_id):
            resolver = await self._resolver_for(user_id)
            staging_root = resolver.root / USER_FILE_IMPORT_STAGING_DIRECTORY
            staging = staging_root / import_id
            await self._run_sync(_cleanup_import_staging, staging_root, staging)

    async def reconcile_transient_storage(self, active_import_ids: set[str]) -> None:
        """Remove orphan import stages and interrupted upload temp files."""

        await self._run_sync(
            _reconcile_transient_storage,
            self._all_users_root,
            active_import_ids,
        )

    async def _resolver_for(self, user_id: str) -> SafePathResolver:
        """Create/validate the user root inside the runtime I/O limiter."""

        return await self._run_sync(SafePathResolver, self._user_root(user_id))

    @asynccontextmanager
    async def _lock_for(self, user_id: str) -> AsyncIterator[None]:
        """Serialize one user and reclaim its keyed lock after the last waiter."""

        async with self._lock_registry:
            gate = self._user_locks.get(user_id)
            if gate is None:
                gate = _UserGate(anyio.Lock())
                self._user_locks[user_id] = gate
            gate.users += 1
        try:
            async with gate.lock:
                yield
        finally:
            async with self._lock_registry:
                gate.users -= 1
                if gate.users == 0:
                    self._user_locks.pop(user_id, None)

    async def _run_sync(
        self,
        function: Callable[..., T],
        *args: object,
        **kwargs: object,
    ) -> T:
        call = partial(function, *args, **kwargs)
        return await run_sync_in_worker_thread(
            call,
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _is_real_directory(path: Path) -> bool:
    try:
        metadata = path.lstat()
        return not _is_link_or_reparse(metadata) and stat.S_ISDIR(metadata.st_mode)
    except FileNotFoundError:
        return False


def _is_real_file(path: Path) -> bool:
    try:
        metadata = path.lstat()
        return not _is_link_or_reparse(metadata) and stat.S_ISREG(metadata.st_mode)
    except FileNotFoundError:
        return False


def _is_link_or_reparse(metadata: os.stat_result) -> bool:
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    attributes = getattr(metadata, "st_file_attributes", 0)
    return stat.S_ISLNK(metadata.st_mode) or bool(
        reparse_flag and attributes & reparse_flag
    )


def _mkdir_checked(resolver: SafePathResolver, destination: Path) -> None:
    resolver.create_directory(destination)


def _move_checked(
    resolver: SafePathResolver,
    source: Path,
    destination: Path,
) -> None:
    resolver.move_file(source, destination)


def _delete_checked(resolver: SafePathResolver, target: Path) -> None:
    resolver.delete(target)


def _write_all(descriptor: int, content: bytes) -> None:
    view = memoryview(content)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:  # pragma: no cover - defensive OS contract guard
            raise OSError("Upload write made no progress")
        view = view[written:]


def _require_public_path(relative_path: str) -> None:
    """Keep private import staging unreachable through public file operations."""

    normalized = relative_path.replace("\\", "/").strip("/")
    if any(
        part.startswith(".") and part not in {".", ".."}
        for part in normalized.split("/")
        if part
    ):
        raise InvalidInputError("Hidden file paths are reserved")


def _prepare_import_staging(
    resolver: SafePathResolver,
    staging_root: Path,
    staging: Path,
) -> None:
    resolver.recheck_for_write(staging_root)
    staging_root.mkdir(mode=0o700, exist_ok=True)
    resolver.recheck_for_write(staging)
    staging.mkdir(mode=0o700, exist_ok=False)
    _fsync_directory(staging_root)


def _install_import_staging(
    resolver: SafePathResolver,
    staging: Path,
    destination: Path,
) -> None:
    resolver.recheck_for_write(staging)
    if not _is_real_directory(staging):
        raise FileNotFoundError(str(staging))
    if not destination.parent.exists():
        _create_missing_directories(resolver, destination.parent)
    resolver.recheck_for_write(destination)
    if destination.exists():
        raise FileExistsError(destination)
    os.replace(staging, destination)
    _fsync_directory(destination.parent)
    _fsync_directory(staging.parent)
    try:
        staging.parent.rmdir()
    except OSError:
        pass


def _create_missing_directories(
    resolver: SafePathResolver,
    destination: Path,
) -> None:
    """Create every missing parent for a nested atomic import destination."""

    missing: list[Path] = []
    current = destination
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        resolver.recheck_for_write(directory)
        directory.mkdir(mode=0o700, exist_ok=False)
        _fsync_directory(directory.parent)


def _mark_import_staging(staging: Path, import_id: str) -> None:
    """Durably bind a staged directory to its import before publication."""

    if not _is_real_directory(staging):
        raise FileNotFoundError(str(staging))
    marker = staging / _IMPORT_OWNER_MARKER
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{_IMPORT_OWNER_MARKER}.", suffix=".tmp", dir=staging
    )
    try:
        _write_all(descriptor, import_id.encode("ascii"))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    try:
        os.replace(temporary, marker)
        _fsync_directory(staging)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _fsync_import_staging_tree(staging: Path) -> None:
    """Validate and durably flush an entire import before publication."""

    if not _is_real_directory(staging):
        raise FileNotFoundError(str(staging))
    directories: list[Path] = []
    for current_root, directory_names, file_names in os.walk(
        staging,
        topdown=True,
        followlinks=False,
    ):
        current = Path(current_root)
        directories.append(current)
        for name in directory_names:
            child = current / name
            try:
                metadata = child.lstat()
            except FileNotFoundError as exc:
                raise UnsafePathError(
                    "Import staging changed during publication"
                ) from exc
            if _is_link_or_reparse(metadata) or not stat.S_ISDIR(metadata.st_mode):
                raise UnsafePathError("Import staging contains an unsafe directory")
        for name in file_names:
            child = current / name
            try:
                metadata = child.lstat()
            except FileNotFoundError as exc:
                raise UnsafePathError(
                    "Import staging changed during publication"
                ) from exc
            if _is_link_or_reparse(metadata) or not stat.S_ISREG(metadata.st_mode):
                raise UnsafePathError("Import staging contains an unsafe file")
            _fsync_file(child)
    for directory in reversed(directories):
        _fsync_directory(directory)


def _read_import_owner(destination: Path) -> str | None:
    """Recognize only a previously published directory owned by this service."""

    if not _is_real_directory(destination):
        return None
    marker = destination / _IMPORT_OWNER_MARKER
    try:
        metadata = marker.lstat()
        if not stat.S_ISREG(metadata.st_mode) or _is_link_or_reparse(metadata):
            return None
        return marker.read_text(encoding="ascii")
    except OSError, UnicodeError:
        return None


def _cleanup_import_staging(staging_root: Path, staging: Path) -> None:
    if _is_real_directory(staging):
        shutil.rmtree(staging)
        _fsync_directory(staging_root)
    try:
        staging_root.rmdir()
    except OSError:
        pass


def _reconcile_transient_storage(users_root: Path, active_import_ids: set[str]) -> None:
    if not users_root.is_dir() or users_root.is_symlink():
        return
    for user_root in users_root.iterdir():
        data_root = user_root / "files"
        if not data_root.is_dir() or data_root.is_symlink():
            continue
        changed = False
        changed_directories: set[Path] = set()
        for current_root, directory_names, file_names in os.walk(
            data_root,
            topdown=True,
            followlinks=False,
        ):
            current = Path(current_root)
            directory_names[:] = [
                name
                for name in directory_names
                if name != USER_FILE_IMPORT_STAGING_DIRECTORY
                and not (current / name).is_symlink()
            ]
            for name in file_names:
                candidate = current / name
                if name.startswith(".") and name.endswith(".upload"):
                    candidate.unlink(missing_ok=True)
                    changed = True
                    changed_directories.add(current)
        for directory in changed_directories:
            _fsync_directory(directory)
        staging_root = data_root / USER_FILE_IMPORT_STAGING_DIRECTORY
        if not staging_root.is_dir() or staging_root.is_symlink():
            if changed:
                _fsync_directory(data_root)
            continue
        for staging in staging_root.iterdir():
            if staging.is_symlink() or staging.name in active_import_ids:
                continue
            if staging.is_dir():
                shutil.rmtree(staging, ignore_errors=True)
            elif staging.is_file():
                staging.unlink(missing_ok=True)
        _fsync_directory(staging_root)
        try:
            staging_root.rmdir()
            changed = True
        except OSError:
            pass
        if changed:
            _fsync_directory(data_root)


def _list_tree(root: Path, max_response_bytes: int) -> list[dict[str, Any]]:
    """Scan one complete public tree in deterministic depth-first order."""

    resources: list[dict[str, Any]] = []
    serialized_bytes = 2  # JSON array delimiters.

    def visit(directory: Path) -> None:
        nonlocal serialized_bytes
        entries: list[tuple[Path, dict[str, Any]]] = []
        for entry in directory.iterdir():
            if entry.name.startswith("."):
                continue
            try:
                resource = _file_resource(root, entry)
            except FileNotFoundError, UnsafePathError:
                continue
            entries.append((entry, resource))
        entries.sort(key=lambda item: _resource_order_key(item[1]))
        for entry, resource in entries:
            encoded = json.dumps(
                resource,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode("utf-8")
            serialized_bytes += len(encoded) + bool(resources)
            if serialized_bytes > max_response_bytes:
                raise UserFileTreeTooLargeError(
                    "The complete User File tree exceeds the response limit"
                )
            resources.append(resource)
            if resource["type"] == "directory":
                visit(entry)

    visit(root)
    return resources


def _resource_order_key(resource: dict[str, Any]) -> tuple[bool, str, str]:
    """Order directories first, then case-folded names and exact paths."""

    return (
        resource["type"] != "directory",
        str(resource["name"]).casefold(),
        str(resource["path"]),
    )


def _file_resource(
    root: Path,
    path: Path,
    *,
    metadata: os.stat_result | None = None,
) -> dict[str, Any]:
    """Project one real filesystem entry into the canonical public resource."""

    metadata = metadata or path.lstat()
    if _is_link_or_reparse(metadata):
        raise UnsafePathError("File resource contains a link or reparse point")
    relative = path.relative_to(root).as_posix()
    common = {
        "name": path.name,
        "path": relative,
        "modified_at": metadata.st_mtime,
    }
    if stat.S_ISDIR(metadata.st_mode):
        return {
            **common,
            "type": "directory",
            "size_bytes": None,
            "file_type": None,
            "loadable": False,
        }
    if not stat.S_ISREG(metadata.st_mode):
        raise UnsafePathError("File resource is not a regular file or directory")
    file_type = detect_file_type(path.name)
    return {
        **common,
        "type": "file",
        "size_bytes": metadata.st_size,
        "file_type": file_type,
        "loadable": is_loadable_file(path.name),
    }
