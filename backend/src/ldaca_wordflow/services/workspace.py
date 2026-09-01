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
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, TypeVar, cast

import anyio
from ..domain.workspace import (
    AnnotationTabSettings,
    Tab,
    TabResource,
    TokenFrequencyTabSettings,
    TopicModelingTabSettings,
    UnavailableTab,
    Workspace,
)
from ..domain.events import EventResourceType
from ..domain.background import BackgroundState, Progress
from ..infrastructure.storage.workspace_store import (
    WorkspaceCapacityError,
    WorkspaceRevisionConflictError,
    WorkspaceSerializationError,
    WorkspaceSnapshotInfo,
    WorkspaceStore,
)
from ..infrastructure.storage.workspace_access import write_workspace_owner

from ..shared.errors import (
    InvalidInputError,
    InvalidWorkspaceArchiveError,
    ResourceTooLargeError,
    TabNotFoundError,
    WorkspaceConflictError,
    WorkspaceClosingError,
    WorkspaceCorruptError,
    WorkspaceInUseError,
    WorkspaceLockUnavailableError,
    WorkspaceNotFoundError,
    WorkspaceNotOpenError,
)
from ..settings import Settings
from ..shared.json_data import JsonData
from ..models.workspace import (
    WorkspaceNodeReorderRequest,
    WorkspaceUpdateRequest,
)
from ..models.tabs import (
    AnnotationTabUpdate,
    TabCreate,
    TabUpdate,
    TokenFrequencyTabUpdate,
    TopicModelingTabUpdate,
)
from ..models.analysis_results import TopicModelingStoredResult
from ..infrastructure.storage.layout import (
    NODE_SOURCE_STAGING_PREFIX,
    NODE_SOURCE_STAGING_SUFFIX,
    SAFE_WORKSPACE_IMPORT_MARKER,
    SAFE_WORKSPACE_IMPORT_MARKER_CONTENT,
    validate_workspace_name,
    workspace_staging_root,
    workspace_trash_root,
    workspaces_root,
)
from ..infrastructure.storage.durable_fs import (
    fsync_directory as _fsync_directory,
    mkdir_durable as _mkdir_durable,
)
from ..infrastructure.storage.input_snapshots import (
    rebase_worker_input_snapshot_sources,
)
from .storage_admission import StorageAdmissionService, StorageReservation
from .events import EventHub
from .workspace_coordination import (
    UnavailableWorkspaceRecord as UnavailableWorkspaceRecord,
    WorkspaceLease,
    WorkspaceListRecord,
    WorkspaceMutationResult,
    WorkspaceRecord,
    _WorkspaceCatalogue,
    _WorkspaceEventPublisher,
    _WorkspaceMutationCommitter,
    _WorkspaceResidency,
    _WorkspaceSlot,
)

