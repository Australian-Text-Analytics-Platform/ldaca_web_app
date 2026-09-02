"""Lifespan-owned backend runtime and request-state dependencies.

Used by:
- ``main.create_app`` to allocate stateful resources only while ASGI lifespan is
  active,
- API dependencies that need the runtime/settings snapshot owned by the current
  app instance, and
- tests that run multiple applications without global state leakage.

Flow:
- ``runtime_context`` initializes storage and hosted database state, creates the
  runtime-owned AnyIO task group and capacity limiters, and warms executors;
- FastAPI copies the yielded ``LifespanState`` into each request's state; and
- shutdown rejects submissions, drains application-owned work, closes
  executors, then releases the runtime task group in reverse order.
"""

from __future__ import annotations

import logging
import os
import secrets
import sys
import tempfile
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AbstractAsyncContextManager, AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, TypedDict, cast

import anyio
from anyio.abc import ObjectReceiveStream, ObjectSendStream, TaskGroup, TaskStatus
from anyio.to_thread import run_sync as run_sync_in_worker_thread
from fastapi import Request

from ._logging import setup_logging
from .services.user_files import UserFileStore
from .services.workspace_archives import WorkspaceArchiveLimits, WorkspaceArchiveService
from .infrastructure.database import Database
from .infrastructure.providers.quotation_client import QuotationProviderClient
from .settings import Settings
from .data_root_config import (
    DataRootConfigError,
    DataRootConfigStore,
    probe_data_root,
)
from .services.sessions import SessionService
from .services.oauth import OAuthService
from .services.file_preview import FileReadService
from .services.maintenance import MaintenanceService
from .services.events import EventHub
from .infrastructure.storage.layout import (
    deployment_database_path,
    user_cache_root,
    user_files_root,
    user_imports_root,
    user_root,
    workspace_staging_root,
    workspace_trash_root,
    workspaces_root,
)
from .infrastructure.storage.durable_fs import mkdir_durable
from .infrastructure.storage.private_toml import PrivateTomlPersistence
from .services.storage_admission import StorageAdmissionService
from .services.quota import QuotaService, UnlimitedStorageQuotaRepository
from .services.response_snapshots import ResponseSnapshotService
from .infrastructure.storage.user_file_import_store import UserFileImportStore
from .services.analysis_results import AnalysisResultService
from .services.analyses import AnalysisService
from .services.analysis_execution import AnalysisExecutionRuntime
from .services.analysis_executor import AnalysisProcessExecutor
from .services.analysis_preparation import AnalysisExecutionPreparer
from .services.analysis_artifacts import AnalysisArtifactService
from .services.annotations import AnnotationService
from .services.provider_credentials import ProviderCredentialStore
from .services.user_preferences import UserPreferenceStore
from .services.sample_data import SampleDataService
from .services.data_portal import DataPortalService
from .services.user_file_import_executor import UserFileImportProcessExecutor
from .services.user_file_imports import UserFileImportService
from .services.nodes import NodeService
from .services.data_block_exports import DataBlockExportService
from .services.workspace_sql import WorkspaceSqlService
from .services.workspace import WorkspaceService
from .infrastructure.storage.workspace_store import WorkspaceStore
from .services.workspace_lifecycle import WorkspaceLifecycleService
from .shared.errors import (
    DataRootBusyError,
    DataRootInitializationError,
    DataRootInvalidError,
    DataRootManagedByOperatorError,
    DataRootTransitionError,
    format_exception_diagnostic,
    InternalServiceError,
    RuntimeUnavailableError,
)

logger = logging.getLogger(__name__)
ReadinessStatus = Literal["ready", "stopping"]
RuntimeManagerState = Literal[
    "unconfigured",
    "initializing",
    "ready",
    "reconfiguring",
    "configuration_error",
    "stopping",
]
DataRootSource = Literal["environment", "config", "none"]
ExecutionShutdown = Callable[[float], Awaitable[None]]
ManagedRuntimeFactory = Callable[[Settings], AbstractAsyncContextManager["Runtime"]]


@dataclass(slots=True)
class RuntimeReadiness:
    """Process readiness changed only by the lifespan shutdown owner."""

    _status: ReadinessStatus = "ready"

    @property
    def status(self) -> ReadinessStatus:
        return self._status

    def mark_stopping(self) -> None:
        self._status = "stopping"


