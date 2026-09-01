"""Lifespan-owned composition of Analysis scheduling and process execution."""

from __future__ import annotations

import logging
import shutil
import uuid
from datetime import datetime
from functools import partial
from typing import cast

import anyio
from anyio.abc import TaskGroup
from anyio.to_thread import run_sync as run_sync_in_worker_thread
from pydantic import ValidationError

from ..models.analysis_results import AnalysisWorkerFailure
from ..shared.errors import AppError, format_exception_diagnostic
from .analyses import AnalysisService
from .analysis_execution_types import (
    AnalysisExecutionControl,
    AnalysisExecutionKey,
)
from .analysis_executor import (
    AnalysisProcessCancelled,
    AnalysisProcessError,
    AnalysisProcessExecutor,
    AnalysisProcessStartError,
)
from .analysis_preparation import AnalysisExecutionPreparer
from .analysis_scheduler import AnalysisScheduler, ScheduledAnalysis
from .workspace import WorkspaceService

logger = logging.getLogger(__name__)


class AnalysisExecutionRuntime(AnalysisExecutionControl):
    """Keep queues and handles private while AnalysisService owns all state."""

    def __init__(
        self,
        *,
        capacity: int,
        preparer: AnalysisExecutionPreparer,
        executor: AnalysisProcessExecutor,
        limiter: anyio.CapacityLimiter,
        workspaces: WorkspaceService,
        storage_reservation_bytes: int,
        storage_reservation_files: int,
    ) -> None:
        self._preparer = preparer
        self._executor = executor
        self._limiter = limiter
        self._workspaces = workspaces
        self._storage_reservation_bytes = storage_reservation_bytes
        self._storage_reservation_files = storage_reservation_files
        self._service: AnalysisService | None = None
        self._scheduler = AnalysisScheduler(
            capacity=capacity,
            runner=self._run,
            cancel_running=executor.cancel,
            work_removed=self._work_removed,
        )

    def bind(self, service: AnalysisService, task_group: TaskGroup) -> None:
        """Complete one-time runtime wiring and start dispatch."""

        if self._service is not None:
            raise RuntimeError("Analysis execution runtime is already bound")
        self._service = service
        self._scheduler.start(task_group)

    async def enqueue(
        self,
        key: AnalysisExecutionKey,
        *,
        created_at: datetime,
        credential: str | None,
    ) -> None:
        await self._scheduler.enqueue(
            key,
            created_at=created_at,
            credential=credential,
        )

    async def cancel(self, key: AnalysisExecutionKey) -> None:
        await self._scheduler.cancel(key)

    async def has_workspace_work(
        self, user_id: str, workspace_id: uuid.UUID
    ) -> bool:
        return await self._scheduler.has_workspace_work(user_id, workspace_id)

    async def cancel_workspace(self, user_id: str, workspace_id: uuid.UUID) -> None:
        """Stop every queued or active execution owned by a deleting Workspace."""

        await self._scheduler.cancel_workspace(user_id, workspace_id)

    async def stop_dispatch(self) -> list[ScheduledAnalysis]:
        return await self._scheduler.stop_dispatch()

    async def active_keys(self) -> set[AnalysisExecutionKey]:
        return await self._scheduler.active_keys()

    async def has_work(self) -> bool:
        """Return whether switching roots would interrupt Analysis work."""

        return await self._scheduler.has_work()

    async def close(self, deadline: float) -> None:
        """Stop dispatch, terminate runners, and commit truthful terminal state."""

        service = self._service
        if service is None:
            await self._executor.close(deadline)
            return

        service.stop_accepting()
        queued = await self._scheduler.stop_dispatch()
        selected = await self._scheduler.active_keys()

        async with anyio.create_task_group() as shutdown:
            for item in queued:
                shutdown.start_soon(
                    self._interrupt_queued_safely,
                    service,
                    item.key,
                )
            shutdown.start_soon(self._executor.close, deadline)

        idle = False
        with anyio.move_on_after(max(0.0, deadline - anyio.current_time())):
            await self._scheduler.wait_idle()
            idle = True

        if not idle:
            return
        for key in selected:
            try:
                await service.interrupt_execution(key)
            except Exception:
                logger.exception(
                    "Could not finalize Analysis shutdown interruption "
                    "analysis_id=%s user_id=%s",
                    key.analysis_id,
                    key.user_id,
                )

    @staticmethod
    async def _interrupt_queued_safely(
        service: AnalysisService,
        key: AnalysisExecutionKey,
    ) -> None:
        try:
            await service.interrupt_queued_execution(key)
        except Exception:
            logger.exception(
                "Could not fail queued Analysis during shutdown "
                "analysis_id=%s user_id=%s",
                key.analysis_id,
                key.user_id,
            )

    async def _run(self, item: ScheduledAnalysis) -> None:
        service = self._service
        if service is None:
            raise RuntimeError("Analysis execution runtime is not bound")
        try:
            async with self._workspaces.admit_storage(
                item.key.user_id,
                self._storage_reservation_bytes,
                requested_entries=self._storage_reservation_files,
            ):
                await self._run_admitted(item, service)
        except AppError as exc:
            await service.fail_execution(
                item.key,
                code=exc.code,
                message=(
                    format_exception_diagnostic(exc)
                    if exc.status_code >= 500
                    else exc.message
                ),
            )
        except Exception as exc:
            logger.exception(
                "Analysis admission failed analysis_id=%s user_id=%s",
                item.key.analysis_id,
                item.key.user_id,
            )
            await service.fail_execution(
                item.key,
                message=format_exception_diagnostic(exc),
            )

    async def _run_admitted(
        self,
        item: ScheduledAnalysis,
        service: AnalysisService,
    ) -> None:

        async def prepare(lease, record, credential):
            return await self._preparer.prepare(
                lease,
                record,
                credential,
                user_id=item.key.user_id,
            )

        invocation = await service.admit_execution(
            item.key,
            credential=item.credential,
            prepare=prepare,
            reserve_launch=self._executor.reserve,
            discard_launch=self._executor.discard_reservation,
        )
        if invocation is None:
            return

        try:
            result = await self._executor.execute_reserved(
                item.key,
                invocation,
                partial(service.report_progress, item.key),
            )
        except AnalysisProcessCancelled:
            await service.confirm_cancellation(item.key)
        except AnalysisProcessStartError as exc:
            logger.exception(
                "Analysis process launch failed analysis_id=%s user_id=%s",
                item.key.analysis_id,
                item.key.user_id,
            )
            await service.fail_execution(
                item.key,
                code="analysis_start_failed",
                message=format_exception_diagnostic(exc),
            )
        except AnalysisProcessError as exc:
            logger.exception(
                "Analysis process failed analysis_id=%s user_id=%s",
                item.key.analysis_id,
                item.key.user_id,
            )
            await service.fail_execution(
                item.key,
                message=format_exception_diagnostic(exc),
            )
        except Exception as exc:
            logger.exception(
                "Analysis execution failed analysis_id=%s user_id=%s",
                item.key.analysis_id,
                item.key.user_id,
            )
            await service.fail_execution(
                item.key,
                message=format_exception_diagnostic(exc),
            )
        else:
            result_mapping = (
                cast(dict[str, object], result)
                if isinstance(result, dict)
                else None
            )
            if result_mapping is not None and result_mapping.get("state") == "failed":
                try:
                    failure = AnalysisWorkerFailure.model_validate(result_mapping)
                except ValidationError as exc:
                    logger.error(
                        "Analysis returned an invalid failure envelope "
                        "analysis_id=%s user_id=%s",
                        item.key.analysis_id,
                        item.key.user_id,
                    )
                    await service.fail_execution(
                        item.key,
                        message=format_exception_diagnostic(exc),
                    )
                else:
                    await service.fail_execution(
                        item.key,
                        code=failure.failure.code,
                        message=failure.failure.message,
                    )
            else:
                await service.complete_execution(item.key, result)
        finally:
            await self._cleanup_invocation(invocation.storage_roots)

    async def _cleanup_invocation(
        self,
        roots: tuple[str, ...],
    ) -> None:
        with anyio.CancelScope(shield=True):
            for raw_path in roots:
                try:
                    await run_sync_in_worker_thread(
                        shutil.rmtree,
                        raw_path,
                        abandon_on_cancel=False,
                        limiter=self._limiter,
                    )
                except FileNotFoundError:
                    continue
                except OSError:
                    logger.exception(
                        "Could not remove private Analysis execution staging path=%s",
                        raw_path,
                    )

    async def _work_removed(self, key: AnalysisExecutionKey) -> None:
        """Finalize an explicit deferred close after its last runner drains."""

        try:
            await self._workspaces.finalize_close_if_idle(
                key.user_id,
                key.workspace_id,
                self.has_workspace_work,
            )
        except Exception:
            logger.exception(
                "Could not finalize deferred Workspace close "
                "workspace_id=%s user_id=%s",
                key.workspace_id,
                key.user_id,
            )


__all__ = ["AnalysisExecutionRuntime"]
