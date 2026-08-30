"""Analysis adapter for the shared supervised fresh-process runner."""

from __future__ import annotations

from .analysis_execution_types import AnalysisExecutionKey, AnalysisInvocation
from .supervised_process import (
    PipeConnection,
    ProgressReporter,
    SupervisedProcessCancelled,
    SupervisedProcessError,
    SupervisedProcessRunner,
    SupervisedProcessStartError,
    poll_result_connection,
)
from ..workers.entrypoints import analysis_process

AnalysisProcessCancelled = SupervisedProcessCancelled
AnalysisProcessError = SupervisedProcessError
AnalysisProcessStartError = SupervisedProcessStartError
_poll_result_connection = poll_result_connection


class AnalysisProcessExecutor:
    """Bind Analysis invocation and cancellation keys to shared supervision."""

    def __init__(self) -> None:
        self._runner = SupervisedProcessRunner[AnalysisExecutionKey]("Analysis")

    async def reserve(self, key: AnalysisExecutionKey) -> None:
        await self._runner.reserve(key)

    async def discard_reservation(self, key: AnalysisExecutionKey) -> None:
        await self._runner.discard_reservation(key)

    async def execute_reserved(
        self,
        key: AnalysisExecutionKey,
        invocation: AnalysisInvocation,
        report_progress: ProgressReporter,
    ) -> object:
        return await self._runner.execute_reserved(
            key,
            analysis_process,
            {"invocation": invocation.input},
            report_progress,
            storage_roots=invocation.storage_roots,
            max_storage_bytes=invocation.max_storage_bytes,
            max_storage_files=invocation.max_storage_files,
        )

    async def cancel(self, key: AnalysisExecutionKey) -> None:
        await self._runner.cancel(key)

    async def close(self, deadline: float) -> None:
        await self._runner.close(deadline)


__all__ = [
    "AnalysisProcessCancelled",
    "AnalysisProcessError",
    "AnalysisProcessStartError",
    "AnalysisProcessExecutor",
    "PipeConnection",
]