def _initialize_storage(settings: Settings) -> None:
    """Create and durably probe the immutable data root before service startup."""

    root = settings.get_data_root()
    mkdir_durable(root)
    mkdir_durable(settings.get_users_root_folder())
    mkdir_durable(workspaces_root(settings))
    mkdir_durable(workspace_staging_root(settings))
    mkdir_durable(workspace_trash_root(settings))
    descriptor, raw_probe = tempfile.mkstemp(prefix=".wordflow-probe.", dir=root)
    probe = Path(raw_probe)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(b"wordflow")
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        probe.unlink(missing_ok=True)


@dataclass(slots=True)
class Runtime:
    """Stateful resources owned by one FastAPI application lifespan.

    Used by request dependencies, completion callbacks, and the lifespan
    shutdown sequence. Every field is fully constructed before the runtime is
    yielded; there are no optional service placeholders or module fallbacks.
    """

    settings: Settings
    readiness: RuntimeReadiness
    task_group: TaskGroup
    io_limiter: anyio.CapacityLimiter
    quota_service: QuotaService
    storage_admission: StorageAdmissionService
    response_snapshot_service: ResponseSnapshotService
    workspace_service: WorkspaceService
    workspace_lifecycle_service: WorkspaceLifecycleService
    user_file_store: UserFileStore
    file_read_service: FileReadService
    session_service: SessionService
    oauth_service: OAuthService
    event_hub: EventHub
    quotation_client: QuotationProviderClient
    analysis_service: AnalysisService
    analysis_execution: AnalysisExecutionRuntime
    analysis_result_service: AnalysisResultService
    annotation_service: AnnotationService
    user_preference_store: UserPreferenceStore
    provider_credential_store: ProviderCredentialStore
    sample_data_service: SampleDataService
    data_portal_service: DataPortalService
    user_file_import_service: UserFileImportService
    node_service: NodeService
    data_block_export_service: DataBlockExportService
    workspace_sql_service: WorkspaceSqlService
    workspace_archive_service: WorkspaceArchiveService
    maintenance_service: MaintenanceService


@dataclass(slots=True)
class _RuntimeTaskGroupOwner:
    """Stop runtime work under one deadline before dependencies unwind."""

    task_group: TaskGroup
    readiness: RuntimeReadiness
    shutdown_grace_seconds: float
    admission_stoppers: list[Callable[[], None]] = field(default_factory=list)
    execution_shutdowns: list[ExecutionShutdown] = field(default_factory=list)
    maintenance_shutdowns: list[Callable[[], Awaitable[None]]] = field(
        default_factory=list
    )
    closed: bool = False

    def register_admission_stopper(self, callback: Callable[[], None]) -> None:
        """Register a synchronous new-work boundary."""

        if self.closed:
            raise RuntimeError("Runtime task group is already closed")
        self.admission_stoppers.append(callback)

    def register_execution_shutdown(self, callback: ExecutionShutdown) -> None:
        """Register one execution owner governed by the shared deadline."""

        if self.closed:
            raise RuntimeError("Runtime task group is already closed")
        self.execution_shutdowns.append(callback)

    def register_maintenance_shutdown(
        self,
        callback: Callable[[], Awaitable[None]],
    ) -> None:
        """Register a maintenance loop that must stop before execution drains."""

        if self.closed:
            raise RuntimeError("Runtime task group is already closed")
        self.maintenance_shutdowns.append(callback)

    @staticmethod
    async def _close_execution_safely(
        callback: ExecutionShutdown,
        deadline: float,
    ) -> None:
        try:
            await callback(deadline)
        except Exception:
            logger.exception("Runtime execution service failed during shutdown")

    async def close(self) -> None:
        """Close admission, interrupt execution concurrently, and join once."""

        if self.closed:
            return
        self.closed = True
        self.readiness.mark_stopping()
        for stop_accepting in self.admission_stoppers:
            stop_accepting()
        for close_maintenance in reversed(self.maintenance_shutdowns):
            try:
                await close_maintenance()
            except Exception:
                logger.exception("Runtime maintenance failed during shutdown")

        deadline = anyio.current_time() + self.shutdown_grace_seconds
        try:
            with anyio.move_on_after(self.shutdown_grace_seconds) as shutdown_scope:
                async with anyio.create_task_group() as shutdown:
                    for close_execution in self.execution_shutdowns:
                        shutdown.start_soon(
                            self._close_execution_safely,
                            close_execution,
                            deadline,
                        )
            if shutdown_scope.cancel_called:
                logger.warning("Runtime execution shutdown reached its deadline")
        finally:
            self.task_group.cancel_scope.cancel()
            await self.task_group.__aexit__(None, None, None)


