"""Retained User File Import lifecycle, scheduling, and publication."""

from __future__ import annotations

import logging
import math
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import anyio
from anyio.abc import TaskGroup
from pydantic import ValidationError

from ..domain import (
    DataPortalUserFileImportResult,
    SampleUserFileImportRequest,
    SampleUserFileImportResult,
    UserFileImport,
)
from ..domain.background import BackgroundState, Failure, Progress
from ..domain.events import EventResourceType
from ..infrastructure.storage.user_file_import_store import UserFileImportStore
from ..models.data_sources import DataPortalImportSubmitRequest
from ..models.user_file_imports import (
    UnavailableUserFileImport,
    UserFileImportItem,
    UserFileImportPage,
)
from ..shared.errors import (
    AppError,
    BackendStoppingError,
    format_exception_diagnostic,
    UserFileImportCorruptError,
    UserFileImportNotCancellableError,
    UserFileImportNotFoundError,
    UserFileImportNotTerminalError,
)
from .data_portal import DataPortalImportExecution, DataPortalService
from .events import EventHub
from .sample_data import SampleDataService, SampleImportExecution
from .storage_admission import StorageAdmissionService, StorageReservation
from .user_file_import_execution_types import (
    UserFileImportKey,
    UserFileImportSchedulingStopped,
)
from .user_file_import_executor import (
    UserFileImportProcessError,
    UserFileImportProcessExecutor,
)
from .user_file_import_scheduler import (
    ScheduledUserFileImport,
    UserFileImportScheduler,
)

logger = logging.getLogger(__name__)
ImportExecution = SampleImportExecution | DataPortalImportExecution
_UNAVAILABLE_IMPORT_WARNING = (
    "This User File Import is unavailable because its stored record is invalid."
)


class _CancellationReady(RuntimeError):
    """Private control flow after execution stopped before publication."""


