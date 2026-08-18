"""Workspace catalogue, explicit open state, and persistence service.

Used by:
- workspace HTTP routes, Analysis completion handlers, archive import, and sidecar
  stores that must share one mutation boundary;
- ``Runtime``, which owns exactly one instance per FastAPI application.

The filesystem is the only durable Workspace catalogue. Every direct lookup
validates the UUID-named global directory and its exact ``access.json`` owner;
list operations rescan that directory and isolate corruption per entry.
"""

from __future__ import annotations

import logging
import os
import shutil
import stat
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any, Literal, TypeVar, cast

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread
from ..domain.workspace import AnalysisKind, Tab, Workspace
from ..domain.workspace.node import PlanHistorySnapshot
from ..domain.events import EventResourceType
from ..domain.background import BackgroundState, Progress
from ..infrastructure.storage.workspace_store import (
    TabSnapshotInvalidError,
    WorkspaceCapacityError,
    WorkspaceRevisionConflictError,
    WorkspaceSchemaVersionError,
    WorkspaceSerializationError,
    WorkspaceSnapshotInfo,
    WorkspaceSnapshotInvalidError,
    WorkspaceStore,
)
from ..infrastructure.storage.workspace_access import (
    WorkspaceAccessInvalidError,
    read_workspace_owner,
    write_workspace_owner,
)

from ..shared.errors import (
    BackendCapacityExceededError,
    InvalidInputError,
    InvalidWorkspaceArchiveError,
    ResourceTooLargeError,
    TabCorruptError,
    TabNotFoundError,
    WorkspaceConflictError,
    WorkspaceClosingError,
    WorkspaceCorruptError,
    WorkspaceNotFoundError,
    WorkspaceNotOpenError,
)
from ..settings import Settings
from ..shared.json_data import JsonData
from ..models.workspace import (
    WorkspaceNodeReorderRequest,
    WorkspaceUpdateRequest,
)
from ..models.tabs import TabCreate, TabUpdate
from ..models.analysis_results import TopicModelingStoredResult
from ..infrastructure.storage.layout import (
    NODE_SOURCE_STAGING_PREFIX,
    NODE_SOURCE_STAGING_SUFFIX,
    SAFE_WORKSPACE_IMPORT_MARKER,
    SAFE_WORKSPACE_IMPORT_MARKER_CONTENT,
    validate_display_name,
    workspace_staging_root,
    workspace_trash_root,
    workspaces_root,
)
from ..infrastructure.storage.durable_fs import (
    fsync_directory as _fsync_directory,
    mkdir_durable as _mkdir_durable,
)
from ..workers.input_snapshots import rebase_worker_input_snapshot_sources
from .storage_admission import StorageAdmissionService, StorageReservation
from .events import EventHub

T = TypeVar("T")
logger = logging.getLogger(__name__)
WorkspaceReconciler = Callable[[Workspace], bool]


@dataclass(frozen=True, slots=True)
class WorkspaceRecord:
    """Materialized workspace resource returned after the gate is released."""

    id: str
    name: str
    description: str
    created_at: str
    modified_at: str
    total_nodes: int
    root_nodes: int
    leaf_nodes: int
    revision: int
    runtime_state: Literal["closed", "open", "closing"]


@dataclass(frozen=True, slots=True)
class UnavailableWorkspaceRecord:
    """Safely attributable catalogue entry that cannot currently be opened."""

    id: str
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


def _incompatible_metadata_text(
    error: WorkspaceSchemaVersionError,
    field: str,
) -> str | None:
    """Read one descriptive text field without weakening the load gate."""

    metadata = error.workspace_metadata
    value = metadata.get(field) if metadata is not None else None
    return value if isinstance(value, str) else None


WorkspaceListRecord = WorkspaceRecord | UnavailableWorkspaceRecord


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


@dataclass(slots=True)
class WorkspaceLease:
    """Function-scoped workspace object protected by one mutation gate."""

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


def _cleanup_abandoned_node_staging(workspace_path: Path) -> None:
    """Remove only the private temp files used for source-node publication.

    Called during workspace discovery. A crash before ``os.replace`` leaves no
    graph reference to these files, so deleting them is both safe and necessary
    before the workspace can be used again.
    """

    data_root = workspace_path / "data"
    if not data_root.is_dir() or data_root.is_symlink():
        return
    changed = False
    for candidate in data_root.iterdir():
        if not (
            candidate.name.startswith(NODE_SOURCE_STAGING_PREFIX)
            and candidate.name.endswith(NODE_SOURCE_STAGING_SUFFIX)
        ):
            continue
        try:
            metadata = candidate.lstat()
        except FileNotFoundError:
            continue
        reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        attributes = getattr(metadata, "st_file_attributes", 0)
        if not (
            stat.S_ISREG(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or bool(reparse and attributes & reparse)
        ):
            continue
        candidate.unlink(missing_ok=True)
        changed = True
    if changed:
        _fsync_directory(data_root)


def _remove_rollback_paths(paths: list[Path]) -> None:
    """Remove files published by a mutation whose metadata commit failed."""

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
        _fsync_directory(parent)


def _remove_rollback_analysis_directories(
    paths: list[Path],
    workspace_root: Path,
) -> None:
    """Remove newly published private Analysis directories after commit failure."""

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
        _fsync_directory(parent)


def _remove_private_entry(path: Path) -> None:
    """Remove one backend-owned staging or trash entry without following links."""

    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISDIR(metadata.st_mode) and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)


def _cleanup_workspace_service_temps(root: Path) -> None:
    """Discard interrupted staging/trash work and private node temp files."""

    _mkdir_durable(root)
    staging_root = root / ".staging"
    trash_root = root / ".trash"
    _mkdir_durable(staging_root)
    _mkdir_durable(trash_root)
    for private_root in (staging_root, trash_root):
        changed = False
        for candidate in private_root.iterdir():
            _remove_private_entry(candidate)
            changed = True
        if changed:
            _fsync_directory(private_root)

    for candidate in root.iterdir():
        if candidate.name.startswith("."):
            continue
        try:
            canonical_id = str(uuid.UUID(candidate.name))
            metadata = candidate.lstat()
        except OSError, ValueError:
            continue
        attributes = int(getattr(metadata, "st_file_attributes", 0))
        reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
        if (
            canonical_id == candidate.name
            and stat.S_ISDIR(metadata.st_mode)
            and not stat.S_ISLNK(metadata.st_mode)
            and not attributes & reparse
        ):
            _cleanup_abandoned_node_staging(candidate)