@dataclass(frozen=True, slots=True)
class RuntimeManagerError:
    """Safe bootstrap failure returned by the public control plane."""

    code: str
    message: str


@dataclass(frozen=True, slots=True)
class RuntimeManagerSnapshot:
    """Immutable public projection of one process's Data Root state."""

    state: RuntimeManagerState
    source: DataRootSource
    data_root: Path | None
    suggested_data_root: Path | None
    mutable: bool
    runtime_generation: int
    error: RuntimeManagerError | None
    change_token: str | None


@dataclass(slots=True)
class _RuntimeOwnerRequest:
    """One command completed entirely by the Runtime owner task."""

    action: Literal["initialize", "configure", "shutdown"]
    data_root: Path | None = None
    completed: anyio.Event = field(default_factory=anyio.Event)
    result: RuntimeManagerSnapshot | None = None
    error: Exception | None = None


class _RuntimeSlot:
    """Enter and exit one managed Runtime from the same owner task."""

    def __init__(
        self,
        base_settings: Settings,
        runtime_factory: ManagedRuntimeFactory,
    ) -> None:
        self._base_settings = base_settings
        self._runtime_factory = runtime_factory
        self._stack: AsyncExitStack | None = None

    async def open(self, data_root: Path) -> tuple[Runtime, Path]:
        if self._stack is not None:
            raise RuntimeError("A managed Runtime is already open")
        canonical = await run_sync_in_worker_thread(
            probe_data_root,
            data_root,
            abandon_on_cancel=False,
        )
        effective_settings = Settings.model_validate(
            {**self._base_settings.model_dump(), "data_root": canonical}
        )
        stack = AsyncExitStack()
        await stack.__aenter__()
        try:
            runtime = await stack.enter_async_context(
                self._runtime_factory(effective_settings)
            )
            setup_logging(
                level=effective_settings.log_level,
                log_file=effective_settings.log_file,
                data_root=canonical,
            )
        except BaseException:
            await stack.aclose()
            raise
        self._stack = stack
        return runtime, canonical

    async def close(self) -> None:
        stack = self._stack
        self._stack = None
        if stack is not None:
            await stack.aclose()


