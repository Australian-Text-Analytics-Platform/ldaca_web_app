"""Fresh-process Analysis launch and confirmed cancellation tests."""

from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any, cast

import anyio
import pytest

from ldaca_wordflow.services.analysis_execution_types import AnalysisExecutionKey
from ldaca_wordflow.services.supervised_process import (
    SupervisedProcessCancelled,
    SupervisedProcessError,
    SupervisedProcessRunner,
    poll_result_connection,
)
from ldaca_wordflow.shared.errors import format_exception_diagnostic
from ldaca_wordflow.workers.entrypoints import _progress_callback, analysis_process
from ldaca_wordflow.workers.invocations import PreviewReadyInput


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


def _failing_worker(*, message: str, progress_queue: Any) -> str:
    del progress_queue
    raise ValueError(message)


def test_broken_result_pipe_has_no_available_envelope() -> None:
    class BrokenResultPipe:
        def poll(self, _timeout: float = 0.0) -> bool:
            raise BrokenPipeError

    assert not poll_result_connection(cast(Any, BrokenResultPipe()), 0.05)


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
    runner = SupervisedProcessRunner[str]("test worker")
    await runner.reserve("suppressed")
    await runner.cancel("suppressed")

    with pytest.raises(SupervisedProcessCancelled):
        await runner.execute_reserved(
            "suppressed",
            _echo_worker,
            {"value": "no"},
            _ignore,
            storage_roots=(),
            max_storage_bytes=1024 * 1024,
            max_storage_files=10,
        )

    await runner.close(anyio.current_time() + 1)


@pytest.mark.anyio
async def test_terminating_one_analysis_does_not_poison_the_next() -> None:
    runner = SupervisedProcessRunner[str]("test worker")
    started = anyio.Event()

    async def observe(_payload: object) -> None:
        started.set()

    async def run_first() -> None:
        with pytest.raises(SupervisedProcessCancelled):
            await runner.execute_reserved(
                "first",
                _blocking_worker,
                {},
                observe,
                storage_roots=(),
                max_storage_bytes=1024 * 1024,
                max_storage_files=10,
            )

    await runner.reserve("first")
    async with anyio.create_task_group() as task_group:
        task_group.start_soon(run_first)
        with anyio.fail_after(5):
            await started.wait()
        await runner.cancel("first")

    result = await runner.execute(
        "second",
        _echo_worker,
        {"value": "healthy"},
        _ignore,
        storage_roots=(),
        max_storage_bytes=1024 * 1024,
        max_storage_files=10,
    )

    assert result == "healthy"
    await runner.close(anyio.current_time() + 1)


@pytest.mark.anyio
async def test_result_cannot_overtake_a_flushed_progress_report() -> None:
    runner = SupervisedProcessRunner[str]("test worker")
    reports: list[object] = []

    async def observe(payload: object) -> None:
        reports.append(payload)

    result = await runner.execute(
        "progress-before-result",
        _immediate_invalid_progress_worker,
        {},
        observe,
        storage_roots=(),
        max_storage_bytes=1024 * 1024,
        max_storage_files=10,
    )

    assert reports == [{"fraction": 1.0, "message": "Premature completion"}]
    assert result == "result"
    await runner.close(anyio.current_time() + 1)


@pytest.mark.anyio
async def test_child_failure_separates_complete_diagnostic_from_traceback() -> None:
    runner = SupervisedProcessRunner[str]("test worker")
    message = "diagnostic-" + ("x" * 1_000)

    with pytest.raises(SupervisedProcessError) as captured:
        await runner.execute(
            "failure",
            _failing_worker,
            {"message": message},
            _ignore,
            storage_roots=(),
            max_storage_bytes=1024 * 1024,
            max_storage_files=10,
        )

    assert format_exception_diagnostic(captured.value) == f"ValueError: {message}"
    assert "test_supervised_process.py" not in str(captured.value)
    assert any(
        "test_supervised_process.py" in note
        for note in getattr(captured.value, "__notes__", ())
    )
    await runner.close(anyio.current_time() + 1)


@pytest.mark.anyio
async def test_progress_failure_terminates_the_owned_process(tmp_path: Path) -> None:
    runner = SupervisedProcessRunner[str]("test worker")
    destination = tmp_path / "orphan.txt"

    async def reject_progress(_payload: object) -> None:
        raise ValueError("invalid progress")

    with pytest.raises(ValueError, match="invalid progress"):
        await runner.execute(
            "progress-failure",
            _report_then_write,
            {"destination": str(destination)},
            reject_progress,
            storage_roots=(str(tmp_path),),
            max_storage_bytes=1024,
            max_storage_files=10,
        )

    await anyio.sleep(0.6)
    assert not destination.exists()
    await runner.close(anyio.current_time() + 1)


@pytest.mark.anyio
async def test_supervised_runner_dispatches_the_typed_analysis_entrypoint() -> None:
    runner = SupervisedProcessRunner[AnalysisExecutionKey]("Analysis")
    key = AnalysisExecutionKey("user", uuid.uuid4(), uuid.uuid4())
    await runner.reserve(key)

    result = await runner.execute_reserved(
        key,
        analysis_process,
        {"invocation": PreviewReadyInput()},
        _ignore,
        storage_roots=(),
        max_storage_bytes=1024,
        max_storage_files=10,
    )

    assert result == {"ready": True}
    await runner.close(anyio.current_time() + 1)


async def _ignore(_payload: object) -> None:
    return
