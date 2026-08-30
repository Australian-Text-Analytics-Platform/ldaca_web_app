"""Private deep collaborators for Workspace runtime coordination."""

from __future__ import annotations

import logging
import shutil
import stat
import uuid
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any, Literal, TypeVar

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..domain.background import BackgroundState, Progress
from ..domain.events import EventResourceType
from ..domain.workspace import Workspace
from ..domain.workspace.node import PlanHistorySnapshot
from ..infrastructure.storage.durable_fs import fsync_directory, mkdir_durable
from ..infrastructure.storage.layout import (
    workspace_locks_root,
    workspace_staging_root,
    workspaces_root,
)
from ..infrastructure.storage.workspace_access import (
    WorkspaceAccessInvalidError,
    read_workspace_owner,
)
from ..infrastructure.storage.workspace_lock import (
    WorkspaceLockContendedError,
    WorkspaceLockStorageError,
    WorkspaceProcessLock,
    acquire_workspace_lock,
)
from ..infrastructure.storage.workspace_store import (
    WorkspaceCapacityError,
    WorkspaceRevisionConflictError,
    WorkspaceSchemaVersionError,
    WorkspaceSerializationError,
    WorkspaceSnapshotInfo,
    WorkspaceSnapshotInvalidError,
    WorkspaceStore,
)
from ..settings import Settings
from ..shared.errors import (
    BackendCapacityExceededError,
    ResourceTooLargeError,
    WorkspaceConflictError,
    WorkspaceCorruptError,
    WorkspaceInUseError,
    WorkspaceLockUnavailableError,
)
from .events import EventHub
from .storage_admission import StorageAdmissionService, StorageReservation

logger = logging.getLogger(__name__)
T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class WorkspaceRecord:
    """Materialized Workspace resource returned after the gate is released."""

    id: uuid.UUID
    name: str
    description: str
    created_at: datetime
    modified_at: datetime
    total_nodes: int
    root_nodes: int
    leaf_nodes: int
    revision: int
    runtime_state: Literal["closed", "open", "closing"]


@dataclass(frozen=True, slots=True)
class UnavailableWorkspaceRecord:
    """Safely attributable catalogue entry that cannot currently be opened."""

    id: uuid.UUID
    reason: Literal[
        "incompatible_format",
        "corrupt_snapshot",
        "configured_limit",
    ]
    message: str
    name: str | None = None
    description: str | None = None
    created_at: str | None = None
    modified_at: str | None = None
    stored_schema_version: int | None = None
    supported_schema_version: int | None = None


type WorkspaceListRecord = WorkspaceRecord | UnavailableWorkspaceRecord


@dataclass(slots=True)
class _WorkspaceSlot:
    """One transient coordination entry for one Workspace identity."""

    gate: anyio.Lock
    users: int = 0
    workspace: Workspace | None = None
    path: Path | None = None
    revision: int = 0
    serialized_bytes: int = 0
    serialized_entries: int = 0
    closing: bool = False
    process_lock: WorkspaceProcessLock | None = None


@dataclass(slots=True)
class WorkspaceLease:
    """Function-scoped Workspace object protected by one mutation gate."""

    workspace: Workspace
    path: Path
    revision: int
    slot: _WorkspaceSlot
    commit_requested: bool = True
    rollback_paths: list[Path] = field(default_factory=list)
    rollback_analysis_directories: list[Path] = field(default_factory=list)
    commit_cleanup_analysis_directories: list[Path] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class WorkspaceMutationResult[T]:
    """Materialized callback value paired with its committed revision."""

    value: T
    revision: int


def _incompatible_metadata_text(
    error: WorkspaceSchemaVersionError,
    field: str,
) -> str | None:
    metadata = error.workspace_metadata
    value = metadata.get(field) if metadata is not None else None
    return value if isinstance(value, str) else None