T = TypeVar("T")
logger = logging.getLogger(__name__)
WorkspaceReconciler = Callable[[Workspace], bool]


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
        self._event_publisher = _WorkspaceEventPublisher(events)
        self._catalogue = _WorkspaceCatalogue(settings, store)
        self._residency = _WorkspaceResidency(settings, io_limiter)
        self._mutation_committer = _WorkspaceMutationCommitter(
            settings,
            store,
            storage_admission,
            self._residency,
            self._catalogue,
        )
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

    def workspace_staging_root(self) -> Path:
        """Return the private same-filesystem archive/creation staging root."""

        return workspace_staging_root(self.settings)

    async def _path(self, user_id: str, workspace_id: uuid.UUID) -> Path | None:
        return await self._residency.run_io(
            self._catalogue.resolve_owned_path,
            user_id,
            workspace_id,
        )

    async def _require_open(
        self,
        slot: _WorkspaceSlot,
        user_id: str,
        workspace_id: uuid.UUID,
        *,
        allow_closing: bool,
    ) -> WorkspaceLease:
        """Validate ownership and return the sole explicitly open aggregate."""

        path = await self._path(user_id, workspace_id)
        if path is None:
            if slot.workspace is not None:
                await self._residency.clear(slot)
            raise WorkspaceNotFoundError("Workspace not found")
        if slot.workspace is None or slot.path is None:
            raise WorkspaceNotOpenError("Workspace is not open")
        if slot.closing and not allow_closing:
            raise WorkspaceClosingError("Workspace is closing")
        if slot.path != path:
            await self._residency.clear(slot)
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
            workspace.modified_at = datetime.now(UTC)
        try:
            snapshot = self._store.commit(
                path,
                workspace,
                expected_revision=expected_revision,
            )
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
                details={"workspace_id": str(workspace.id)},
            ) from exc
        return snapshot

    @staticmethod
    def materialize_record(
        workspace: Workspace,
        revision: int,
        runtime_state: Literal["closed", "open", "closing"],
    ) -> WorkspaceRecord:
        """Copy a live workspace into an immutable response-safe record."""

        return WorkspaceRecord(
            id=workspace.id,
            name=workspace.name,
            description=workspace.description or "",
            created_at=workspace.created_at,
            modified_at=workspace.modified_at,
            total_nodes=len(workspace.node_ids),
            root_nodes=workspace.root_node_count,
            leaf_nodes=workspace.leaf_node_count,
            revision=revision,
            runtime_state=runtime_state,
        )

    async def publish_analysis_progress(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        analysis_id: uuid.UUID,
        progress: Progress,
    ) -> None:
        """Publish one non-durable live Analysis progress hint."""

        await self._event_publisher.analysis_progress(
            user_id,
            workspace_id,
            analysis_id,
            progress,
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
        workspace_id: uuid.UUID,
        request: WorkspaceUpdateRequest,
    ) -> WorkspaceRecord:
        """Validate and commit one partial workspace metadata update."""

        async with self.mutation_context(user_id, workspace_id) as lease:
            changed = False
            if "name" in request.model_fields_set:
                assert request.name is not None
                normalized_name = request.name.strip()
                valid, reason = validate_workspace_name(normalized_name)
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
            self._residency.runtime_state(lease.slot),
        )

    async def reorder_nodes(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        request: WorkspaceNodeReorderRequest,
    ) -> WorkspaceRecord:
        """Validate and commit one exact duplicate-free node ordering."""

        async with self.mutation_context(user_id, workspace_id) as lease:
            current_ids = list(lease.workspace.nodes)
            ordered_ids = request.ordered_ids
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
            self._residency.runtime_state(lease.slot),
        )

    async def list_tabs(
        self, user_id: str, workspace_id: uuid.UUID
    ) -> list[TabResource]:
        """Return the complete deterministic Tab collection from an open Workspace."""

        async with self.read_context(user_id, workspace_id) as lease:
            tabs = sorted(
                lease.workspace.tabs.values(),
                key=lambda tab: (tab.created_at, str(tab.id)),
            )
            return [
                *[tab.model_copy(deep=True) for tab in tabs],
                *[
                    UnavailableTab.create(
                        tab_id=tab_id,
                        workspace_id=workspace_id,
                        reason=record.reason,
                        analysis_kind=record.analysis_kind,
                        stored_schema_version=record.stored_schema_version,
                        supported_schema_version=record.supported_schema_version,
                    )
                    for tab_id in sorted(lease.workspace.unavailable_tab_ids)
                    for record in [lease.workspace.unavailable_tab_record(tab_id)]
                ],
            ]

    async def get_tab(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        tab_id: uuid.UUID,
    ) -> TabResource:
        """Return one exact Tab without exposing the mutable aggregate object."""

        async with self.read_context(user_id, workspace_id) as lease:
            tab = lease.workspace.tabs.get(tab_id)
            if tab is not None:
                return tab.model_copy(deep=True)
            if tab_id in lease.workspace.unavailable_tab_ids:
                record = lease.workspace.unavailable_tab_record(tab_id)
                return UnavailableTab.create(
                    tab_id=tab_id,
                    workspace_id=workspace_id,
                    reason=record.reason,
                    analysis_kind=record.analysis_kind,
                    stored_schema_version=record.stored_schema_version,
                    supported_schema_version=record.supported_schema_version,
                )
            raise TabNotFoundError("Tab not found")

    async def create_tab(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
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
        workspace_id: uuid.UUID,
        tab_id: uuid.UUID,
        request: TabUpdate,
    ) -> Tab:
        """Update mutable Tab presentation state."""

        async with self.mutation_context(user_id, workspace_id) as lease:
            tab = lease.workspace.tabs.get(tab_id)
            if tab is None:
                raise TabNotFoundError("Tab not found")
            if tab.kind is not request.kind:
                raise InvalidInputError("Tab update kind does not match the Tab")
            changed = False
            if request.name is not None and tab.name != request.name:
                tab.name = request.name
                changed = True
            if isinstance(request, AnnotationTabUpdate):
                settings = tab.settings
                if not isinstance(settings, AnnotationTabSettings):
                    raise InvalidInputError("Annotation Tab settings are invalid")
                correction_columns = request.correction_columns
                if (
                    correction_columns is not None
                    and settings.correction_columns != correction_columns
                ):
                    for node_id, column in correction_columns.items():
                        node = lease.workspace.nodes.get(node_id)
                        if node is None or column not in await self._residency.run_io(
                            node.data.collect_schema
                        ):
                            raise InvalidInputError(
                                "Annotation correction column is unavailable"
                            )
                    settings.correction_columns = correction_columns
                    changed = True
            elif isinstance(request, TokenFrequencyTabUpdate):
                settings = tab.settings
                if not isinstance(settings, TokenFrequencyTabSettings):
                    raise InvalidInputError("Token Frequency Tab settings are invalid")
                if (
                    request.stop_words is not None
                    and settings.stop_words != request.stop_words
                ):
                    settings.stop_words = request.stop_words
                    changed = True
            elif isinstance(request, TopicModelingTabUpdate):
                settings = tab.settings
                if not isinstance(settings, TopicModelingTabSettings):
                    raise InvalidInputError("Topic Modelling Tab settings are invalid")
                if (
                    request.stop_words is not None
                    and settings.stop_words != request.stop_words
                ):
                    settings.stop_words = request.stop_words
                    changed = True
                if "words_per_topic" in request.model_fields_set:
                    if request.words_per_topic is None:
                        raise InvalidInputError(
                            "Topic Modelling Tabs require a word display count"
                        )
                    if settings.words_per_topic != request.words_per_topic:
                        settings.words_per_topic = request.words_per_topic
                        changed = True
                if "projection_selection" in request.model_fields_set:
                    selection = request.projection_selection
                    if selection is not None:
                        record = lease.workspace.analyses.get(selection.analysis_id)
                        if (
                            record is None
                            or record.tab_id != tab.id
                            or record.state is not BackgroundState.SUCCEEDED
                            or record.request.kind != "topic_modeling"
                            or record.result_payload is None
                        ):
                            raise InvalidInputError(
                                "Topic projection selection Analysis is unavailable"
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
                                "Topic projection cluster count is outside the supported range"
                            )
                        if not (
                            stored.topic_inclusion.min_top_n_topics
                            <= selection.top_n_topics
                            <= selection.cluster_count
                        ):
                            raise InvalidInputError(
                                "Top topics per row is outside the supported range"
                            )
                    if settings.projection_selection != selection:
                        settings.projection_selection = selection
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

        is_valid, reason = validate_workspace_name(name)
        if not is_valid:
            raise InvalidInputError(f"Invalid workspace name: {reason}")
        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")

        workspace_id = uuid.uuid4()
        async with self._residency.slot(workspace_id):
            root = workspaces_root(self.settings)
            path = root / str(workspace_id)
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
                workspace.created_at = datetime.now(UTC)
                workspace.modified_at = workspace.created_at
                await self._residency.run_io(self._save_sync, staging, workspace, None, False)
                await self._residency.run_io(write_workspace_owner, staging, user_id)
                await reservation.recheck_path(staging)
                await self._residency.run_io(os.replace, staging, path)
                await self._residency.run_io(_fsync_directory, root)
            except BaseException:
                await self._residency.run_io(shutil.rmtree, staging, True)
                raise
            finally:
                with anyio.CancelScope(shield=True):
                    await reservation.release()
            resource = self.materialize_record(workspace, 1, "closed")
        await self._event_publisher.changed(
            user_id,
            EventResourceType.WORKSPACE,
            workspace_id,
            revision=resource.revision,
            workspace_id=workspace_id,
        )
        return resource

    @asynccontextmanager
    async def read_context(
        self, user_id: str, workspace_id: uuid.UUID
    ) -> AsyncIterator[WorkspaceLease]:
        """Read one explicitly open Workspace, including while it closes."""

        async with self._residency.slot(workspace_id) as slot:
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
        workspace_id: uuid.UUID,
    ) -> AsyncIterator[WorkspaceLease]:
        """Snapshot new work only while the Workspace is fully open."""

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        async with self._residency.slot(workspace_id) as slot:
            yield await self._require_open(
                slot,
                user_id,
                workspace_id,
                allow_closing=False,
            )

    async def ensure_open(self, user_id: str, workspace_id: uuid.UUID) -> None:
        """Validate child-resource access without leaking the aggregate."""

        async with self.read_context(user_id, workspace_id):
            return

    async def ensure_accepting_work(
        self, user_id: str, workspace_id: uuid.UUID
    ) -> None:
        """Admit one new-work request before it snapshots independent inputs."""

        async with self.submission_context(user_id, workspace_id):
            return

    @asynccontextmanager
    async def mutation_context(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        *,
        internal: bool = False,
    ) -> AsyncIterator[WorkspaceLease]:
        """Commit one narrow mutation before releasing the Workspace gate.

        Internal completion commands may finish already-admitted work while a
        Workspace is closing. External commands have no such exception.
        """

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        async with self._residency.slot(workspace_id) as slot:
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
            before_unavailable = (
                lease.workspace.unavailable_analysis_ids & before_live
            )
            before_node_histories = {
                node_id: node.snapshot_plan_history()
                for node_id, node in lease.workspace.nodes.items()
            }
            try:
                yield lease
                if lease.commit_requested:
                    with anyio.CancelScope(shield=True):
                        await self._mutation_committer.persist(user_id, lease)
            except BaseException:
                with anyio.CancelScope(shield=True):
                    await self._mutation_committer.rollback(
                        lease,
                        before_node_histories,
                    )
                raise
            else:
                if lease.commit_requested:
                    await self._event_publisher.publish_mutation(
                        user_id,
                        lease.workspace,
                        lease.revision,
                        before_tabs=before_tabs,
                        before_analyses=before_analyses,
                        before_unavailable=before_unavailable,
                    )
                await self._mutation_committer.cleanup_committed(lease)

    async def mutate_workspace(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
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

    @asynccontextmanager
    async def reserve_open(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
    ) -> AsyncIterator[None]:
        """Reserve cross-process ownership before local sibling transitions."""

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        async with self._residency.slot(workspace_id) as slot:
            path = await self._path(user_id, workspace_id)
            if path is None:
                raise WorkspaceNotFoundError("Workspace not found")
            if slot.workspace is not None:
                if slot.path != path:
                    await self._residency.clear(slot)
                    raise WorkspaceNotFoundError("Workspace not found")
            elif slot.process_lock is None:
                slot.process_lock = await self._residency.acquire_process_lock(workspace_id)
        try:
            yield
        finally:
            with anyio.CancelScope(shield=True):
                async with self._residency.slot(workspace_id) as slot:
                    if slot.workspace is None:
                        await self._residency.clear(slot)

    async def open_workspace(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
    ) -> WorkspaceRecord:
        """Idempotently load one Workspace through its explicit open boundary."""

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        async with self._residency.slot(workspace_id) as slot:
            path = await self._path(user_id, workspace_id)
            if path is None:
                raise WorkspaceNotFoundError("Workspace not found")
            if slot.workspace is not None:
                if slot.path != path:
                    await self._residency.clear(slot)
                    raise WorkspaceNotFoundError("Workspace not found")
                state_changed = slot.closing
                slot.closing = False
                resource = self.materialize_record(
                    slot.workspace,
                    slot.revision,
                    "open",
                )
            else:
                if slot.process_lock is None:
                    slot.process_lock = await self._residency.acquire_process_lock(workspace_id)
                try:
                    snapshot = await self._residency.run_io(self._catalogue.inspect, path)
                    reserved_bytes = snapshot.serialized_bytes
                    await self._residency.reserve_capacity(reserved_bytes)
                    slot.serialized_bytes = reserved_bytes
                    workspace, revision, serialized_bytes = await self._residency.run_io(
                        self._catalogue.load,
                        path,
                    )
                    if serialized_bytes > reserved_bytes:
                        await self._residency.reserve_capacity(
                            serialized_bytes - reserved_bytes
                        )
                        reserved_bytes = serialized_bytes
                        slot.serialized_bytes = reserved_bytes
                    elif serialized_bytes < reserved_bytes:
                        await self._residency.release_capacity(
                            reserved_bytes - serialized_bytes
                        )
                        reserved_bytes = serialized_bytes
                        slot.serialized_bytes = reserved_bytes
                except BaseException:
                    with anyio.CancelScope(shield=True):
                        await self._residency.clear(slot)
                    raise
                if revision != snapshot.revision:
                    with anyio.CancelScope(shield=True):
                        await self._residency.clear(slot)
                    raise WorkspaceCorruptError(
                        "Workspace changed while it was opening",
                        details={"workspace_id": str(workspace_id)},
                    )
                slot.workspace = workspace
                slot.path = path
                slot.revision = revision
                slot.serialized_bytes = serialized_bytes
                slot.serialized_entries = self._mutation_committer.entry_count(
                    node_count=len(workspace.nodes),
                    tab_count=len(workspace.tabs),
                    analysis_count=(
                        len(workspace.analyses)
                        + len(workspace.unavailable_analysis_ids)
                    ),
                )
                slot.closing = False
                resource = self.materialize_record(workspace, revision, "open")
                state_changed = True
        if state_changed:
            await self._event_publisher.runtime_state(user_id, workspace_id, "open")
        return resource

    async def get_workspace(
        self, user_id: str, workspace_id: uuid.UUID
    ) -> WorkspaceRecord:
        """Read lightweight metadata without implicitly opening the Workspace."""

        async with self._residency.slot(workspace_id) as slot:
            path = await self._path(user_id, workspace_id)
            if path is None:
                raise WorkspaceNotFoundError("Workspace not found")
            snapshot = await self._residency.run_io(self._catalogue.inspect, path)
            return self._record_from_snapshot(snapshot, self._residency.runtime_state(slot))

    async def list_workspaces(self, user_id: str) -> list[WorkspaceListRecord]:
        """Freshly scan metadata and overlay only transient runtime state."""

        records = await self._residency.run_io(self._catalogue.scan_records, user_id)
        states = await self._residency.runtime_states()
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

    async def resolve_workspace_dir(
        self, user_id: str, workspace_id: uuid.UUID
    ) -> Path:
        """Resolve storage for one open or closing Workspace."""

        async with self._residency.slot(workspace_id) as slot:
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
        workspace_id: uuid.UUID,
    ) -> Path:
        """Resolve one owned Workspace directory without opening its snapshot."""

        path = await self._path(user_id, workspace_id)
        if path is None:
            raise WorkspaceNotFoundError("Workspace not found")
        return path

    async def request_close(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        has_active_work: Callable[[str, uuid.UUID], Awaitable[bool]],
    ) -> WorkspaceRecord | None:
        """Close immediately or mark the loaded aggregate for deferred close."""

        async with self._residency.slot(workspace_id) as slot:
            path = await self._path(user_id, workspace_id)
            if path is None:
                raise WorkspaceNotFoundError("Workspace not found")
            if slot.workspace is None:
                return None
            if slot.path != path:
                await self._residency.clear(slot)
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
                await self._event_publisher.runtime_state(
                    user_id, workspace_id, "closing"
                )
                return resource
            await self._residency.clear(slot)
            await self._event_publisher.runtime_state(user_id, workspace_id, "closed")
            return None

    async def finalize_close_if_idle(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
        has_active_work: Callable[[str, uuid.UUID], Awaitable[bool]],
    ) -> None:
        """Remove a closing aggregate after its final admitted runner drains."""

        async with self._residency.slot(workspace_id) as slot:
            if not slot.closing or slot.workspace is None:
                return
            if await has_active_work(user_id, workspace_id):
                return
            await self._residency.clear(slot)
            await self._event_publisher.runtime_state(user_id, workspace_id, "closed")

    @asynccontextmanager
    async def deletion_context(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
    ) -> AsyncIterator[None]:
        """Validate and hold the workspace gate through referential deletion.

        ``WorkspaceLifecycleService`` stops private Analysis execution while
        this context excludes new submission and completion. The directory is
        removed only after that cancellation signal succeeds.
        """

        if not self._accepting_mutations:
            raise WorkspaceConflictError("Workspace service is shutting down")
        async with self._residency.slot(workspace_id) as slot:
            path = await self._path(user_id, workspace_id)
            if path is None:
                raise WorkspaceNotFoundError("Workspace not found")
            acquired_for_delete = slot.process_lock is None
            if acquired_for_delete:
                slot.process_lock = await self._residency.acquire_process_lock(workspace_id)
            try:
                yield
                await self._residency.run_io(
                    self._delete_sync,
                    path,
                    workspace_trash_root(self.settings),
                )
                revision = slot.revision or None
                await self._residency.clear(slot)
                await self._event_publisher.removed(
                    user_id,
                    EventResourceType.WORKSPACE,
                    workspace_id,
                    workspace_id=workspace_id,
                    revision=revision,
                )
            finally:
                if acquired_for_delete and slot.workspace is None:
                    with anyio.CancelScope(shield=True):
                        await self._residency.clear(slot)

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
        workspace_id = uuid.uuid4()
        async with self._residency.slot(workspace_id):
            destination = workspaces_root(self.settings) / str(workspace_id)
            record = await self._residency.run_io(
                self._prepare_staged_import_sync,
                user_id,
                staging,
                workspace_id,
                workspace_name,
                destination,
            )
            await reservation.recheck_path(staging)
            await self._residency.run_io(
                self._publish_staged_import_sync,
                staging,
                destination,
            )
            resource = cast(dict[str, JsonData], asdict(record))
        await self._event_publisher.changed(
            user_id,
            EventResourceType.WORKSPACE,
            workspace_id,
            revision=record.revision,
            workspace_id=workspace_id,
        )
        return resource

    def _prepare_staged_import_sync(
        self,
        user_id: str,
        staging: Path,
        workspace_id: uuid.UUID,
        workspace_name: str,
        destination: Path,
    ) -> WorkspaceRecord:
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
        imported_at = datetime.now(UTC)
        self._store.prepare_import_identity(
            staging,
            workspace_id=workspace_id,
            name=workspace_name,
            revision=1,
            timestamp=imported_at,
        )
        # Validate the extracted representation before rewriting its plans.
        loaded = self._store.load(staging)
        self._store.rebase_snapshot_sources(
            staging,
            published_root=destination,
        )
        for analysis in loaded.workspace.analyses.values():
            if analysis.query_snapshot is None:
                continue
            relative_path = Path(analysis.query_snapshot.relative_path)
            rebase_worker_input_snapshot_sources(
                staging / relative_path,
                workspace_id=workspace_id,
                published_snapshot_dir=destination / relative_path,
            )

        # Load the complete staged graph against its future logical root. The
        # backing files remain contained in staging until the commit rename.
        validated = self._store.load(staging, published_root=destination)

        write_workspace_owner(staging, user_id)
        marker.unlink()
        _fsync_directory(staging)
        return self.materialize_record(
            validated.workspace,
            validated.snapshot.revision,
            "closed",
        )

    def _publish_staged_import_sync(
        self,
        staging: Path,
        destination: Path,
    ) -> None:
        """Publish one fully compiled and quota-approved import."""

        root = workspaces_root(self.settings)
        os.replace(staging, destination)
        _fsync_directory(root)

    async def close(self) -> None:
        """Reject mutations and release every clean open aggregate at shutdown.

        Every mutation is committed before its gate is released, so open
        workspaces are never dirty and shutdown must not invent a new revision.
        Runtime calls this only after Analysis completions have drained.
        """

        self._accepting_mutations = False
        await self._residency.close()

    async def reconcile_transient_storage(self) -> None:
        """Remove archive/delete crash leftovers once, before serving requests."""

        await self._residency.run_io(
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

        paths = await self._residency.run_io(self._catalogue.scan_owned_paths)
        for owner_id, path in paths:
            workspace_id = uuid.UUID(path.name)
            async with self._residency.slot(workspace_id) as slot:
                if slot.workspace is not None:
                    raise RuntimeError(
                        "Durable Workspace reconciliation must run before serving"
                    )
                try:
                    if slot.process_lock is None:
                        slot.process_lock = await self._residency.acquire_process_lock(workspace_id)
                except WorkspaceInUseError:
                    logger.info(
                        "Skipping startup reconciliation for a Workspace open "
                        "in another backend workspace_id=%s owner_id=%s",
                        path.name,
                        owner_id,
                    )
                    continue
                except WorkspaceLockUnavailableError:
                    logger.exception(
                        "Workspace lock unavailable during startup reconciliation "
                        "workspace_id=%s owner_id=%s",
                        path.name,
                        owner_id,
                    )
                    continue
                try:
                    await self._residency.run_io(self._store.reconcile, path)
                    workspace, revision, _serialized_bytes = await self._residency.run_io(
                        self._catalogue.load,
                        path,
                    )
                    if not reconcile(workspace):
                        continue
                    await self._residency.run_io(
                        self._save_sync,
                        path,
                        workspace,
                        revision,
                    )
                except (
                    OSError,
                    ResourceTooLargeError,
                    WorkspaceConflictError,
                    WorkspaceCorruptError,
                ):
                    logger.exception(
                        "Workspace startup reconciliation failed "
                        "workspace_id=%s owner_id=%s",
                        path.name,
                        owner_id,
                    )
                finally:
                    with anyio.CancelScope(shield=True):
                        await self._residency.clear(slot)