class RuntimeManager:
    """Own an optional complete Runtime behind a live HTTP control plane."""

    def __init__(
        self,
        settings: Settings,
        runtime_factory: ManagedRuntimeFactory,
        owner_group: TaskGroup,
        *,
        config_store: DataRootConfigStore | None = None,
    ) -> None:
        self._base_settings = settings
        self._runtime_factory = runtime_factory
        self._owner_group = owner_group
        self._config_store = config_store or DataRootConfigStore()
        self._runtime: Runtime | None = None
        self._owner_send: ObjectSendStream[_RuntimeOwnerRequest] | None = None
        self._state: RuntimeManagerState = "unconfigured"
        self._source: DataRootSource = "none"
        self._data_root: Path | None = None
        self._generation = 0
        self._error: RuntimeManagerError | None = None
        self._change_token = secrets.token_urlsafe(32)
        self._transition_lock = anyio.Lock()
        self._lease_condition = anyio.Condition()
        self._active_leases = 0

    @property
    def state(self) -> RuntimeManagerState:
        return self._state

    def snapshot(self) -> RuntimeManagerSnapshot:
        """Return a redacted, mode-aware public state snapshot."""

        mutable = not self._base_settings.multi_user and self._source != "environment"
        reveal_paths = not self._base_settings.multi_user
        return RuntimeManagerSnapshot(
            state=self._state,
            source=self._source,
            data_root=self._data_root if reveal_paths else None,
            suggested_data_root=(
                self._config_store.paths.suggested_data_root
                if mutable and reveal_paths
                else None
            ),
            mutable=mutable,
            runtime_generation=self._generation,
            error=self._error,
            change_token=self._change_token if mutable else None,
        )

    def validate_change_token(self, candidate: str | None) -> bool:
        """Compare the single-user control token without timing disclosure."""

        snapshot = self.snapshot()
        return bool(
            snapshot.mutable
            and candidate
            and secrets.compare_digest(candidate, self._change_token)
        )

    def current_runtime(self) -> Runtime:
        """Return the ready Runtime or a typed temporary-unavailability error."""

        if self._state != "ready" or self._runtime is None:
            raise RuntimeUnavailableError()
        return self._runtime

    @asynccontextmanager
    async def lease(self) -> AsyncIterator[Runtime]:
        """Hold one finite request against Runtime teardown."""

        async with self._lease_condition:
            runtime = self.current_runtime()
            self._active_leases += 1
        try:
            yield runtime
        finally:
            async with self._lease_condition:
                self._active_leases -= 1
                self._lease_condition.notify_all()

    async def start(self) -> None:
        """Resolve environment/config precedence and initialize when configured."""

        await self._start_owner()
        if self._base_settings.data_root is not None:
            self._source = "environment"
            selected = self._base_settings.data_root
        else:
            try:
                selected = await run_sync_in_worker_thread(
                    self._config_store.read,
                    abandon_on_cancel=False,
                )
            except DataRootConfigError as exc:
                self._source = "config"
                self._state = "configuration_error"
                self._error = RuntimeManagerError(
                    "data_root_config_invalid",
                    format_exception_diagnostic(exc),
                )
                return
            self._source = "config" if selected is not None else "none"
        if selected is None:
            self._state = "unconfigured"
            return
        await self._submit_owner(_RuntimeOwnerRequest("initialize", selected))

    async def close(self) -> None:
        """Stop admission, drain finite requests, and close the active Runtime."""

        send = self._owner_send
        if send is None:
            return
        error: BaseException | None = None
        with anyio.CancelScope(shield=True):
            try:
                await self._submit_owner(_RuntimeOwnerRequest("shutdown"))
            except BaseException as exc:
                error = exc
            finally:
                await send.aclose()
        self._owner_send = None
        if error is not None:
            raise error

    async def configure(self, candidate: Path) -> RuntimeManagerSnapshot:
        """Validate and transactionally select one single-user Data Root."""

        if self._base_settings.multi_user or self._source == "environment":
            raise DataRootManagedByOperatorError()
        try:
            self._transition_lock.acquire_nowait()
        except (anyio.WouldBlock, RuntimeError) as exc:
            raise DataRootTransitionError() from exc
        try:
            with anyio.CancelScope(shield=True):
                result = await self._submit_owner(
                    _RuntimeOwnerRequest("configure", candidate)
                )
            if result is None:
                raise RuntimeError("Runtime owner returned no configuration result")
            return result
        finally:
            self._transition_lock.release()

    async def _start_owner(self) -> None:
        if self._owner_send is not None:
            raise RuntimeError("Runtime owner is already active")
        send, receive = anyio.create_memory_object_stream[_RuntimeOwnerRequest](1)
        try:
            await self._owner_group.start(self._run_owner, receive)
        except BaseException:
            await send.aclose()
            await receive.aclose()
            raise
        self._owner_send = send

    async def _run_owner(
        self,
        receive: ObjectReceiveStream[_RuntimeOwnerRequest],
        *,
        task_status: TaskStatus[None],
    ) -> None:
        slot = _RuntimeSlot(self._base_settings, self._runtime_factory)
        task_status.started()
        async with receive:
            async for request in receive:
                stop = request.action == "shutdown"
                try:
                    if request.action == "initialize":
                        if request.data_root is None:
                            raise RuntimeError("Runtime initialization requires a Data Root")
                        await self._initialize_owned(slot, request.data_root)
                    elif request.action == "configure":
                        if request.data_root is None:
                            raise RuntimeError("Runtime configuration requires a Data Root")
                        request.result = await self._configure_owned(
                            slot,
                            request.data_root,
                        )
                    else:
                        await self._close_owned(slot)
                except Exception as exc:
                    request.error = exc
                finally:
                    request.completed.set()
                if stop:
                    return

    async def _submit_owner(
        self,
        request: _RuntimeOwnerRequest,
    ) -> RuntimeManagerSnapshot | None:
        send = self._owner_send
        if send is None:
            raise RuntimeError("Runtime owner is not active")
        await send.send(request)
        await request.completed.wait()
        if request.error is not None:
            raise request.error
        return request.result

    async def _initialize_owned(self, slot: _RuntimeSlot, selected: Path) -> None:
        self._data_root = selected
        self._state = "initializing"
        try:
            runtime, canonical = await slot.open(selected)
        except Exception as exc:
            logger.exception("Configured Data Root could not initialize")
            self._state = "configuration_error"
            self._error = RuntimeManagerError(
                "data_root_unavailable",
                format_exception_diagnostic(exc),
            )
            return
        self._runtime = runtime
        self._data_root = canonical
        self._generation = 1
        self._state = "ready"

    async def _configure_owned(
        self,
        slot: _RuntimeSlot,
        candidate: Path,
    ) -> RuntimeManagerSnapshot:
        """Run one transition after non-blocking ownership is established."""

        try:
            canonical = await run_sync_in_worker_thread(
                probe_data_root,
                candidate,
                abandon_on_cancel=False,
            )
        except (OSError, ValueError):
            raise DataRootInvalidError() from None
        if self._state == "ready" and canonical == self._data_root:
            return self.snapshot()

        old_root = self._data_root if self._runtime is not None else None
        old_source = self._source
        self._state = "reconfiguring"
        self._error = None
        await self._wait_for_leases()
        if await self._has_background_work():
            self._state = "ready"
            raise DataRootBusyError()

        await self._close_active_runtime(slot)
        try:
            runtime, canonical = await slot.open(canonical)
        except Exception as exc:
            logger.exception("Candidate Data Root could not initialize")
            await self._restore_or_fail(
                slot,
                old_root,
                old_source,
                failure=exc,
                error_code="data_root_initialization_failed",
            )
            raise DataRootInitializationError("Data Root initialization failed") from exc

        self._runtime = runtime
        try:
            await run_sync_in_worker_thread(
                self._config_store.write,
                canonical,
                abandon_on_cancel=False,
            )
        except Exception as exc:
            logger.exception("Data Root configuration could not be persisted")
            await self._close_active_runtime(slot)
            await self._restore_or_fail(
                slot,
                old_root,
                old_source,
                failure=exc,
                error_code="data_root_persistence_failed",
            )
            raise InternalServiceError("Data Root persistence failed") from exc

        self._data_root = canonical
        self._source = "config"
        self._generation += 1
        self._state = "ready"
        self._error = None
        self._change_token = secrets.token_urlsafe(32)
        return self.snapshot()

    async def _restore_or_fail(
        self,
        slot: _RuntimeSlot,
        old_root: Path | None,
        old_source: DataRootSource,
        *,
        failure: Exception,
        error_code: str,
    ) -> None:
        if old_root is None:
            self._runtime = None
            self._data_root = None
            self._source = "none"
            self._state = "configuration_error"
            self._error = RuntimeManagerError(
                error_code,
                format_exception_diagnostic(failure),
            )
            return
        try:
            runtime, canonical = await slot.open(old_root)
        except Exception as exc:
            logger.exception("Previous Data Root could not be restored")
            self._runtime = None
            self._data_root = old_root
            self._source = old_source
            self._state = "configuration_error"
            self._error = RuntimeManagerError(
                "data_root_rollback_failed",
                format_exception_diagnostic(exc),
            )
            return
        self._runtime = runtime
        self._data_root = canonical
        self._source = old_source
        self._state = "ready"

    async def _has_background_work(self) -> bool:
        runtime = self._runtime
        if runtime is None:
            return False
        analysis_execution = getattr(runtime, "analysis_execution", None)
        imports = getattr(runtime, "user_file_import_service", None)
        analysis_busy = bool(
            analysis_execution is not None
            and await analysis_execution.has_work()
        )
        import_busy = bool(imports is not None and await imports.has_work())
        return analysis_busy or import_busy

    async def _wait_for_leases(self) -> None:
        async with self._lease_condition:
            while self._active_leases:
                await self._lease_condition.wait()

    async def _close_active_runtime(self, slot: _RuntimeSlot) -> None:
        self._runtime = None
        await slot.close()
        self._use_bootstrap_logging()

    async def _close_owned(self, slot: _RuntimeSlot) -> None:
        self._state = "stopping"
        await self._wait_for_leases()
        await self._close_active_runtime(slot)

    def _use_bootstrap_logging(self) -> None:
        setup_logging(level=self._base_settings.log_level)