class _WorkspaceCatalogue:
    """Own safe filesystem discovery and strict committed snapshot reads."""

    def __init__(self, settings: Settings, store: WorkspaceStore) -> None:
        self._settings = settings
        self._store = store

    def scan_owned_paths(self) -> list[tuple[str, Path]]:
        root = workspaces_root(self._settings)
        mkdir_durable(root)
        paths: list[tuple[str, Path]] = []
        for candidate in root.iterdir():
            if candidate.name.startswith("."):
                continue
            try:
                canonical_id = str(uuid.UUID(candidate.name))
                metadata = candidate.lstat()
                attributes = int(getattr(metadata, "st_file_attributes", 0))
                reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
                if (
                    canonical_id != candidate.name
                    or not stat.S_ISDIR(metadata.st_mode)
                    or stat.S_ISLNK(metadata.st_mode)
                    or attributes & reparse
                ):
                    raise ValueError("Workspace entry is not a canonical directory")
            except OSError, ValueError:
                logger.warning(
                    "Ignoring invalid Workspace catalogue entry name=%s",
                    candidate.name,
                    exc_info=True,
                )
                continue
            try:
                owner_id = read_workspace_owner(candidate)
            except WorkspaceAccessInvalidError:
                logger.warning(
                    "Ignoring unattributable Workspace workspace_id=%s",
                    canonical_id,
                    exc_info=True,
                )
                continue
            paths.append((owner_id, candidate))
        return paths

    def scan_records(self, user_id: str) -> list[WorkspaceListRecord]:
        records: list[WorkspaceRecord] = []
        unavailable: list[UnavailableWorkspaceRecord] = []
        for owner_id, candidate in self.scan_owned_paths():
            if owner_id != user_id:
                continue
            candidate_id = uuid.UUID(candidate.name)
            try:
                snapshot = self._store.inspect(candidate)
                if snapshot.workspace_id != candidate_id:
                    raise WorkspaceSnapshotInvalidError(
                        "Workspace directory and snapshot IDs differ"
                    )
            except WorkspaceSchemaVersionError as exc:
                logger.info(
                    "Catalogue found incompatible owned Workspace "
                    "workspace_id=%s owner_id=%s stored_schema=%s supported_schema=%s",
                    candidate.name,
                    owner_id,
                    exc.stored_version,
                    exc.supported_version,
                )
                unavailable.append(
                    UnavailableWorkspaceRecord(
                        id=candidate_id,
                        reason="incompatible_format",
                        message=(
                            f"Workspace format {exc.stored_version} is incompatible "
                            f"with supported format {exc.supported_version}."
                        ),
                        name=_incompatible_metadata_text(exc, "name"),
                        description=_incompatible_metadata_text(exc, "description"),
                        created_at=_incompatible_metadata_text(exc, "created_at"),
                        modified_at=_incompatible_metadata_text(exc, "modified_at"),
                        stored_schema_version=exc.stored_version,
                        supported_schema_version=exc.supported_version,
                    )
                )
                continue
            except WorkspaceCapacityError:
                logger.warning(
                    "Catalogue found over-limit owned Workspace "
                    "workspace_id=%s owner_id=%s",
                    candidate.name,
                    owner_id,
                    exc_info=True,
                )
                unavailable.append(
                    UnavailableWorkspaceRecord(
                        id=candidate_id,
                        reason="configured_limit",
                        message="Workspace exceeds the configured limits.",
                    )
                )
                continue
            except WorkspaceSnapshotInvalidError:
                logger.error(
                    "Catalogue found corrupt owned Workspace workspace_id=%s owner_id=%s",
                    candidate.name,
                    owner_id,
                    exc_info=True,
                )
                unavailable.append(
                    UnavailableWorkspaceRecord(
                        id=candidate_id,
                        reason="corrupt_snapshot",
                        message="Workspace data is corrupt.",
                    )
                )
                continue
            records.append(
                WorkspaceRecord(
                    id=candidate_id,
                    name=snapshot.name,
                    description=snapshot.description,
                    created_at=snapshot.created_at,
                    modified_at=snapshot.modified_at,
                    total_nodes=snapshot.node_count,
                    root_nodes=snapshot.root_node_count,
                    leaf_nodes=snapshot.leaf_node_count,
                    revision=snapshot.revision,
                    runtime_state="closed",
                )
            )
        records.sort(key=lambda record: record.id)
        records.sort(key=lambda record: record.modified_at, reverse=True)
        unavailable.sort(key=lambda record: record.id)
        return [*records, *unavailable]

    def resolve_owned_path(self, user_id: str, workspace_id: uuid.UUID) -> Path | None:
        path = workspaces_root(self._settings) / str(workspace_id)
        try:
            metadata = path.lstat()
            attributes = int(getattr(metadata, "st_file_attributes", 0))
            reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
            if (
                not stat.S_ISDIR(metadata.st_mode)
                or stat.S_ISLNK(metadata.st_mode)
                or attributes & reparse
            ):
                raise WorkspaceAccessInvalidError(
                    "Workspace path is not a safe directory"
                )
            owner_id = read_workspace_owner(path)
        except FileNotFoundError:
            return None
        except OSError, WorkspaceAccessInvalidError:
            logger.warning(
                "Workspace direct lookup found invalid ownership workspace_id=%s",
                workspace_id,
                exc_info=True,
            )
            return None
        return path if owner_id == user_id else None

    def inspect(self, path: Path) -> WorkspaceSnapshotInfo:
        try:
            return self._store.inspect(path)
        except (WorkspaceSnapshotInvalidError, WorkspaceCapacityError) as exc:
            raise WorkspaceCorruptError(
                "Workspace data is corrupt",
                details={"workspace_id": path.name},
            ) from exc

    def load(self, path: Path) -> tuple[Workspace, int, int]:
        try:
            loaded = self._store.load(path)
        except (WorkspaceSnapshotInvalidError, WorkspaceCapacityError) as exc:
            raise WorkspaceCorruptError(
                "Workspace data is corrupt",
                details={"workspace_id": path.name},
            ) from exc
        return (
            loaded.workspace,
            loaded.snapshot.revision,
            loaded.snapshot.serialized_bytes,
        )