class UserFileImportService:
    """Own every User File Import record, queue, handle, and cleanup action."""

    def __init__(
        self,
        store: UserFileImportStore,
        samples: SampleDataService,
        data_portal: DataPortalService,
        process_executor: UserFileImportProcessExecutor,
        storage_admission: StorageAdmissionService,
        events: EventHub,
        *,
        capacity: int,
        max_storage_bytes: int,
        max_storage_files: int,
        max_record_bytes: int,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if min(max_storage_bytes, max_storage_files, max_record_bytes) < 1:
            raise ValueError("User File Import storage limits must be positive")
        self._store = store
        self._samples = samples
        self._data_portal = data_portal
        self._process_executor = process_executor
        self._storage_admission = storage_admission
        self._events = events
        self._max_storage_bytes = max_storage_bytes
        self._max_storage_files = max_storage_files
        self._max_record_bytes = max_record_bytes
        self._clock = clock or (lambda: datetime.now(UTC))
        self._scheduler = UserFileImportScheduler(
            capacity=capacity,
            runner=self._run,
        )
        self._records: dict[UserFileImportKey, UserFileImport] = {}
        self._unavailable_records: dict[
            UserFileImportKey,
            UnavailableUserFileImport,
        ] = {}
        self._queued_executions: dict[UserFileImportKey, ImportExecution] = {}
        self._queued_reservations: dict[UserFileImportKey, StorageReservation] = {}
        self._live_progress: dict[UserFileImportKey, Progress] = {}
        self._operation_gates: dict[UserFileImportKey, anyio.Lock] = {}
        self._corrupt_users: set[str] = set()
        self._lock = anyio.Lock()
        self._accepting = True
        self._started = False

    async def start(self, task_group: TaskGroup) -> None:
        """Load retained history, fail lost work, and start fresh dispatch."""

        if self._started:
            raise RuntimeError("UserFileImportService is already started")
        snapshot = await self._store.load_all()
        self._corrupt_users = set(snapshot.corrupt_users)
        recovered_publications: dict[UserFileImportKey, UserFileImport] = {}
        for prepared in snapshot.prepared_publications:
            key = UserFileImportKey(prepared.user_id, prepared.resource.id)
            try:
                if await self._is_publication_visible(
                    prepared.user_id,
                    key.import_id,
                    prepared.resource.result,
                ):
                    await self._store.save(prepared.user_id, prepared.resource)
                    recovered_publications[key] = prepared.resource
                else:
                    await self._cleanup_prepared_publication(
                        prepared.user_id,
                        key.import_id,
                        prepared.resource.result,
                    )
                await self._store.clear_prepared_publication(
                    prepared.user_id,
                    prepared.resource.id,
                )
            except Exception:
                logger.exception(
                    "Could not reconcile prepared User File Import "
                    "import_id=%s user_id=%s",
                    key.import_id,
                    prepared.user_id,
                )
                self._corrupt_users.add(prepared.user_id)
        for stored in snapshot.unavailable_records:
            key = UserFileImportKey(stored.user_id, stored.import_id)
            self._unavailable_records[key] = UnavailableUserFileImport(
                availability="unavailable",
                id=stored.import_id,
                user_id=stored.user_id,
                warning=_UNAVAILABLE_IMPORT_WARNING,
            )
            self._operation_gates[key] = anyio.Lock()
        for stored in snapshot.records:
            key = UserFileImportKey(stored.user_id, stored.resource.id)
            record = recovered_publications.pop(key, stored.resource)
            if record.state in {BackgroundState.QUEUED, BackgroundState.RUNNING}:
                record = record.fail(
                    self._clock(),
                    failure=Failure(
                        code="user_file_import_interrupted",
                        message="User File import was interrupted",
                    ),
                    progress=record.progress,
                )
                try:
                    await self._store.save(stored.user_id, record)
                except Exception:
                    logger.exception(
                        "Could not reconcile User File Import import_id=%s user_id=%s",
                        record.id,
                        stored.user_id,
                    )
                    self._corrupt_users.add(stored.user_id)
                    continue
            self._records[key] = record
            self._operation_gates[key] = anyio.Lock()
        for key, record in recovered_publications.items():
            self._records[key] = record
            self._operation_gates[key] = anyio.Lock()
        self._scheduler.start(task_group)
        self._started = True

    async def submit_sample(
        self,
        user_id: str,
        collection_id: str,
    ) -> UserFileImport:
        """Persist and queue one complete sample collection import."""

        self._require_accepting()
        import_id = uuid.uuid4()
        key = UserFileImportKey(user_id, import_id)
        reservation = await self._acquire_storage(user_id)
        execution: SampleImportExecution | None = None
        persisted = False
        try:
            execution = await self._samples.prepare_import(
                user_id,
                collection_id,
                str(key.import_id),
            )
            record = UserFileImport.create(
                SampleUserFileImportRequest(collection_id=collection_id),
                timestamp=self._clock(),
                import_id=import_id,
            )
            await self._store.save(user_id, record)
            persisted = True
            await self._register_queued(key, record, execution, reservation)
            await self._publish_record(user_id, record)
            return record
        except BaseException:
            if execution is not None:
                with anyio.CancelScope(shield=True):
                    await self._samples.cleanup_import(user_id, str(key.import_id))
            if persisted:
                with anyio.CancelScope(shield=True):
                    await self._store.delete(user_id, import_id)
            with anyio.CancelScope(shield=True):
                await reservation.release()
            raise

    async def submit_data_portal(
        self,
        user_id: str,
        request: DataPortalImportSubmitRequest,
    ) -> UserFileImport:
        """Persist a secret-free request and queue one portal import."""

        self._require_accepting()
        import_id = uuid.uuid4()
        key = UserFileImportKey(user_id, import_id)
        reservation = await self._acquire_storage(user_id)
        execution: DataPortalImportExecution | None = None
        persisted = False
        try:
            persisted_request, execution = await self._data_portal.prepare_import(
                user_id,
                str(key.import_id),
                request,
            )
            record = UserFileImport.create(
                persisted_request,
                timestamp=self._clock(),
                import_id=import_id,
            )
            await self._store.save(user_id, record)
            persisted = True
            await self._register_queued(key, record, execution, reservation)
            await self._publish_record(user_id, record)
            return record
        except BaseException:
            if execution is not None:
                with anyio.CancelScope(shield=True):
                    await self._data_portal.cleanup_import(
                        user_id,
                        str(key.import_id),
                    )
            if persisted:
                with anyio.CancelScope(shield=True):
                    await self._store.delete(user_id, import_id)
            with anyio.CancelScope(shield=True):
                await reservation.release()
            raise

    async def get(self, user_id: str, import_id: uuid.UUID) -> UserFileImportItem:
        key = UserFileImportKey(user_id, import_id)
        async with self._lock:
            record = self._records.get(key)
            if record is None:
                unavailable = self._unavailable_records.get(key)
                if unavailable is None:
                    raise UserFileImportNotFoundError("User File Import not found")
                return unavailable
            return self._project(key, record)

    async def list(
        self,
        user_id: str,
        *,
        page: int,
        page_size: int,
    ) -> UserFileImportPage:
        async with self._lock:
            if user_id in self._corrupt_users:
                raise UserFileImportCorruptError(
                    "User File Import history is corrupt"
                )
            records = [
                (key, record)
                for key, record in self._records.items()
                if key.user_id == user_id
            ]
            records.sort(key=lambda item: str(item[1].id))
            records.sort(key=lambda item: item[1].created_at, reverse=True)
            items: list[UserFileImportItem] = [
                self._project(key, record) for key, record in records
            ]
            items.extend(
                resource
                for key, resource in sorted(
                    self._unavailable_records.items(),
                    key=lambda item: item[0].import_id,
                )
                if key.user_id == user_id
            )
        total_items = len(items)
        start = (page - 1) * page_size
        return UserFileImportPage(
            items=items[start : start + page_size],
            page=page,
            page_size=page_size,
            total_items=total_items,
            total_pages=math.ceil(total_items / page_size) if total_items else 0,
        )

    async def cancel(
        self,
        user_id: str,
        import_id: uuid.UUID,
    ) -> tuple[UserFileImport, bool]:
        """Cancel queued work now or request confirmed running cancellation."""

        key = UserFileImportKey(user_id, import_id)
        gate = await self._gate_for(key)
        async with gate:
            async with self._lock:
                record = self._records.get(key)
                if record is None:
                    if key in self._unavailable_records:
                        raise UserFileImportNotCancellableError(
                            "Unavailable User File Import is not cancellable"
                        )
                    raise UserFileImportNotFoundError("User File Import not found")
                if record.state in {BackgroundState.SUCCEEDED, BackgroundState.FAILED}:
                    raise UserFileImportNotCancellableError(
                        "User File Import is not cancellable"
                    )
                if record.state is BackgroundState.CANCELLED:
                    return self._project(key, record), False
                state = record.state

            target = await self._scheduler.cancel(key)
            if state is BackgroundState.QUEUED:
                if target == "missing":
                    raise RuntimeError("Queued import execution is unavailable")
                async with self._lock:
                    execution = self._queued_executions.pop(key, None)
                    reservation = self._queued_reservations.pop(key, None)
                if execution is None or reservation is None:
                    raise RuntimeError("Queued import execution is unavailable")
                await self._cleanup_execution(key, execution)
                await reservation.release()
                async with self._lock:
                    current = self._records[key]
                cancelled = current.cancel_queued(self._clock())
                await self._store.save(user_id, cancelled)
                async with self._lock:
                    self._records[key] = cancelled
                await self._publish_record(user_id, cancelled)
                return cancelled, False

            if target == "missing":
                raise RuntimeError("Running import execution is unavailable")
            async with self._lock:
                current = self._records[key]
                requested = current.request_running_cancellation(self._clock())
            if requested is not current:
                await self._store.save(user_id, requested)
                async with self._lock:
                    self._records[key] = requested
                await self._publish_record(user_id, requested)
            async with self._lock:
                return self._project(key, requested), True

    async def delete(self, user_id: str, import_id: uuid.UUID) -> None:
        key = UserFileImportKey(user_id, import_id)
        gate = await self._gate_for(key)
        async with gate:
            async with self._lock:
                record = self._records.get(key)
                unavailable = self._unavailable_records.get(key)
                if record is None and unavailable is None:
                    raise UserFileImportNotFoundError("User File Import not found")
                if record is not None and record.state not in {
                    BackgroundState.SUCCEEDED,
                    BackgroundState.FAILED,
                    BackgroundState.CANCELLED,
                }:
                    raise UserFileImportNotTerminalError(
                        "User File Import is not terminal"
                    )
            await self._store.delete(user_id, import_id)
            async with self._lock:
                removed = self._records.pop(key, None)
                self._unavailable_records.pop(key, None)
                self._live_progress.pop(key, None)
            await self._publish_removed(
                user_id,
                import_id,
                removed.revision if removed is not None else None,
            )
        async with self._lock:
            self._operation_gates.pop(key, None)

    def stop_accepting(self) -> None:
        """Reject new imports before runtime execution shutdown begins."""

        self._accepting = False

    async def has_work(self) -> bool:
        """Return whether switching roots would interrupt retained import work."""

        return await self._scheduler.has_work()

    async def close(self, deadline: float) -> None:
        """Stop dispatch, clean queued work, and terminate active execution."""

        self.stop_accepting()
        queued = await self._scheduler.stop_dispatch()
        await self._scheduler.cancel_active()
        async with anyio.create_task_group() as shutdown:
            for item in queued:
                shutdown.start_soon(self._interrupt_queued_safely, item.key)
            shutdown.start_soon(self._process_executor.close, deadline)
        with anyio.move_on_after(max(0.0, deadline - anyio.current_time())):
            await self._scheduler.wait_idle()

    async def _interrupt_queued_safely(self, key: UserFileImportKey) -> None:
        try:
            await self._interrupt_queued(key)
        except Exception:
            logger.exception(
                "Could not fail queued User File Import during shutdown "
                "import_id=%s user_id=%s",
                key.import_id,
                key.user_id,
            )

    def _require_accepting(self) -> None:
        if not self._started or not self._accepting:
            raise BackendStoppingError()

    async def _acquire_storage(self, user_id: str) -> StorageReservation:
        return await self._storage_admission.acquire(
            user_id,
            self._max_storage_bytes + self._max_record_bytes,
            requested_entries=self._max_storage_files + 2,
        )

    async def _register_queued(
        self,
        key: UserFileImportKey,
        record: UserFileImport,
        execution: ImportExecution,
        reservation: StorageReservation,
    ) -> None:
        async with self._lock:
            self._records[key] = record
            self._queued_executions[key] = execution
            self._queued_reservations[key] = reservation
            self._operation_gates[key] = anyio.Lock()
        try:
            await self._scheduler.enqueue(key, created_at=record.created_at)
        except UserFileImportSchedulingStopped:
            async with self._lock:
                self._records.pop(key, None)
                self._queued_executions.pop(key, None)
                self._queued_reservations.pop(key, None)
                self._operation_gates.pop(key, None)
            raise BackendStoppingError() from None
        except BaseException:
            async with self._lock:
                self._records.pop(key, None)
                self._queued_executions.pop(key, None)
                self._queued_reservations.pop(key, None)
                self._operation_gates.pop(key, None)
            raise

    async def _gate_for(self, key: UserFileImportKey) -> anyio.Lock:
        async with self._lock:
            gate = self._operation_gates.get(key)
            if gate is None:
                raise UserFileImportNotFoundError("User File Import not found")
            return gate

    def _project(
        self,
        key: UserFileImportKey,
        record: UserFileImport,
    ) -> UserFileImport:
        progress = self._live_progress.get(key)
        return record if progress is None else record.model_copy(update={"progress": progress})

    async def _run(self, item: ScheduledUserFileImport) -> None:
        key = item.key
        execution: ImportExecution | None = None
        reservation: StorageReservation | None = None
        failure: Failure | None = None
        cancellation_ready = False
        try:
            gate = await self._gate_for(key)
            async with gate:
                async with self._lock:
                    record = self._records.get(key)
                    execution = self._queued_executions.get(key)
                    reservation = self._queued_reservations.get(key)
                    if (
                        record is None
                        or record.state is not BackgroundState.QUEUED
                        or execution is None
                        or reservation is None
                    ):
                        return
                    running = record.start(self._clock())
                await self._store.save(key.user_id, running)
                async with self._lock:
                    self._records[key] = running
                    self._queued_executions.pop(key, None)
                    self._queued_reservations.pop(key, None)
                await self._publish_record(key.user_id, running)

            if isinstance(execution, SampleImportExecution):
                result = await self._samples.execute_import(
                    execution,
                    lambda progress: self.report_progress(key, progress),
                )
            else:
                result = await self._data_portal.execute_import(
                    key,
                    execution,
                    self._process_executor,
                    lambda progress: self.report_progress(key, progress),
                )
            await self._complete(key, execution, reservation, result)
        except _CancellationReady:
            cancellation_ready = True
        except anyio.get_cancelled_exc_class():
            cancellation_ready = True
        except AppError as exc:
            failure = Failure(
                code=exc.code,
                message=(
                    format_exception_diagnostic(exc)
                    if exc.status_code >= 500
                    else exc.message
                ),
            )
        except UserFileImportProcessError as exc:
            logger.exception(
                "Data Portal import failed import_id=%s user_id=%s",
                key.import_id,
                key.user_id,
            )
            failure = Failure(
                code="user_file_import_execution_failed",
                message=format_exception_diagnostic(exc),
            )
        except Exception as exc:
            logger.exception(
                "User File Import failed import_id=%s user_id=%s",
                key.import_id,
                key.user_id,
            )
            failure = Failure(
                code="user_file_import_execution_failed",
                message=format_exception_diagnostic(exc),
            )
        finally:
            if execution is not None:
                with anyio.CancelScope(shield=True):
                    try:
                        await self._cleanup_execution(key, execution)
                    except Exception:
                        logger.exception(
                            "Could not clean User File Import import_id=%s user_id=%s",
                            key.import_id,
                            key.user_id,
                        )
            if reservation is not None:
                with anyio.CancelScope(shield=True):
                    await reservation.release()

        with anyio.CancelScope(shield=True):
            if cancellation_ready:
                await self._finish_interruption(key)
            elif failure is not None:
                await self._fail(key, failure)

    async def report_progress(
        self,
        key: UserFileImportKey,
        payload: object,
    ) -> None:
        """Validate one live progress value or isolate failure to its import."""

        terminate = False
        gate = await self._gate_for(key)
        async with gate:
            async with self._lock:
                record = self._records.get(key)
                if record is None or record.state is not BackgroundState.RUNNING:
                    return
                previous_live = self._live_progress.get(key)
                try:
                    progress = Progress.model_validate(payload)
                    if progress.fraction == 1.0:
                        raise ValueError("Executors cannot report completion")
                    if progress.fraction is None:
                        if (
                            previous_live is not None
                            and previous_live.fraction is not None
                        ):
                            raise ValueError("Progress cannot return to indeterminate")
                    else:
                        previous_fraction = (
                            previous_live.fraction
                            if previous_live is not None
                            else record.progress.fraction
                        )
                        if (
                            previous_fraction is not None
                            and progress.fraction < previous_fraction
                        ):
                            raise ValueError("Progress cannot decrease")
                except (ValidationError, ValueError) as exc:
                    logger.warning(
                        "Invalid User File Import progress import_id=%s user_id=%s",
                        key.import_id,
                        key.user_id,
                        exc_info=True,
                    )
                    failed = record.fail(
                        self._clock(),
                        failure=Failure(
                            code="progress_invalid",
                            message=format_exception_diagnostic(exc),
                        ),
                        progress=self._current_progress(key, record),
                    )
                else:
                    self._live_progress[key] = progress
                    failed = None
            if failed is None:
                await self._publish_progress(key, progress)
                return
            await self._store.save(key.user_id, failed)
            async with self._lock:
                self._records[key] = failed
                self._live_progress.pop(key, None)
                terminate = True
            await self._publish_record(key.user_id, failed)
        if terminate:
            await self._scheduler.cancel(key)

    async def _complete(
        self,
        key: UserFileImportKey,
        execution: ImportExecution,
        reservation: StorageReservation,
        result: SampleUserFileImportResult | DataPortalUserFileImportResult,
    ) -> None:
        gate = await self._gate_for(key)
        async with gate:
            async with self._lock:
                record = self._records.get(key)
                if record is None or record.state is not BackgroundState.RUNNING:
                    return
                if record.cancellation_requested_at is not None:
                    raise _CancellationReady()

            staging = self._staging_path(execution)
            await reservation.recheck_path(staging)
            async with self._lock:
                current = self._records.get(key)
                if current is None or current.state is not BackgroundState.RUNNING:
                    return
                succeeded = current.succeed(self._clock(), result=result)
            await self._store.prepare_publication(key.user_id, succeeded)
            if isinstance(execution, SampleImportExecution):
                if not isinstance(result, SampleUserFileImportResult):
                    raise TypeError("Sample import returned the wrong Result")
            elif not isinstance(result, DataPortalUserFileImportResult):
                raise TypeError("Data Portal import returned the wrong Result")
            with anyio.CancelScope(shield=True):
                try:
                    await self._publish_import_result(
                        key.user_id,
                        key.import_id,
                        result,
                    )
                except Exception:
                    if not await self._is_publication_visible(
                        key.user_id,
                        key.import_id,
                        result,
                    ):
                        await self._store.clear_prepared_publication(
                            key.user_id,
                            succeeded.id,
                        )
                        raise
                record_saved = False
                try:
                    await self._store.save(key.user_id, succeeded)
                    record_saved = True
                except Exception:
                    logger.exception(
                        "Could not commit published User File Import record "
                        "import_id=%s user_id=%s",
                        key.import_id,
                        key.user_id,
                    )
                async with self._lock:
                    self._records[key] = succeeded
                    self._live_progress.pop(key, None)
                if record_saved:
                    try:
                        await self._store.clear_prepared_publication(
                            key.user_id,
                            succeeded.id,
                        )
                    except Exception:
                        logger.exception(
                            "Could not clear prepared User File Import "
                            "import_id=%s user_id=%s",
                            key.import_id,
                            key.user_id,
                        )
            await self._publish_record(key.user_id, succeeded)

    async def _publish_import_result(
        self,
        user_id: str,
        import_id: uuid.UUID,
        result: SampleUserFileImportResult | DataPortalUserFileImportResult,
    ) -> None:
        if isinstance(result, SampleUserFileImportResult):
            await self._samples.publish_import(user_id, str(import_id), result)
            return
        await self._data_portal.publish_import(user_id, str(import_id), result)

    async def _is_publication_visible(
        self,
        user_id: str,
        import_id: uuid.UUID,
        result: SampleUserFileImportResult | DataPortalUserFileImportResult | None,
    ) -> bool:
        if isinstance(result, SampleUserFileImportResult):
            return await self._samples.is_import_published(
                user_id,
                str(import_id),
                result,
            )
        if isinstance(result, DataPortalUserFileImportResult):
            return await self._data_portal.is_import_published(
                user_id,
                str(import_id),
                result,
            )
        raise TypeError("Prepared publication is missing its Result")

    async def _cleanup_prepared_publication(
        self,
        user_id: str,
        import_id: uuid.UUID,
        result: SampleUserFileImportResult | DataPortalUserFileImportResult | None,
    ) -> None:
        if isinstance(result, SampleUserFileImportResult):
            await self._samples.cleanup_import(user_id, str(import_id))
            return
        if isinstance(result, DataPortalUserFileImportResult):
            await self._data_portal.cleanup_import(user_id, str(import_id))
            return
        raise TypeError("Prepared publication is missing its Result")

    async def _finish_interruption(self, key: UserFileImportKey) -> None:
        gate = await self._gate_for(key)
        async with gate:
            async with self._lock:
                record = self._records.get(key)
                if record is None or record.state is not BackgroundState.RUNNING:
                    return
                progress = self._current_progress(key, record)
                if record.cancellation_requested_at is not None:
                    terminal = record.confirm_cancelled(
                        self._clock(),
                        progress=progress,
                    )
                else:
                    terminal = record.fail(
                        self._clock(),
                        failure=Failure(
                            code="user_file_import_interrupted",
                            message="User File import was interrupted",
                        ),
                        progress=progress,
                    )
            await self._store.save(key.user_id, terminal)
            async with self._lock:
                self._records[key] = terminal
                self._live_progress.pop(key, None)
            await self._publish_record(key.user_id, terminal)

    async def _fail(self, key: UserFileImportKey, failure: Failure) -> None:
        gate = await self._gate_for(key)
        async with gate:
            async with self._lock:
                record = self._records.get(key)
                if record is None or record.state not in {
                    BackgroundState.QUEUED,
                    BackgroundState.RUNNING,
                }:
                    return
                failed = record.fail(
                    self._clock(),
                    failure=failure,
                    progress=self._current_progress(key, record),
                )
            await self._store.save(key.user_id, failed)
            async with self._lock:
                self._records[key] = failed
                self._live_progress.pop(key, None)
            await self._publish_record(key.user_id, failed)

    async def _interrupt_queued(self, key: UserFileImportKey) -> None:
        gate = await self._gate_for(key)
        async with gate:
            async with self._lock:
                record = self._records.get(key)
                execution = self._queued_executions.pop(key, None)
                reservation = self._queued_reservations.pop(key, None)
            if execution is not None:
                await self._cleanup_execution(key, execution)
            if reservation is not None:
                await reservation.release()
            if record is None or record.state is not BackgroundState.QUEUED:
                return
            failed = record.fail(
                self._clock(),
                failure=Failure(
                    code="user_file_import_interrupted",
                    message="User File import was interrupted",
                ),
                progress=record.progress,
            )
            await self._store.save(key.user_id, failed)
            async with self._lock:
                self._records[key] = failed
            await self._publish_record(key.user_id, failed)

    async def _cleanup_execution(
        self,
        key: UserFileImportKey,
        execution: ImportExecution,
    ) -> None:
        if isinstance(execution, SampleImportExecution):
            await self._samples.cleanup_import(key.user_id, str(key.import_id))
        else:
            await self._data_portal.cleanup_import(
                key.user_id,
                str(key.import_id),
            )

    @staticmethod
    def _staging_path(execution: ImportExecution) -> Path:
        return execution.staging

    def _current_progress(
        self,
        key: UserFileImportKey,
        record: UserFileImport,
    ) -> Progress:
        return self._live_progress.get(key, record.progress)

    async def _publish_record(
        self,
        user_id: str,
        record: UserFileImport,
    ) -> None:
        try:
            await self._events.publish_changed(
                user_id,
                EventResourceType.USER_FILE_IMPORT,
                record.id,
                revision=record.revision,
                state=record.state,
                progress=record.progress,
            )
        except Exception:
            logger.exception(
                "Could not publish User File Import event import_id=%s user_id=%s",
                record.id,
                user_id,
            )

    async def _publish_progress(
        self,
        key: UserFileImportKey,
        progress: Progress,
    ) -> None:
        try:
            await self._events.publish_progress(
                key.user_id,
                EventResourceType.USER_FILE_IMPORT,
                key.import_id,
                progress,
            )
        except Exception:
            logger.exception(
                "Could not publish User File Import progress import_id=%s user_id=%s",
                key.import_id,
                key.user_id,
            )

    async def _publish_removed(
        self,
        user_id: str,
        import_id: uuid.UUID,
        revision: int | None,
    ) -> None:
        try:
            await self._events.publish_removed(
                user_id,
                EventResourceType.USER_FILE_IMPORT,
                import_id,
                revision=revision,
            )
        except Exception:
            logger.exception(
                "Could not publish User File Import removal import_id=%s user_id=%s",
                import_id,
                user_id,
            )


__all__ = ["UserFileImportService"]