@asynccontextmanager
async def runtime_manager_context(
    settings: Settings,
    runtime_factory: ManagedRuntimeFactory,
    *,
    config_store: DataRootConfigStore | None = None,
) -> AsyncIterator[RuntimeManager]:
    """Own one optional Runtime manager for the complete ASGI lifespan."""

    async with anyio.create_task_group() as owner_group:
        manager = RuntimeManager(
            settings,
            runtime_factory,
            owner_group,
            config_store=config_store,
        )
        await manager.start()
        try:
            yield manager
        finally:
            with anyio.CancelScope(shield=True):
                await manager.close()


class LifespanState(TypedDict):
    """Typed state copied by Starlette onto every request in a lifespan."""

    runtime_manager: RuntimeManager


def get_runtime(request: Request) -> Runtime:
    """Return the current app's lifespan runtime from request state.

    Used by:
    - API dependencies and tests. A missing runtime is a programming/startup
      error, so it fails explicitly instead of falling back to a global.
    """

    runtime = getattr(request.state, "runtime", None)
    if runtime is not None:
        return cast(Runtime, runtime)
    manager = getattr(request.state, "runtime_manager", None)
    if not isinstance(manager, RuntimeManager):
        raise RuntimeError("Application lifespan is not active")
    return manager.current_runtime()