class _WorkspaceResidency:
    """Own in-process residency capacity, gates, and cross-process locks."""

    def __init__(
        self,
        settings: Settings,
        io_limiter: anyio.CapacityLimiter,
    ) -> None:
        self._settings = settings
        self._io_limiter = io_limiter
        self._slots: dict[uuid.UUID, _WorkspaceSlot] = {}
        self._slot_registry_lock = anyio.Lock()
        self._capacity_lock = anyio.Lock()
        self._open_capacity_limit = (
            settings.max_open_workspace_bytes if settings.multi_user else None
        )
        self._open_capacity_bytes = 0

    async def run_io(
        self,
        function: Callable[..., T],
        *args: Any,
        **kwargs: Any,
    ) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args, **kwargs),
            abandon_on_cancel=False,
            limiter=self._io_limiter,
        )

    @asynccontextmanager
    async def slot(self, workspace_id: uuid.UUID) -> AsyncIterator[_WorkspaceSlot]:
        async with self._slot_registry_lock:
            slot = self._slots.get(workspace_id)
            if slot is None:
                slot = _WorkspaceSlot(anyio.Lock())
                self._slots[workspace_id] = slot
            slot.users += 1
        try:
            async with slot.gate:
                yield slot
        finally:
            async with self._slot_registry_lock:
                slot.users -= 1
                if (
                    slot.users == 0
                    and slot.workspace is None
                    and not slot.closing
                    and slot.process_lock is None
                ):
                    self._slots.pop(workspace_id, None)

    @staticmethod
    def runtime_state(
        slot: _WorkspaceSlot,
    ) -> Literal["closed", "open", "closing"]:
        if slot.closing:
            return "closing"
        return "open" if slot.workspace is not None else "closed"

    async def reserve_capacity(self, requested_bytes: int) -> None:
        if requested_bytes <= 0 or self._open_capacity_limit is None:
            return
        async with self._capacity_lock:
            if self._open_capacity_bytes + requested_bytes > self._open_capacity_limit:
                raise BackendCapacityExceededError()
            self._open_capacity_bytes += requested_bytes

    async def release_capacity(self, released_bytes: int) -> None:
        if released_bytes <= 0 or self._open_capacity_limit is None:
            return
        async with self._capacity_lock:
            self._open_capacity_bytes = max(
                0,
                self._open_capacity_bytes - released_bytes,
            )

    async def clear(self, slot: _WorkspaceSlot) -> None:
        released = slot.serialized_bytes
        process_lock = slot.process_lock
        slot.workspace = None
        slot.path = None
        slot.revision = 0
        slot.serialized_bytes = 0
        slot.serialized_entries = 0
        slot.closing = False
        slot.process_lock = None
        with anyio.CancelScope(shield=True):
            await self.release_capacity(released)
            if process_lock is not None:
                await self.run_io(process_lock.close)

    async def acquire_process_lock(
        self,
        workspace_id: uuid.UUID,
    ) -> WorkspaceProcessLock:
        try:
            return await self.run_io(
                acquire_workspace_lock,
                workspace_locks_root(self._settings),
                str(workspace_id),
            )
        except WorkspaceLockContendedError as exc:
            raise WorkspaceInUseError() from exc
        except WorkspaceLockStorageError as exc:
            raise WorkspaceLockUnavailableError() from exc

    async def runtime_states(
        self,
    ) -> dict[uuid.UUID, Literal["open", "closing"]]:
        async with self._slot_registry_lock:
            return {
                workspace_id: "closing" if slot.closing else "open"
                for workspace_id, slot in self._slots.items()
                if slot.workspace is not None
            }

    async def close(self) -> None:
        async with self._slot_registry_lock:
            slots = list(self._slots.values())
        for slot in slots:
            async with slot.gate:
                await self.clear(slot)
        async with self._slot_registry_lock:
            self._slots.clear()


