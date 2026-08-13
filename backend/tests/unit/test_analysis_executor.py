"""Fresh-process Analysis launch and confirmed cancellation tests."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, cast

import anyio
import pytest

from ldaca_wordflow.services.analysis_execution_types import (
    AnalysisInvocation,
    AnalysisExecutionKey,
)
from ldaca_wordflow.services.analysis_executor import (
    AnalysisProcessCancelled,
    AnalysisProcessExecutor,
    _poll_result_connection,
)
from ldaca_wordflow.workers.entrypoints import _progress_callback


def _blocking_worker(*, progress_queue: Any) -> str:
    progress_queue.put({"fraction": 0.1, "message": "Started"})
    while True:
        time.sleep(0.1)


def _echo_worker(*, value: str, progress_queue: Any) -> str:
    progress_queue.put({"fraction": 0.5, "message": "Working"})
    return value


def _immediate_invalid_progress_worker(*, progress_queue: Any) -> str:
    progress_queue.put({"fraction": 1.0, "message": "Premature completion"})
    return "result"


def _report_then_write(*, destination: str, progress_queue: Any) -> str:
    progress_queue.put({"fraction": 0.5, "message": "Working"})
    time.sleep(0.5)
    Path(destination).write_text("orphaned", encoding="utf-8")
    return "result"


def _key(value: str) -> AnalysisExecutionKey:
    return AnalysisExecutionKey("user", "workspace", value)


def test_broken_result_pipe_has_no_available_envelope() -> None:
    class BrokenResultPipe:
        def poll(self, _timeout: float = 0.0) -> bool:
            raise BrokenPipeError

    assert not _poll_result_connection(cast(Any, BrokenResultPipe()), 0.05)


def _invocation(function, **kwargs: object) -> AnalysisInvocation:
    return AnalysisInvocation(
        function=function,
        kwargs=kwargs,
        storage_roots=(),
        max_storage_bytes=1024 * 1024,
        max_storage_files=10,
    )


def test_process_entrypoint_forwards_progress_for_domain_validation() -> None:
    payloads: list[object] = []

    class Queue:
        def put(self, payload: object) -> None:
            payloads.append(payload)

    report = _progress_callback(cast(Any, Queue()))
    report(1.0, "Premature completion")
    report(-1.0, "Invalid failure sentinel")
    cast(Any, report)("0.5", 123)

    assert payloads == [
        {"fraction": 1.0, "message": "Premature completion"},
        {"fraction": -1.0, "message": "Invalid failure sentinel"},
        {"fraction": "0.5", "message": 123},
    ]


@pytest.mark.anyio
async def test_cancel_before_launch_suppresses_the_process() -> None:
    executor = AnalysisProcessExecutor()
    key = _key("suppressed")
    await executor.reserve(key)
    await executor.cancel(key)

    with pytest.raises(AnalysisProcessCancelled):
        await executor.execute_reserved(key, _invocation(_echo_worker, value="no"), _ignore)

    assert executor._entries == {}
    await executor.close(anyio.current_time() + 1)


@pytest.mark.anyio
async def test_terminating_one_analysis_does_not_poison_the_next() -> None:
    executor = AnalysisProcessExecutor()
    first = _key("first")
    started = anyio.Event()

    async def observe(_payload: object) -> None:
        started.set()

    async def run_first() -> None:
        with pytest.raises(AnalysisProcessCancelled):
            await executor.execute_reserved(
                first,
                _invocation(_blocking_worker),
                observe,
            )

    await executor.reserve(first)
    async with anyio.create_task_group() as task_group:
        task_group.start_soon(run_first)
        with anyio.fail_after(5):
            await started.wait()
        await executor.cancel(first)

    second = _key("second")
    await executor.reserve(second)
    result = await executor.execute_reserved(
        second,
        _invocation(_echo_worker, value="healthy"),
        _ignore,
    )

    assert result == "healthy"
    await executor.close(anyio.current_time() + 1)


@pytest.mark.anyio
async def test_result_cannot_overtake_a_flushed_progress_report() -> None:
    executor = AnalysisProcessExecutor()
    key = _key("progress-before-result")
    reports: list[object] = []

    async def observe(payload: object) -> None:
        reports.append(payload)

    await executor.reserve(key)
    result = await executor.execute_reserved(
        key,
        _invocation(_immediate_invalid_progress_worker),
        observe,
    )

    assert reports == [{"fraction": 1.0, "message": "Premature completion"}]
    assert result == "result"
    await executor.close(anyio.current_time() + 1)


@pytest.mark.anyio
async def test_progress_failure_terminates_the_owned_process(tmp_path: Path) -> None:
    executor = AnalysisProcessExecutor()
    key = _key("progress-failure")
    destination = tmp_path / "orphan.txt"

    async def reject_progress(_payload: object) -> None:
        raise ValueError("invalid progress")

    await executor.reserve(key)
    with pytest.raises(ValueError, match="invalid progress"):
        await executor.execute_reserved(
            key,
            AnalysisInvocation(
                function=_report_then_write,
                kwargs={"destination": str(destination)},
                storage_roots=(str(tmp_path),),
                max_storage_bytes=1024,
                max_storage_files=10,
            ),
            reject_progress,
        )

    await anyio.sleep(0.6)
    assert not destination.exists()
    await executor.close(anyio.current_time() + 1)


async def _ignore(_payload: object) -> None:
    return