class WorkspaceService:
    """Only owner of Workspace open state, mutation, and persistence.

    The service deliberately has no FastAPI imports. Routes resolve it from the
    lifespan ``Runtime`` and must materialize response models inside the read or
    mutation scope. Completion handlers call ``mutate_workspace`` on the app
    event loop; worker processes never acquire these locks. A closed Workspace
    is never loaded implicitly.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        store: WorkspaceStore,
        storage_admission: StorageAdmissionService,
        events: EventHub,
        io_limiter: anyio.CapacityLimiter,
    ) -> None:
        self.settings = settings
        self._store = store
        self._storage_admission = storage_admission
        self._events = events
        self._io_limiter = io_limiter
        self._slots: dict[str, _WorkspaceSlot] = {}
        self._slot_registry_lock = anyio.Lock()
        self._capacity_lock = anyio.Lock()
        self._open_capacity_limit = (
            settings.max_open_workspace_bytes if settings.multi_user else None
        )
        self._open_capacity_bytes = 0
        self._accepting_mutations = True

    @asynccontextmanager
    async def admit_storage(
        self,
        user_id: str,
        requested_bytes: int,
        *,
        requested_entries: int = 0,
    ) -> AsyncIterator[None]:
        """Reserve declared workspace growth before a completion writer starts."""

        reservation = await self._storage_admission.acquire(
            user_id,
            requested_bytes,
            requested_entries=requested_entries,
        )
        try:
            yield
        finally:
            with anyio.CancelScope(shield=True):
                await reservation.release()

    @asynccontextmanager
    async def _slot(self, workspace_id: str) -> AsyncIterator[_WorkspaceSlot]:
        """Serialize one Workspace and discard an idle closed coordination slot."""

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
                if slot.users == 0 and slot.workspace is None and not slot.closing:
                    self._slots.pop(workspace_id, None)

    @staticmethod
    def _runtime_state(
        slot: _WorkspaceSlot,
    ) -> Literal["closed", "open", "closing"]:
        if slot.closing:
            return "closing"
        return "open" if slot.workspace is not None else "closed"

    async def _reserve_open_capacity(self, requested_bytes: int) -> None:
        if requested_bytes <= 0 or self._open_capacity_limit is None:
            return
        async with self._capacity_lock:
            if self._open_capacity_bytes + requested_bytes > self._open_capacity_limit:
                raise BackendCapacityExceededError()
            self._open_capacity_bytes += requested_bytes

    async def _release_open_capacity(self, released_bytes: int) -> None:
        if released_bytes <= 0 or self._open_capacity_limit is None:
            return
        async with self._capacity_lock:
            self._open_capacity_bytes = max(
                0,
                self._open_capacity_bytes - released_bytes,
            )

    async def _clear_slot(self, slot: _WorkspaceSlot) -> None:
        """Release one loaded aggregate while its gate is held."""

        released = slot.serialized_bytes
        slot.workspace = None
        slot.path = None
        slot.revision = 0
        slot.serialized_bytes = 0
        slot.serialized_entries = 0
        slot.closing = False
        await self._release_open_capacity(released)

    @staticmethod
    def _snapshot_entry_count(
        *,
        node_count: int,
        tab_count: int,
        analysis_count: int,
    ) -> int:
        """Count snapshot-owned files and directories used for quota estimates."""

        return (
            1
            + node_count
            + int(node_count > 0)
            + 2 * tab_count
            + int(tab_count > 0)
            + 2 * analysis_count
            + int(analysis_count > 0)
        )

    async def _runtime_states(
        self,
    ) -> dict[str, Literal["open", "closing"]]:
        async with self._slot_registry_lock:
            states: dict[str, Literal["open", "closing"]] = {}
            for workspace_id, slot in self._slots.items():
                if slot.workspace is not None:
                    states[workspace_id] = "closing" if slot.closing else "open"
            return states

    def workspace_staging_root(self) -> Path:
        """Return the private same-filesystem archive/creation staging root."""

        return workspace_staging_root(self.settings)

    async def _run_io(
        self,
        function: Callable[..., T],
        *args: Any,
        **kwargs: Any,
    ) -> T:
        """Run blocking persistence without abandoning a cancelled writer."""

        return await run_sync_in_worker_thread(
            partial(function, *args, **kwargs),
            abandon_on_cancel=False,
            limiter=self._io_limiter,
        )

    def _scan_owned_paths_sync(self) -> list[tuple[str, Path]]:
        """Return safe attributed Workspace paths from one isolated scan."""

        root = workspaces_root(self.settings)
        _mkdir_durable(root)
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

    def _scan_records_sync(self, user_id: str) -> list[WorkspaceListRecord]:
        """Materialize available and safely attributable unavailable entries."""

        records: list[WorkspaceRecord] = []
        unavailable: list[UnavailableWorkspaceRecord] = []
        for owner_id, candidate in self._scan_owned_paths_sync():
            if owner_id != user_id:
                continue
            try:
                snapshot = self._store.inspect(candidate)
                if snapshot.workspace_id != candidate.name:
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
                        id=candidate.name,
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
                        id=candidate.name,
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
                        id=candidate.name,
                        reason="corrupt_snapshot",
                        message="Workspace data is corrupt.",
                    )
                )
                continue
            records.append(
                WorkspaceRecord(
                    id=candidate.name,
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
        records.sort(key=lambda record: record.modified_at or "", reverse=True)
        unavailable.sort(key=lambda record: record.id)
        return [*records, *unavailable]

    def _resolve_owned_path_sync(
        self,
        user_id: str,
        workspace_id: str,
    ) -> Path | None:
        """Resolve one live path after exact identity and owner validation."""

        try:
            canonical_id = str(uuid.UUID(workspace_id))
        except ValueError:
            return None
        if canonical_id != workspace_id:
            return None
        path = workspaces_root(self.settings) / workspace_id
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

    async def _path(self, user_id: str, workspace_id: str) -> Path | None:
        return await self._run_io(
            self._resolve_owned_path_sync,
            user_id,
            workspace_id,
        )

    def _load_sync(self, path: Path) -> tuple[Workspace, int, int]:
        """Load one already-located committed workspace without disk mutation."""

        try:
            loaded = self._store.load(path)
        except TabSnapshotInvalidError as exc:
            raise self._tab_corrupt(exc) from exc
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

    @staticmethod
    def _tab_corrupt(exc: TabSnapshotInvalidError) -> TabCorruptError:
        details: dict[str, JsonData] | None = (
            {"tab_id": exc.tab_id} if exc.tab_id is not None else None
        )
        return TabCorruptError("Tab data is corrupt", details=details)

    async def _require_open(
        self,
        slot: _WorkspaceSlot,
        user_id: str,
        workspace_id: str,
        *,
        allow_closing: bool,
    ) -> WorkspaceLease:
        """Validate ownership and return the sole explicitly open aggregate."""

        path = await self._path(user_id, workspace_id)
        if path is None:
            if slot.workspace is not None:
                await self._clear_slot(slot)
            raise WorkspaceNotFoundError("Workspace not found")
        if slot.workspace is None or slot.path is None:
            raise WorkspaceNotOpenError("Workspace is not open")
        if slot.closing and not allow_closing:
            raise WorkspaceClosingError("Workspace is closing")
        if slot.path != path:
            await self._clear_slot(slot)
            raise WorkspaceNotFoundError("Workspace not found")
        return WorkspaceLease(slot.workspace, path, slot.revision, slot)

    def _save_sync(
        self,
        path: Path,
        workspace: Workspace,
        expected_revision: int | None,
        touch_modified: bool = True,
    ) -> WorkspaceSnapshotInfo:
        """Persist a workspace after an optimistic disk revision check."""

        path_was_present = path.exists()
        _mkdir_durable(path)
        if not path_was_present:
            _fsync_directory(path.parent)
        if touch_modified:
            workspace.modified_at = datetime.now(UTC).isoformat()
        try:
            snapshot = self._store.commit(
                path,
                workspace,
                expected_revision=expected_revision,
            )
        except TabSnapshotInvalidError as exc:
            raise self._tab_corrupt(exc) from exc
        except WorkspaceRevisionConflictError as exc:
            raise WorkspaceConflictError(
                "Workspace revision is stale",
                details={
                    "expected_revision": exc.expected,
                    "actual_revision": exc.actual,
                },
            ) from exc
        except WorkspaceCapacityError as exc:
            raise ResourceTooLargeError("Workspace snapshot exceeds its limit") from exc
        except WorkspaceSerializationError as exc:
            raise WorkspaceCorruptError(
                "Workspace data could not be persisted",
                details={"workspace_id": workspace.id},
            ) from exc
        return snapshot

    def _stage_snapshot_sync(
        self,
        staging: Path,
        workspace: Workspace,
        revision: int,
    ) -> WorkspaceSnapshotInfo:
        try:
            return self._store.stage_snapshot(
                staging,
                workspace,
                revision=revision,
            )
        except WorkspaceCapacityError as exc:
            raise ResourceTooLargeError("Workspace snapshot exceeds its limit") from exc
        except WorkspaceSerializationError as exc:
            raise WorkspaceCorruptError(
                "Workspace data could not be persisted",
                details={"workspace_id": workspace.id},
            ) from exc

    async def _persist(self, user_id: str, lease: WorkspaceLease) -> int:
        """Stage, admit, and atomically publish one exact next generation."""

        old_bytes = lease.slot.serialized_bytes
        old_entries = lease.slot.serialized_entries
        next_revision = lease.revision + 1
        lease.workspace.modified_at = datetime.now(UTC).isoformat()
        staging = workspace_staging_root(self.settings) / (
            f".snapshot-{lease.workspace.id}-{uuid.uuid4().hex}"
        )
        transient = await self._storage_admission.acquire_transient(
            self.settings.max_workspace_snapshot_bytes
        )
        durable: StorageReservation | None = None
        reserved_capacity = 0
        try:
            staged = await self._run_io(
                self._stage_snapshot_sync,
                staging,
                lease.workspace,
                next_revision,
            )
            with anyio.CancelScope(shield=True):
                await transient.release()

            growth = max(0, staged.serialized_bytes - old_bytes)
            staged_entries = self._snapshot_entry_count(
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
            await self._reserve_open_capacity(reserved_capacity)
            await durable.recheck_estimate(
                growth,
                requested_entries=entry_growth,
            )
            try:
                committed = await self._run_io(
                    self._store.commit_staged,
                    lease.path,
                    staging,
                    expected_revision=lease.revision,
                )
            except TabSnapshotInvalidError as exc:
                raise self._tab_corrupt(exc) from exc
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
                    details={"workspace_id": lease.workspace.id},
                ) from exc

            lease.revision = committed.revision
            lease.slot.revision = committed.revision
            lease.slot.workspace = lease.workspace
            lease.slot.path = lease.path
            lease.slot.serialized_bytes = committed.serialized_bytes
            lease.slot.serialized_entries = self._snapshot_entry_count(
                node_count=committed.node_count,
                tab_count=committed.tab_count,
                analysis_count=committed.analysis_count,
            )
            if committed.serialized_bytes < old_bytes:
                await self._release_open_capacity(
                    old_bytes - committed.serialized_bytes
                )
            return committed.revision
        except BaseException:
            if reserved_capacity:
                await self._release_open_capacity(reserved_capacity)
            raise
        finally:
            with anyio.CancelScope(shield=True):
                await transient.release()
                if durable is not None:
                    await durable.release()
                await self._run_io(_remove_private_entry, staging)

    @staticmethod
    def materialize_record(
        workspace: Workspace,
        revision: int,
        runtime_state: Literal["closed", "open", "closing"],
    ) -> WorkspaceRecord:
        """Copy a live workspace into an immutable response-safe record."""

        nodes = list(workspace.nodes.values())
        return WorkspaceRecord(
            id=workspace.id,
            name=workspace.name,
            description=workspace.description or "",
            created_at=workspace.created_at,
            modified_at=workspace.modified_at,
            total_nodes=len(nodes),
            root_nodes=sum(1 for node in nodes if not node.parents),
            leaf_nodes=sum(1 for node in nodes if not node.children),
            revision=revision,
            runtime_state=runtime_state,
        )

    async def _publish_mutation_events(
        self,
        user_id: str,
        lease: WorkspaceLease,
        *,
        before_tabs: dict[str, int],
        before_analyses: dict[str, int],
        before_corrupt: set[str],
    ) -> None:
        """Publish only after the complete Workspace generation is durable."""

        workspace_id = uuid.UUID(lease.workspace.id)
        await self._publish_changed(
            user_id,
            EventResourceType.WORKSPACE,
            workspace_id,
            revision=lease.revision,
            workspace_id=workspace_id,
        )

        after_tabs = {
            tab_id: tab.revision for tab_id, tab in lease.workspace.tabs.items()
        }
        for tab_id in sorted(after_tabs):
            if before_tabs.get(tab_id) == after_tabs[tab_id]:
                continue
            await self._publish_changed(
                user_id,
                EventResourceType.TAB,
                uuid.UUID(tab_id),
                revision=after_tabs[tab_id],
                workspace_id=workspace_id,
            )
        for tab_id in sorted(before_tabs.keys() - after_tabs.keys()):
            await self._publish_removed(
                user_id,
                EventResourceType.TAB,
                uuid.UUID(tab_id),
                workspace_id=workspace_id,
                revision=before_tabs[tab_id],
            )

        after_live = lease.workspace.live_analysis_ids()
        after_analyses = {
            analysis_id: record
            for analysis_id, record in lease.workspace.analyses.items()
            if analysis_id in after_live
        }
        for analysis_id in sorted(after_analyses):
            record = after_analyses[analysis_id]
            if before_analyses.get(analysis_id) == record.revision:
                continue
            await self._publish_changed(
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
            await self._publish_removed(
                user_id,
                EventResourceType.ANALYSIS,
                uuid.UUID(analysis_id),
                workspace_id=workspace_id,
                revision=before_analyses.get(analysis_id),
            )

    async def _publish_changed(
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

    async def _publish_removed(
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

    async def _publish_runtime_state(
        self,
        user_id: str,
        workspace_id: str,
        runtime_state: Literal["closed", "open", "closing"],
    ) -> None:
        try:
            await self._events.publish_workspace_runtime(
                user_id,
                uuid.UUID(workspace_id),
                runtime_state,
            )
        except Exception:
            logger.exception(
                "Could not publish Workspace runtime event workspace_id=%s user_id=%s",
                workspace_id,
                user_id,
            )

    async def publish_analysis_progress(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        progress: Progress,
    ) -> None:
        """Publish one non-durable live Analysis progress hint."""

        try:
            await self._events.publish_progress(
                user_id,
                EventResourceType.ANALYSIS,
                uuid.UUID(analysis_id),
                progress,
                workspace_id=uuid.UUID(workspace_id),
            )
        except Exception:
            logger.exception(
                "Could not publish Analysis progress analysis_id=%s user_id=%s",
                analysis_id,
                user_id,
            )

    @staticmethod
    def _record_from_snapshot(
        snapshot: WorkspaceSnapshotInfo,
        runtime_state: Literal["closed", "open", "closing"],
    ) -> WorkspaceRecord:
        return WorkspaceRecord(
            id=snapshot.workspace_id,
            name=snapshot.name,
            description=snapshot.description,
            created_at=snapshot.created_at,
            modified_at=snapshot.modified_at,
            total_nodes=snapshot.node_count,
            root_nodes=snapshot.root_node_count,
            leaf_nodes=snapshot.leaf_node_count,
            revision=snapshot.revision,
            runtime_state=runtime_state,
        )

    async def update_metadata(
        self,
        user_id: str,
        workspace_id: str,
        request: WorkspaceUpdateRequest,
    ) -> WorkspaceRecord:
        """Validate and commit one partial workspace metadata update."""

        async with self.mutation_context(user_id, workspace_id) as lease:
            changed = False
            if "name" in request.model_fields_set:
                assert request.name is not None
                normalized_name = request.name.strip()
                valid, reason = validate_display_name(normalized_name)
                if not valid:
                    raise InvalidInputError(f"Invalid workspace name: {reason}")
                if lease.workspace.name != normalized_name:
                    lease.workspace.name = normalized_name
                    changed = True
            if "description" in request.model_fields_set:
                description = (request.description or "").strip()
                if lease.workspace.description != description:
                    lease.workspace.description = description
                    changed = True
            lease.commit_requested = changed
        return self.materialize_record(
            lease.workspace,
            lease.revision,
            self._runtime_state(lease.slot),
        )

    async def reorder_nodes(
        self,
        user_id: str,
        workspace_id: str,
        request: WorkspaceNodeReorderRequest,
    ) -> WorkspaceRecord:
        """Validate and commit one exact duplicate-free node ordering."""

        async with self.mutation_context(user_id, workspace_id) as lease:
            current_ids = list(lease.workspace.nodes)
            ordered_ids = [str(node_id) for node_id in request.ordered_ids]
            if (
                len(ordered_ids) != len(set(ordered_ids))
                or len(ordered_ids) != len(current_ids)
                or set(ordered_ids) != set(current_ids)
            ):
                raise InvalidInputError(
                    "ordered_ids must be an exact duplicate-free permutation of workspace nodes"
                )
            changed = ordered_ids != current_ids
            if changed:
                lease.workspace.reorder_nodes(ordered_ids)
            lease.commit_requested = changed
        return self.materialize_record(
            lease.workspace,
            lease.revision,
            self._runtime_state(lease.slot),
        )

    async def list_tabs(self, user_id: str, workspace_id: str) -> list[Tab]:
        """Return the complete deterministic Tab collection from an open Workspace."""

        async with self.read_context(user_id, workspace_id) as lease:
            tabs = sorted(
                lease.workspace.tabs.values(),
                key=lambda tab: (tab.created_at, str(tab.id)),
            )
            return [tab.model_copy(deep=True) for tab in tabs]

    async def get_tab(
        self,
        user_id: str,
        workspace_id: str,
        tab_id: str,
    ) -> Tab:
        """Return one exact Tab without exposing the mutable aggregate object."""

        async with self.read_context(user_id, workspace_id) as lease:
            tab = lease.workspace.tabs.get(tab_id)
            if tab is None:
                raise TabNotFoundError("Tab not found")
            return tab.model_copy(deep=True)

    async def create_tab(
        self,
        user_id: str,
        workspace_id: str,
        request: TabCreate,
    ) -> Tab:
        """Create one backend-identified Tab and commit it with the Workspace."""

        async with self.mutation_context(user_id, workspace_id) as lease:
            tab = Tab.create(
                kind=request.kind,
                name=request.name,
                timestamp=datetime.now(UTC),
            )
            lease.workspace.add_tab(tab)
            resource = tab.model_copy(deep=True)
        return resource

    async def update_tab(
        self,
        user_id: str,
        workspace_id: str,
        tab_id: str,
        request: TabUpdate,
    ) -> Tab:
        """Update mutable Tab presentation state."""

        async with self.mutation_context(user_id, workspace_id) as lease:
            tab = lease.workspace.tabs.get(tab_id)
            if tab is None:
                raise TabNotFoundError("Tab not found")
            changed = False
            if request.name is not None and tab.name != request.name:
                tab.name = request.name
                changed = True
            if (
                request.annotation_correction_columns is not None
                and tab.annotation_correction_columns
                != request.annotation_correction_columns
            ):
                if tab.kind is not AnalysisKind.ANNOTATION:
                    raise InvalidInputError(
                        "Correction columns belong only to Annotation Tabs"
                    )
                for node_id, column in request.annotation_correction_columns.items():
                    node = lease.workspace.nodes.get(str(node_id))
                    if node is None or column not in await self._run_io(
                        node.data.collect_schema
                    ):
                        raise InvalidInputError(
                            "Annotation correction column is unavailable"
                        )
                tab.annotation_correction_columns = (
                    request.annotation_correction_columns
                )
                changed = True
            if request.stop_words is not None:
                if tab.kind not in {
                    AnalysisKind.TOKEN_FREQUENCY,
                    AnalysisKind.TOPIC_MODELING,
                }:
                    raise InvalidInputError(
                        "Stop words belong only to Token Frequency and Topic Modelling Tabs"
                    )
                if tab.stop_words != request.stop_words:
                    tab.stop_words = request.stop_words
                    changed = True
            if "topic_modeling_words_per_topic" in request.model_fields_set:
                if tab.kind is not AnalysisKind.TOPIC_MODELING:
                    raise InvalidInputError(
                        "Words per topic belongs only to Topic Modelling Tabs"
                    )
                if request.topic_modeling_words_per_topic is None:
                    raise InvalidInputError(
                        "Topic Modelling Tabs require a word display count"
                    )
                if (
                    tab.topic_modeling_words_per_topic
                    != request.topic_modeling_words_per_topic
                ):
                    tab.topic_modeling_words_per_topic = (
                        request.topic_modeling_words_per_topic
                    )
                    changed = True
            if "topic_modeling_cluster_selection" in request.model_fields_set:
                if tab.kind is not AnalysisKind.TOPIC_MODELING:
                    raise InvalidInputError(
                        "Topic cluster selection belongs only to Topic Modelling Tabs"
                    )
                selection = request.topic_modeling_cluster_selection
                if selection is not None:
                    record = lease.workspace.analyses.get(str(selection.analysis_id))
                    if (
                        record is None
                        or record.tab_id != tab.id
                        or record.state is not BackgroundState.SUCCEEDED
                        or record.request.kind != "topic_modeling"
                        or record.result_payload is None
                    ):
                        raise InvalidInputError(
                            "Topic cluster selection Analysis is unavailable"
                        )
                    stored = TopicModelingStoredResult.model_validate(
                        record.result_payload
                    )
                    if not (
                        stored.clustering.min_cluster_count
                        <= selection.cluster_count
                        <= stored.clustering.max_cluster_count
                    ):
                        raise InvalidInputError(
                            "Topic cluster selection is outside the supported range"
                        )
                if tab.topic_modeling_cluster_selection != selection:
                    tab.topic_modeling_cluster_selection = selection
                    changed = True
            if changed:
                tab.modified_at = datetime.now(UTC)
                tab.revision += 1
            else:
                lease.commit_requested = False
            resource = tab.model_copy(deep=True)
        return resource

    async def create_workspace(
        self, user_id: str, name: str, description: str = ""
    ) -> WorkspaceRecord:
        """Stage and atomically publish one globally catalogued Workspace."""

        is_valid, reason = validate_display_name(name)
        if not is_valid:
            raise InvalidInputError(f"Invalid workspace name: {reason}")
        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")

        workspace_id = str(uuid.uuid4())
        async with self._slot(workspace_id):
            root = workspaces_root(self.settings)
            path = root / workspace_id
            staging = workspace_staging_root(self.settings) / (
                f"{workspace_id}-{uuid.uuid4().hex}"
            )
            reservation = await self._storage_admission.acquire(
                user_id,
                self.settings.max_workspace_snapshot_bytes,
                requested_entries=2,
            )
            try:
                workspace = Workspace(name=name.strip())
                workspace.id = workspace_id
                workspace.description = description
                workspace.created_at = datetime.now(UTC).isoformat()
                workspace.modified_at = workspace.created_at
                await self._run_io(self._save_sync, staging, workspace, None, False)
                await self._run_io(write_workspace_owner, staging, user_id)
                await reservation.recheck_path(staging)
                await self._run_io(os.replace, staging, path)
                await self._run_io(_fsync_directory, root)
            except BaseException:
                await self._run_io(shutil.rmtree, staging, True)
                raise
            finally:
                with anyio.CancelScope(shield=True):
                    await reservation.release()
            resource = self.materialize_record(workspace, 1, "closed")
        await self._publish_changed(
            user_id,
            EventResourceType.WORKSPACE,
            uuid.UUID(workspace_id),
            revision=resource.revision,
            workspace_id=uuid.UUID(workspace_id),
        )
        return resource

    @asynccontextmanager
    async def read_context(
        self, user_id: str, workspace_id: str
    ) -> AsyncIterator[WorkspaceLease]:
        """Read one explicitly open Workspace, including while it closes."""

        async with self._slot(workspace_id) as slot:
            yield await self._require_open(
                slot,
                user_id,
                workspace_id,
                allow_closing=True,
            )

    @asynccontextmanager
    async def submission_context(
        self,
        user_id: str,
        workspace_id: str,
    ) -> AsyncIterator[WorkspaceLease]:
        """Snapshot new work only while the Workspace is fully open."""

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        async with self._slot(workspace_id) as slot:
            yield await self._require_open(
                slot,
                user_id,
                workspace_id,
                allow_closing=False,
            )

    async def ensure_open(self, user_id: str, workspace_id: str) -> None:
        """Validate child-resource access without leaking the aggregate."""

        async with self.read_context(user_id, workspace_id):
            return

    async def ensure_accepting_work(self, user_id: str, workspace_id: str) -> None:
        """Admit one new-work request before it snapshots independent inputs."""

        async with self.submission_context(user_id, workspace_id):
            return

    @asynccontextmanager
    async def mutation_context(
        self,
        user_id: str,
        workspace_id: str,
        *,
        internal: bool = False,
    ) -> AsyncIterator[WorkspaceLease]:
        """Commit one narrow mutation before releasing the Workspace gate.

        Internal completion commands may finish already-admitted work while a
        Workspace is closing. External commands have no such exception.
        """

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        async with self._slot(workspace_id) as slot:
            lease = await self._require_open(
                slot,
                user_id,
                workspace_id,
                allow_closing=internal,
            )
            before_tabs = {
                tab_id: tab.revision for tab_id, tab in lease.workspace.tabs.items()
            }
            before_live = lease.workspace.live_analysis_ids()
            before_analyses = {
                analysis_id: record.revision
                for analysis_id, record in lease.workspace.analyses.items()
                if analysis_id in before_live
            }
            before_corrupt = lease.workspace.corrupt_analysis_ids & before_live
            before_node_histories = {
                node_id: node.snapshot_plan_history()
                for node_id, node in lease.workspace.nodes.items()
            }
            try:
                yield lease
                if lease.commit_requested:
                    with anyio.CancelScope(shield=True):
                        await self._persist(user_id, lease)
            except BaseException:
                with anyio.CancelScope(shield=True):
                    await self._run_io(_remove_rollback_paths, lease.rollback_paths)
                    await self._run_io(
                        _remove_rollback_analysis_directories,
                        lease.rollback_analysis_directories,
                        lease.path,
                    )
                    await self._restore_slot(
                        slot,
                        lease.path,
                        node_histories=before_node_histories,
                    )
                raise
            else:
                lease.rollback_paths.clear()
                lease.rollback_analysis_directories.clear()
                if lease.commit_requested:
                    await self._publish_mutation_events(
                        user_id,
                        lease,
                        before_tabs=before_tabs,
                        before_analyses=before_analyses,
                        before_corrupt=before_corrupt,
                    )
                if lease.commit_cleanup_analysis_directories:
                    try:
                        await self._run_io(
                            _remove_rollback_analysis_directories,
                            lease.commit_cleanup_analysis_directories,
                            lease.path,
                        )
                    except OSError:
                        logger.exception(
                            "Could not remove committed Workspace staging directories"
                        )
                    lease.commit_cleanup_analysis_directories.clear()

    async def _restore_slot(
        self,
        slot: _WorkspaceSlot,
        path: Path,
        *,
        node_histories: Mapping[str, PlanHistorySnapshot],
    ) -> None:
        """Reload committed state after an in-memory command fails."""

        previous_bytes = slot.serialized_bytes
        closing = slot.closing
        try:
            workspace, revision, serialized_bytes = await self._run_io(
                self._load_sync,
                path,
            )
            if serialized_bytes > previous_bytes:
                await self._reserve_open_capacity(serialized_bytes - previous_bytes)
            elif serialized_bytes < previous_bytes:
                await self._release_open_capacity(previous_bytes - serialized_bytes)
            for node_id, history in node_histories.items():
                node = workspace.nodes.get(node_id)
                if node is not None:
                    node.restore_plan_history(history)
        except BaseException:
            logger.exception(
                "Failed to restore Workspace after rejected mutation workspace_id=%s",
                path.name,
            )
            await self._clear_slot(slot)
            return
        slot.workspace = workspace
        slot.path = path
        slot.revision = revision
        slot.serialized_bytes = serialized_bytes
        slot.serialized_entries = self._snapshot_entry_count(
            node_count=len(workspace.nodes),
            tab_count=len(workspace.tabs),
            analysis_count=(
                len(workspace.analyses) + len(workspace.corrupt_analysis_ids)
            ),
        )
        slot.closing = closing

    async def mutate_workspace(
        self,
        user_id: str,
        workspace_id: str,
        mutation: Callable[[Workspace], T],
        *,
        internal: bool = False,
    ) -> WorkspaceMutationResult[T]:
        """Apply one synchronous domain mutation and commit it exactly once."""

        async with self.mutation_context(
            user_id,
            workspace_id,
            internal=internal,
        ) as lease:
            value = mutation(lease.workspace)
        return WorkspaceMutationResult(value=value, revision=lease.revision)

    def _inspect_sync(self, path: Path) -> WorkspaceSnapshotInfo:
        try:
            return self._store.inspect(path)
        except (WorkspaceSnapshotInvalidError, WorkspaceCapacityError) as exc:
            raise WorkspaceCorruptError(
                "Workspace data is corrupt",
                details={"workspace_id": path.name},
            ) from exc

    async def open_workspace(
        self,
        user_id: str,
        workspace_id: str,
    ) -> WorkspaceRecord:
        """Idempotently load one Workspace through its explicit open boundary."""

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        async with self._slot(workspace_id) as slot:
            path = await self._path(user_id, workspace_id)
            if path is None:
                raise WorkspaceNotFoundError("Workspace not found")
            if slot.workspace is not None:
                if slot.path != path:
                    await self._clear_slot(slot)
                    raise WorkspaceNotFoundError("Workspace not found")
                state_changed = slot.closing
                slot.closing = False
                resource = self.materialize_record(
                    slot.workspace,
                    slot.revision,
                    "open",
                )
            else:
                snapshot = await self._run_io(self._inspect_sync, path)
                reserved_bytes = snapshot.serialized_bytes
                await self._reserve_open_capacity(reserved_bytes)
                try:
                    workspace, revision, serialized_bytes = await self._run_io(
                        self._load_sync,
                        path,
                    )
                    if serialized_bytes > reserved_bytes:
                        await self._reserve_open_capacity(
                            serialized_bytes - reserved_bytes
                        )
                        reserved_bytes = serialized_bytes
                    elif serialized_bytes < reserved_bytes:
                        await self._release_open_capacity(
                            reserved_bytes - serialized_bytes
                        )
                        reserved_bytes = serialized_bytes
                except BaseException:
                    await self._release_open_capacity(reserved_bytes)
                    raise
                if revision != snapshot.revision:
                    await self._release_open_capacity(reserved_bytes)
                    raise WorkspaceCorruptError(
                        "Workspace changed while it was opening",
                        details={"workspace_id": workspace_id},
                    )
                slot.workspace = workspace
                slot.path = path
                slot.revision = revision
                slot.serialized_bytes = serialized_bytes
                slot.serialized_entries = self._snapshot_entry_count(
                    node_count=len(workspace.nodes),
                    tab_count=len(workspace.tabs),
                    analysis_count=(
                        len(workspace.analyses) + len(workspace.corrupt_analysis_ids)
                    ),
                )
                slot.closing = False
                resource = self.materialize_record(workspace, revision, "open")
                state_changed = True
        if state_changed:
            await self._publish_runtime_state(user_id, workspace_id, "open")
        return resource

    async def get_workspace(self, user_id: str, workspace_id: str) -> WorkspaceRecord:
        """Read lightweight metadata without implicitly opening the Workspace."""

        async with self._slot(workspace_id) as slot:
            path = await self._path(user_id, workspace_id)
            if path is None:
                raise WorkspaceNotFoundError("Workspace not found")
            snapshot = await self._run_io(self._inspect_sync, path)
            return self._record_from_snapshot(snapshot, self._runtime_state(slot))

    async def list_workspaces(self, user_id: str) -> list[WorkspaceListRecord]:
        """Freshly scan metadata and overlay only transient runtime state."""

        records = await self._run_io(self._scan_records_sync, user_id)
        states = await self._runtime_states()
        return [
            (
                WorkspaceRecord(
                    id=record.id,
                    name=record.name,
                    description=record.description,
                    created_at=record.created_at,
                    modified_at=record.modified_at,
                    total_nodes=record.total_nodes,
                    root_nodes=record.root_nodes,
                    leaf_nodes=record.leaf_nodes,
                    revision=record.revision,
                    runtime_state=states.get(record.id, "closed"),
                )
                if isinstance(record, WorkspaceRecord)
                else record
            )
            for record in records
        ]

    async def resolve_workspace_dir(self, user_id: str, workspace_id: str) -> Path:
        """Resolve storage for one open or closing Workspace."""

        async with self._slot(workspace_id) as slot:
            lease = await self._require_open(
                slot,
                user_id,
                workspace_id,
                allow_closing=True,
            )
            return lease.path

    async def resolve_owned_workspace_dir(
        self,
        user_id: str,
        workspace_id: str,
    ) -> Path:
        """Resolve one owned Workspace directory without opening its snapshot."""

        path = await self._path(user_id, workspace_id)
        if path is None:
            raise WorkspaceNotFoundError("Workspace not found")
        return path

    async def request_close(
        self,
        user_id: str,
        workspace_id: str,
        has_active_work: Callable[[str, str], Awaitable[bool]],
    ) -> WorkspaceRecord | None:
        """Close immediately or mark the loaded aggregate for deferred close."""

        async with self._slot(workspace_id) as slot:
            path = await self._path(user_id, workspace_id)
            if path is None:
                raise WorkspaceNotFoundError("Workspace not found")
            if slot.workspace is None:
                return None
            if slot.path != path:
                await self._clear_slot(slot)
                raise WorkspaceNotFoundError("Workspace not found")
            if slot.closing:
                return self.materialize_record(
                    slot.workspace,
                    slot.revision,
                    "closing",
                )
            if await has_active_work(user_id, workspace_id):
                slot.closing = True
                resource = self.materialize_record(
                    slot.workspace,
                    slot.revision,
                    "closing",
                )
                await self._publish_runtime_state(user_id, workspace_id, "closing")
                return resource
            await self._clear_slot(slot)
            await self._publish_runtime_state(user_id, workspace_id, "closed")
            return None

    async def finalize_close_if_idle(
        self,
        user_id: str,
        workspace_id: str,
        has_active_work: Callable[[str, str], Awaitable[bool]],
    ) -> None:
        """Remove a closing aggregate after its final admitted runner drains."""

        async with self._slot(workspace_id) as slot:
            if not slot.closing or slot.workspace is None:
                return
            if await has_active_work(user_id, workspace_id):
                return
            await self._clear_slot(slot)
            await self._publish_runtime_state(user_id, workspace_id, "closed")

    @asynccontextmanager
    async def deletion_context(
        self,
        user_id: str,
        workspace_id: str,
    ) -> AsyncIterator[None]:
        """Validate and hold the workspace gate through referential deletion.

        ``WorkspaceLifecycleService`` stops private Analysis execution while
        this context excludes new submission and completion. The directory is
        removed only after that cancellation signal succeeds.
        """

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        async with self._slot(workspace_id) as slot:
            path = await self._path(user_id, workspace_id)
            if path is None:
                raise WorkspaceNotFoundError("Workspace not found")
            yield
            await self._run_io(
                self._delete_sync,
                path,
                workspace_trash_root(self.settings),
            )
            revision = slot.revision or None
            await self._clear_slot(slot)
            await self._publish_removed(
                user_id,
                EventResourceType.WORKSPACE,
                uuid.UUID(workspace_id),
                workspace_id=uuid.UUID(workspace_id),
                revision=revision,
            )

    @staticmethod
    def _delete_sync(path: Path, trash_root: Path) -> None:
        """Atomically make a workspace unreachable before recursive cleanup."""

        root = path.parent
        _mkdir_durable(trash_root)
        trash = trash_root / f"{path.name}-{uuid.uuid4()}"
        os.replace(path, trash)
        _fsync_directory(root)
        shutil.rmtree(trash, ignore_errors=True)
        _fsync_directory(trash_root)

    async def install_staged_archive(
        self,
        user_id: str,
        staging: Path,
        workspace_name: str,
        reservation: StorageReservation,
    ) -> dict[str, JsonData]:
        """Atomically install a validated archive as one closed Workspace.

        Called only by ``WorkspaceArchiveService`` after bounded extraction.
        Final identity assignment and publication share the new Workspace's
        gate. Import never opens an existing or newly installed aggregate.
        """

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        workspace_id = str(uuid.uuid4())
        async with self._slot(workspace_id):
            destination = workspaces_root(self.settings) / workspace_id
            await self._run_io(
                self._prepare_staged_import_sync,
                user_id,
                staging,
                workspace_id,
                workspace_name,
                destination,
            )
            await reservation.recheck_path(staging)
            record = await self._run_io(
                self._publish_staged_import_sync,
                staging,
                destination,
            )
            resource = cast(dict[str, JsonData], asdict(record))
        await self._publish_changed(
            user_id,
            EventResourceType.WORKSPACE,
            uuid.UUID(workspace_id),
            revision=record.revision,
            workspace_id=uuid.UUID(workspace_id),
        )
        return resource

    def _prepare_staged_import_sync(
        self,
        user_id: str,
        staging: Path,
        workspace_id: str,
        workspace_name: str,
        destination: Path,
    ) -> None:
        """Validate and finalize imported bytes before quota publication."""

        root = workspaces_root(self.settings)
        _mkdir_durable(root)
        staging_root = workspace_staging_root(self.settings)
        _mkdir_durable(staging_root)
        resolved_staging = staging.resolve(strict=True)
        if (
            resolved_staging.parent != staging_root.resolve(strict=True)
            or staging.is_symlink()
        ):
            raise InvalidInputError("Invalid workspace import staging path")
        if destination.exists():
            raise WorkspaceConflictError("Workspace identifier already exists")

        marker = staging / SAFE_WORKSPACE_IMPORT_MARKER
        try:
            marker_metadata = marker.lstat()
            marker_content = marker.read_text(encoding="ascii")
        except (OSError, UnicodeError) as exc:
            raise InvalidWorkspaceArchiveError(
                "Workspace import was not compiled from safe materialized data"
            ) from exc
        if (
            marker.is_symlink()
            or not stat.S_ISREG(marker_metadata.st_mode)
            or marker_content != SAFE_WORKSPACE_IMPORT_MARKER_CONTENT
        ):
            raise InvalidWorkspaceArchiveError(
                "Workspace import was not compiled from safe materialized data"
            )
        imported_at = datetime.now(UTC).isoformat()
        self._store.prepare_import_identity(
            staging,
            workspace_id=workspace_id,
            name=workspace_name,
            revision=1,
            timestamp=imported_at,
        )
        # Load before installation so malformed workspace snapshots never
        # become addressable resources.
        self._store.load(staging)

        write_workspace_owner(staging, user_id)
        marker.unlink()
        _fsync_directory(staging)

    def _publish_staged_import_sync(
        self,
        staging: Path,
        destination: Path,
    ) -> WorkspaceRecord:
        """Publish one quota-approved import and validate its relocated plans."""

        root = workspaces_root(self.settings)
        os.replace(staging, destination)
        _fsync_directory(root)
        try:
            self._store.rebase_snapshot_sources(destination)
            loaded = self._store.load(destination)
            for record in loaded.workspace.analyses.values():
                if record.query_snapshot is not None:
                    rebase_worker_input_snapshot_sources(
                        destination / record.query_snapshot.relative_path,
                        workspace_id=loaded.workspace.id,
                    )
            workspace, revision, _serialized_bytes = self._load_sync(destination)
            _fsync_directory(destination)
        except BaseException:
            shutil.rmtree(destination, ignore_errors=True)
            _fsync_directory(root)
            raise
        return self.materialize_record(workspace, revision, "closed")

    async def close(self) -> None:
        """Reject mutations and release every clean open aggregate at shutdown.

        Every mutation is committed before its gate is released, so open
        workspaces are never dirty and shutdown must not invent a new revision.
        Runtime calls this only after Analysis completions have drained.
        """

        self._accepting_mutations = False
        async with self._slot_registry_lock:
            slots = list(self._slots.values())
        for slot in slots:
            async with slot.gate:
                await self._clear_slot(slot)
        async with self._slot_registry_lock:
            self._slots.clear()

    async def reconcile_transient_storage(self) -> None:
        """Remove archive/delete crash leftovers once, before serving requests."""

        await self._run_io(
            _cleanup_workspace_service_temps,
            workspaces_root(self.settings),
        )

    async def reconcile_durable_workspaces(
        self,
        reconcile: WorkspaceReconciler,
    ) -> None:
        """Apply one startup-only domain reconciliation to every valid Workspace.

        Each Workspace is loaded and committed independently without becoming
        open. Corrupt or concurrently changed entries are isolated so one
        owner's data cannot block reconciliation for another owner.
        """

        paths = await self._run_io(self._scan_owned_paths_sync)
        for owner_id, path in paths:
            async with self._slot(path.name) as slot:
                if slot.workspace is not None:
                    raise RuntimeError(
                        "Durable Workspace reconciliation must run before serving"
                    )
                try:
                    workspace, revision, _serialized_bytes = await self._run_io(
                        self._load_sync,
                        path,
                    )
                    if not reconcile(workspace):
                        continue
                    await self._run_io(
                        self._save_sync,
                        path,
                        workspace,
                        revision,
                    )
                except (
                    OSError,
                    ResourceTooLargeError,
                    TabCorruptError,
                    WorkspaceConflictError,
                    WorkspaceCorruptError,
                ):
                    logger.exception(
                        "Workspace startup reconciliation failed "
                        "workspace_id=%s owner_id=%s",
                        path.name,
                        owner_id,
                    )