def _remove_rollback_paths(paths: list[Path]) -> None:
    parents: set[Path] = set()
    for path in paths:
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISREG(metadata.st_mode) and not path.is_symlink():
            path.unlink()
            parents.add(path.parent)
    for parent in parents:
        fsync_directory(parent)


def _remove_analysis_directories(paths: list[Path], workspace_root: Path) -> None:
    resolved_root = workspace_root.resolve(strict=True)
    parents: set[Path] = set()
    for path in paths:
        try:
            relative = path.resolve(strict=True).relative_to(resolved_root)
            analysis_id = str(uuid.UUID(relative.parts[1]))
            metadata = path.lstat()
        except FileNotFoundError, OSError, ValueError, IndexError:
            continue
        if (
            len(relative.parts) != 3
            or relative.parts[:2] != ("analyses", analysis_id)
            or relative.parts[2] not in {"artifacts", "query-input", "staged-output"}
            or not stat.S_ISDIR(metadata.st_mode)
            or path.is_symlink()
        ):
            continue
        shutil.rmtree(path)
        parents.add(path.parent)
    for parent in parents:
        fsync_directory(parent)


def _remove_private_entry(path: Path) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISDIR(metadata.st_mode) and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)


class _WorkspaceMutationCommitter:
    """Own staged snapshot commit, in-memory rollback, and cleanup."""

    def __init__(
        self,
        settings: Settings,
        store: WorkspaceStore,
        storage_admission: StorageAdmissionService,
        residency: _WorkspaceResidency,
        catalogue: _WorkspaceCatalogue,
    ) -> None:
        self._settings = settings
        self._store = store
        self._storage_admission = storage_admission
        self._residency = residency
        self._catalogue = catalogue

    @staticmethod
    def entry_count(
        *,
        node_count: int,
        tab_count: int,
        analysis_count: int,
    ) -> int:
        return (
            1
            + node_count
            + int(node_count > 0)
            + 2 * tab_count
            + int(tab_count > 0)
            + 2 * analysis_count
            + int(analysis_count > 0)
        )

    def _stage_snapshot(
        self,
        staging: Path,
        workspace: Workspace,
        revision: int,
    ) -> WorkspaceSnapshotInfo:
        try:
            return self._store.stage_snapshot(staging, workspace, revision=revision)
        except WorkspaceCapacityError as exc:
            raise ResourceTooLargeError("Workspace snapshot exceeds its limit") from exc
        except WorkspaceSerializationError as exc:
            raise WorkspaceCorruptError(
                "Workspace data could not be persisted",
                details={"workspace_id": str(workspace.id)},
            ) from exc

    async def persist(self, user_id: str, lease: WorkspaceLease) -> int:
        old_bytes = lease.slot.serialized_bytes
        old_entries = lease.slot.serialized_entries
        next_revision = lease.revision + 1
        lease.workspace.modified_at = datetime.now(UTC)
        staging = workspace_staging_root(self._settings) / (
            f".snapshot-{lease.workspace.id}-{uuid.uuid4().hex}"
        )
        transient = await self._storage_admission.acquire_transient(
            self._settings.max_workspace_snapshot_bytes
        )
        durable: StorageReservation | None = None
        reserved_capacity = 0
        try:
            staged = await self._residency.run_io(
                self._stage_snapshot,
                staging,
                lease.workspace,
                next_revision,
            )
            with anyio.CancelScope(shield=True):
                await transient.release()

            growth = max(0, staged.serialized_bytes - old_bytes)
            staged_entries = self.entry_count(
                node_count=staged.node_count,
                tab_count=staged.tab_count,
                analysis_count=staged.analysis_count,
            )
            entry_growth = max(0, staged_entries - old_entries)
            durable = await self._storage_admission.acquire(
                user_id,
                growth,
                requested_entries=entry_growth,
            )
            reserved_capacity = growth
            await self._residency.reserve_capacity(reserved_capacity)
            await durable.recheck_estimate(growth, requested_entries=entry_growth)
            try:
                committed = await self._residency.run_io(
                    self._store.commit_staged,
                    lease.path,
                    staging,
                    expected_revision=lease.revision,
                )
            except WorkspaceRevisionConflictError as exc:
                raise WorkspaceConflictError(
                    "Workspace persistence changed outside its mutation boundary",
                    details={
                        "expected_revision": exc.expected,
                        "actual_revision": exc.actual,
                    },
                ) from exc
            except WorkspaceSerializationError as exc:
                raise WorkspaceCorruptError(
                    "Workspace data could not be persisted",
                    details={"workspace_id": str(lease.workspace.id)},
                ) from exc

            lease.revision = committed.revision
            lease.slot.revision = committed.revision
            lease.slot.workspace = lease.workspace
            lease.slot.path = lease.path
            lease.slot.serialized_bytes = committed.serialized_bytes
            lease.slot.serialized_entries = self.entry_count(
                node_count=committed.node_count,
                tab_count=committed.tab_count,
                analysis_count=committed.analysis_count,
            )
            if committed.serialized_bytes < old_bytes:
                await self._residency.release_capacity(
                    old_bytes - committed.serialized_bytes
                )
            return committed.revision
        except BaseException:
            if reserved_capacity:
                await self._residency.release_capacity(reserved_capacity)
            raise
        finally:
            with anyio.CancelScope(shield=True):
                await transient.release()
                if durable is not None:
                    await durable.release()
                await self._residency.run_io(_remove_private_entry, staging)

    async def rollback(
        self,
        lease: WorkspaceLease,
        node_histories: Mapping[uuid.UUID, PlanHistorySnapshot],
    ) -> None:
        await self._residency.run_io(_remove_rollback_paths, lease.rollback_paths)
        await self._residency.run_io(
            _remove_analysis_directories,
            lease.rollback_analysis_directories,
            lease.path,
        )
        await self._restore(lease.slot, lease.path, node_histories=node_histories)

    async def _restore(
        self,
        slot: _WorkspaceSlot,
        path: Path,
        *,
        node_histories: Mapping[uuid.UUID, PlanHistorySnapshot],
    ) -> None:
        previous_bytes = slot.serialized_bytes
        closing = slot.closing
        try:
            workspace, revision, serialized_bytes = await self._residency.run_io(
                self._catalogue.load,
                path,
            )
            if serialized_bytes > previous_bytes:
                await self._residency.reserve_capacity(serialized_bytes - previous_bytes)
            elif serialized_bytes < previous_bytes:
                await self._residency.release_capacity(previous_bytes - serialized_bytes)
            for node_id, history in node_histories.items():
                node = workspace.nodes.get(node_id)
                if node is not None:
                    node.restore_plan_history(history)
        except BaseException:
            logger.exception(
                "Failed to restore Workspace after rejected mutation workspace_id=%s",
                path.name,
            )
            await self._residency.clear(slot)
            return
        slot.workspace = workspace
        slot.path = path
        slot.revision = revision
        slot.serialized_bytes = serialized_bytes
        slot.serialized_entries = self.entry_count(
            node_count=len(workspace.nodes),
            tab_count=len(workspace.tabs),
            analysis_count=(
                len(workspace.analyses) + len(workspace.corrupt_analysis_ids)
            ),
        )
        slot.closing = closing

    async def cleanup_committed(self, lease: WorkspaceLease) -> None:
        lease.rollback_paths.clear()
        lease.rollback_analysis_directories.clear()
        if not lease.commit_cleanup_analysis_directories:
            return
        try:
            await self._residency.run_io(
                _remove_analysis_directories,
                lease.commit_cleanup_analysis_directories,
                lease.path,
            )
        except OSError:
            logger.exception("Could not remove committed Workspace staging directories")
        lease.commit_cleanup_analysis_directories.clear()


