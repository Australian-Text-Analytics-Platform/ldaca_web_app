"""Structured worker diagnostics bypass Analysis artifact publication."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast
import uuid

import anyio

from ldaca_wordflow.services.analyses import AnalysisService
from ldaca_wordflow.services.analysis_execution import AnalysisExecutionRuntime
from ldaca_wordflow.services.analysis_execution_types import (
    AnalysisExecutionKey,
    AnalysisInvocation,
)
from ldaca_wordflow.services.analysis_scheduler import ScheduledAnalysis
from ldaca_wordflow.workers.invocations import PreviewReadyInput


class _Executor:
    async def reserve(self, _key):
        return None

    async def discard_reservation(self, _key):
        return None

    async def execute_reserved(self, _key, _invocation, _progress):
        return {
            "state": "failed",
            "failure": {
                "code": "annotation_provider_access_denied",
                "message": "ProviderError: account lacks model access",
            },
        }


class _Service:
    def __init__(self) -> None:
        self.failures: list[tuple[str, str]] = []
        self.completed = False

    async def admit_execution(self, _key, **_kwargs):
        return AnalysisInvocation(
            input=PreviewReadyInput(),
            storage_roots=(),
            max_storage_bytes=1,
            max_storage_files=1,
        )

    async def report_progress(self, *_args):
        return None

    async def fail_execution(self, _key, *, code, message):
        self.failures.append((code, message))

    async def complete_execution(self, _key, _result):
        self.completed = True


async def test_worker_diagnostic_is_persisted_without_publication() -> None:
    runtime = object.__new__(AnalysisExecutionRuntime)
    uninitialized_runtime = cast(Any, runtime)
    uninitialized_runtime._executor = _Executor()
    uninitialized_runtime._preparer = object()
    runtime._limiter = anyio.CapacityLimiter(1)
    key = AnalysisExecutionKey("user", uuid.uuid4(), uuid.uuid4())
    item = ScheduledAnalysis(key, datetime.now(UTC), "captured-key")
    service = _Service()

    await runtime._run_admitted(item, cast("AnalysisService", service))

    assert service.failures == [
        (
            "annotation_provider_access_denied",
            "ProviderError: account lacks model access",
        )
    ]
    assert service.completed is False