def get_runtime_manager(request: Request) -> RuntimeManager:
    """Return the lifespan-owned Data Root control-plane authority."""

    manager = getattr(request.state, "runtime_manager", None)
    if not isinstance(manager, RuntimeManager):
        raise RuntimeError("Application lifespan is not active")
    return manager


def get_workspace_service(request: Request) -> WorkspaceService:
    """Return the current application's sole workspace mutation service."""

    return get_runtime(request).workspace_service


def get_workspace_archive_service(request: Request) -> WorkspaceArchiveService:
    """Return the bounded archive validation and staging service."""

    return get_runtime(request).workspace_archive_service


@asynccontextmanager
async def runtime_context(settings: Settings) -> AsyncIterator[Runtime]:
    """Build and tear down the production runtime in dependency order.

    Called by:
    - the default ``create_app`` lifespan factory.

    Flow:
    1. initialize storage state,
    2. initialize the hosted app-owned database when multi-user mode requires it,
    3. enter the runtime task group and construct capacity limiters,
    4. reconcile retained resources and start private execution plus maintenance,
    5. on shutdown reject submissions, drain services, stop executors, and let
       ``AsyncExitStack`` unwind the runtime task group in reverse order.
    """

    async with AsyncExitStack() as stack:
        resources = AsyncExitStack()
        await resources.__aenter__()
        stack.push_async_callback(resources.aclose)
        io_limiter = anyio.CapacityLimiter(4)
        await run_sync_in_worker_thread(
            _initialize_storage,
            settings,
            abandon_on_cancel=False,
            limiter=io_limiter,
        )
        database: Database | None = None
        quota_repository: Database | UnlimitedStorageQuotaRepository
        if settings.multi_user:
            database = Database(deployment_database_path(settings))
            await database.initialize()
            quota_repository = database
        else:
            quota_repository = UnlimitedStorageQuotaRepository()

        task_group = anyio.create_task_group()
        await task_group.__aenter__()
        readiness = RuntimeReadiness()
        task_group_owner = _RuntimeTaskGroupOwner(
            task_group,
            readiness,
            settings.shutdown_grace_seconds,
        )
        stack.push_async_callback(task_group_owner.close)
        quota_service = QuotaService(
            quota_repository,
            data_root=settings.get_data_root(),
            user_root=lambda user_id: user_root(settings, user_id),
            workspaces_root=workspaces_root(settings),
            limiter=io_limiter,
        )
        await quota_service.initialize(require_finite_capability=settings.multi_user)
        storage_admission = StorageAdmissionService(
            settings.get_data_root(),
            quota_service,
            min_free_disk_bytes=settings.min_free_disk_bytes,
            limiter=io_limiter,
        )
        response_snapshot_service = ResponseSnapshotService(
            settings.get_data_root() / ".response-snapshots" / "resources",
            storage_admission,
            max_snapshot_bytes=settings.max_response_snapshot_bytes,
            max_concurrent_snapshots=settings.max_concurrent_response_snapshots,
            limiter=io_limiter,
        )
        await response_snapshot_service.reconcile()
        event_hub = EventHub()
        resources.push_async_callback(event_hub.close)
        workspace_store = WorkspaceStore(
            max_nodes=settings.max_workspace_nodes,
            max_snapshot_bytes=settings.max_workspace_snapshot_bytes,
        )
        workspace_service = WorkspaceService(
            settings,
            store=workspace_store,
            storage_admission=storage_admission,
            events=event_hub,
            io_limiter=io_limiter,
        )
        resources.push_async_callback(workspace_service.close)
        await workspace_service.reconcile_transient_storage()
        workspace_archive_service = WorkspaceArchiveService(
            workspace_service,
            workspace_store=workspace_store,
            response_snapshots=response_snapshot_service,
            storage_admission=storage_admission,
            max_export_bytes=settings.max_workspace_export_bytes,
            max_concurrent_imports=settings.max_concurrent_workspace_imports,
            limits=WorkspaceArchiveLimits(
                max_archive_bytes=settings.max_workspace_archive_bytes
            ),
            limiter=io_limiter,
        )
        user_file_store = UserFileStore(
            lambda user_id: user_files_root(settings, user_id),
            storage_admission=storage_admission,
            max_upload_bytes=settings.max_file_upload_bytes,
            max_tree_response_bytes=settings.max_user_file_tree_response_bytes,
            limiter=io_limiter,
            all_users_root=settings.get_users_root_folder(),
            response_snapshots=response_snapshot_service,
        )
        file_read_service = FileReadService(
            user_file_store,
            limiter=io_limiter,
            max_preview_bytes=settings.max_preview_source_bytes,
            max_text_bytes=settings.max_text_response_bytes,
        )
        node_service = NodeService(
            workspace_service,
            user_file_store,
            storage_admission=storage_admission,
            io_limiter=io_limiter,
            max_source_bytes=settings.max_preview_source_bytes,
            max_storage_bytes=settings.max_node_storage_bytes,
        )
        data_block_export_service = DataBlockExportService(
            workspace_service,
            response_snapshot_service,
            max_export_bytes=min(
                settings.max_workspace_export_bytes,
                settings.max_response_snapshot_bytes,
            ),
        )
        workspace_sql_service = WorkspaceSqlService(
            workspace_service,
            io_limiter=io_limiter,
        )
        session_service = SessionService(
            settings,
            database,
            io_limiter=io_limiter,
        )
        await session_service.initialize()
        private_toml = PrivateTomlPersistence(
            settings.get_users_root_folder(),
            storage_admission,
            limiter=io_limiter,
        )
        user_preference_store = UserPreferenceStore(private_toml)
        provider_credential_store = ProviderCredentialStore(
            settings,
            private_toml,
        )
        oauth_service = OAuthService(settings, session_service)
        resources.push_async_callback(oauth_service.close)
        quotation_client = QuotationProviderClient(
            default_timeout=settings.quotation_service_timeout,
        )
        resources.push_async_callback(quotation_client.close)
        analysis_preparer = AnalysisExecutionPreparer(
            settings,
            limiter=io_limiter,
            cache_root=lambda user_id: user_cache_root(settings, user_id),
        )
        analysis_executor = AnalysisProcessExecutor()
        analysis_execution = AnalysisExecutionRuntime(
            capacity=settings.analysis_execution_capacity,
            preparer=analysis_preparer,
            executor=analysis_executor,
            limiter=io_limiter,
            workspaces=workspace_service,
            storage_reservation_bytes=settings.max_analysis_storage_bytes,
            storage_reservation_files=settings.max_analysis_storage_files,
        )
        analysis_artifacts = AnalysisArtifactService(
            limiter=io_limiter,
            response_snapshots=response_snapshot_service,
            max_node_bytes=settings.max_node_storage_bytes,
            max_snapshot_bytes=settings.max_analysis_storage_bytes,
        )
        analysis_service = AnalysisService(
            workspace_service,
            analysis_execution,
            analysis_artifacts,
            credentials=provider_credential_store,
        )
        await analysis_service.reconcile_interrupted_analyses()
        analysis_execution.bind(analysis_service, task_group)
        task_group_owner.register_admission_stopper(analysis_service.stop_accepting)
        task_group_owner.register_execution_shutdown(analysis_execution.close)
        annotation_service = AnnotationService(
            credentials=provider_credential_store,
        )
        sample_data_service = SampleDataService(
            user_file_store,
            limiter=io_limiter,
            max_import_bytes=settings.max_user_file_import_bytes,
            max_import_files=settings.max_user_file_import_files,
        )
        resources.push_async_callback(sample_data_service.close)
        data_portal_service = DataPortalService(
            settings,
            user_file_store,
            provider_credential_store,
        )
        resources.push_async_callback(data_portal_service.close)
        user_file_import_store = UserFileImportStore(
            lambda user_id: user_imports_root(settings, user_id),
            all_users_root=settings.get_users_root_folder(),
            max_record_bytes=settings.max_user_file_import_record_bytes,
            limiter=io_limiter,
        )
        user_file_import_service = UserFileImportService(
            user_file_import_store,
            sample_data_service,
            data_portal_service,
            UserFileImportProcessExecutor(),
            storage_admission,
            event_hub,
            capacity=settings.user_file_import_capacity,
            max_storage_bytes=settings.max_user_file_import_bytes,
            max_storage_files=settings.max_user_file_import_files,
            max_record_bytes=settings.max_user_file_import_record_bytes,
        )
        await user_file_import_service.start(task_group)
        task_group_owner.register_admission_stopper(
            user_file_import_service.stop_accepting
        )
        task_group_owner.register_execution_shutdown(user_file_import_service.close)
        await user_file_store.reconcile_transient_storage(set())
        workspace_lifecycle_service = WorkspaceLifecycleService(
            workspace_service,
            analysis_execution,
        )
        analysis_result_service = AnalysisResultService(
            analysis_service,
            analysis_artifacts,
            storage_admission,
            settings,
            quotation_client,
            provider_credential_store,
            query_root=(
                settings.get_data_root() / ".analysis-result-queries" / "resources"
            ),
            cache_root=lambda user_id: user_cache_root(settings, user_id),
            limiter=io_limiter,
        )
        await analysis_result_service.reconcile()
        maintenance_service = MaintenanceService(session_service.cleanup_expired)
        task_group_owner.register_maintenance_shutdown(maintenance_service.close)
        maintenance_service.start(task_group)
        runtime = Runtime(
            settings=settings,
            readiness=readiness,
            task_group=task_group,
            io_limiter=io_limiter,
            quota_service=quota_service,
            storage_admission=storage_admission,
            response_snapshot_service=response_snapshot_service,
            workspace_service=workspace_service,
            workspace_lifecycle_service=workspace_lifecycle_service,
            workspace_archive_service=workspace_archive_service,
            user_file_store=user_file_store,
            file_read_service=file_read_service,
            node_service=node_service,
            data_block_export_service=data_block_export_service,
            workspace_sql_service=workspace_sql_service,
            session_service=session_service,
            oauth_service=oauth_service,
            event_hub=event_hub,
            quotation_client=quotation_client,
            analysis_service=analysis_service,
            analysis_execution=analysis_execution,
            analysis_result_service=analysis_result_service,
            annotation_service=annotation_service,
            user_preference_store=user_preference_store,
            provider_credential_store=provider_credential_store,
            sample_data_service=sample_data_service,
            data_portal_service=data_portal_service,
            user_file_import_service=user_file_import_service,
            maintenance_service=maintenance_service,
        )
        logger.info(
            "Starting LDaCA Wordflow (platform=%s, python=%s)",
            sys.platform,
            sys.version.split()[0],
        )

        yield runtime

    logger.info("LDaCA Wordflow runtime stopped")