class _WorkspaceEventPublisher:
    """Own durable Workspace event diffs and best-effort publication."""

    def __init__(self, events: EventHub) -> None:
        self._events = events

    async def publish_mutation(
        self,
        user_id: str,
        workspace: Workspace,
        revision: int,
        *,
        before_tabs: dict[uuid.UUID, int],
        before_analyses: dict[uuid.UUID, int],
        before_corrupt: set[uuid.UUID],
    ) -> None:
        """Publish only after the complete Workspace generation is durable."""

        workspace_id = workspace.id
        await self.changed(
            user_id,
            EventResourceType.WORKSPACE,
            workspace_id,
            revision=revision,
            workspace_id=workspace_id,
        )

        after_tabs = {tab_id: tab.revision for tab_id, tab in workspace.tabs.items()}
        for tab_id in sorted(after_tabs):
            if before_tabs.get(tab_id) == after_tabs[tab_id]:
                continue
            await self.changed(
                user_id,
                EventResourceType.TAB,
                tab_id,
                revision=after_tabs[tab_id],
                workspace_id=workspace_id,
            )
        for tab_id in sorted(before_tabs.keys() - after_tabs.keys()):
            await self.removed(
                user_id,
                EventResourceType.TAB,
                tab_id,
                workspace_id=workspace_id,
                revision=before_tabs[tab_id],
            )

        after_live = workspace.live_analysis_ids()
        after_analyses = {
            analysis_id: record
            for analysis_id, record in workspace.analyses.items()
            if analysis_id in after_live
        }
        for analysis_id in sorted(after_analyses):
            record = after_analyses[analysis_id]
            if before_analyses.get(analysis_id) == record.revision:
                continue
            await self.changed(
                user_id,
                EventResourceType.ANALYSIS,
                record.id,
                revision=record.revision,
                workspace_id=workspace_id,
                state=record.state,
                progress=record.progress,
            )
        removed_analyses = (before_analyses.keys() | before_corrupt) - after_live
        for analysis_id in sorted(removed_analyses):
            await self.removed(
                user_id,
                EventResourceType.ANALYSIS,
                analysis_id,
                workspace_id=workspace_id,
                revision=before_analyses.get(analysis_id),
            )

    async def changed(
        self,
        user_id: str,
        resource_type: EventResourceType,
        resource_id: uuid.UUID,
        *,
        revision: int,
        workspace_id: uuid.UUID | None = None,
        state: BackgroundState | None = None,
        progress: Progress | None = None,
    ) -> None:
        try:
            await self._events.publish_changed(
                user_id,
                resource_type,
                resource_id,
                revision=revision,
                workspace_id=workspace_id,
                state=state,
                progress=progress,
            )
        except Exception:
            logger.exception(
                "Could not publish committed resource event resource_type=%s "
                "resource_id=%s user_id=%s",
                resource_type,
                resource_id,
                user_id,
            )

    async def removed(
        self,
        user_id: str,
        resource_type: EventResourceType,
        resource_id: uuid.UUID,
        *,
        workspace_id: uuid.UUID | None = None,
        revision: int | None = None,
    ) -> None:
        try:
            await self._events.publish_removed(
                user_id,
                resource_type,
                resource_id,
                workspace_id=workspace_id,
                revision=revision,
            )
        except Exception:
            logger.exception(
                "Could not publish resource removal resource_type=%s "
                "resource_id=%s user_id=%s",
                resource_type,
                resource_id,
                user_id,
            )

    async def runtime_state(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        runtime_state: Literal["closed", "open", "closing"],
    ) -> None:
        try:
            await self._events.publish_workspace_runtime(
                user_id,
                workspace_id,
                runtime_state,
            )
        except Exception:
            logger.exception(
                "Could not publish Workspace runtime event workspace_id=%s user_id=%s",
                workspace_id,
                user_id,
            )

    async def analysis_progress(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        analysis_id: uuid.UUID,
        progress: Progress,
    ) -> None:
        try:
            await self._events.publish_progress(
                user_id,
                EventResourceType.ANALYSIS,
                analysis_id,
                progress,
                workspace_id=workspace_id,
            )
        except Exception:
            logger.exception(
                "Could not publish Analysis progress analysis_id=%s user_id=%s",
                analysis_id,
                user_id,
            )
