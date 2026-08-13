"""Fair, bounded, runtime-only Analysis scheduling tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import anyio
import pytest

from ldaca_wordflow.services.analysis_execution_types import (
    AnalysisExecutionKey,
    AnalysisSchedulingStopped,
)
from ldaca_wordflow.services.analysis_scheduler import (
    AnalysisScheduler,
    ScheduledAnalysis,
)


def _key(user_id: str, analysis_id: str) -> AnalysisExecutionKey:
    return AnalysisExecutionKey(user_id, "workspace", analysis_id)


async def _ignore_key(_key: AnalysisExecutionKey) -> None:
    return


@pytest.mark.anyio
async def test_scheduler_rejects_work_before_start_and_after_stop() -> None:
    async def runner(_item: ScheduledAnalysis) -> None:
        return

    scheduler = AnalysisScheduler(
        capacity=1,
        runner=runner,
        cancel_running=_ignore_key,
        work_removed=_ignore_key,
    )
    now = datetime.now(UTC)
    with pytest.raises(AnalysisSchedulingStopped):
        await scheduler.enqueue(_key("user", "before"), created_at=now, credential=None)

    async with anyio.create_task_group() as task_group:
        scheduler.start(task_group)
        await scheduler.stop_dispatch()
        with pytest.raises(AnalysisSchedulingStopped):
            await scheduler.enqueue(
                _key("user", "after"), created_at=now, credential=None
            )


@pytest.mark.anyio
async def test_scheduler_is_work_conserving_up_to_global_capacity() -> None:
    started: list[str] = []
    releases = {"one": anyio.Event(), "two": anyio.Event()}

    async def runner(item: ScheduledAnalysis) -> None:
        started.append(item.key.analysis_id)
        await releases[item.key.analysis_id].wait()

    async def cancel_running(_key: AnalysisExecutionKey) -> None:
        return

    scheduler = AnalysisScheduler(
        capacity=2,
        runner=runner,
        cancel_running=cancel_running,
        work_removed=_ignore_key,
    )
    now = datetime.now(UTC)
    async with anyio.create_task_group() as task_group:
        scheduler.start(task_group)
        await scheduler.enqueue(_key("user", "one"), created_at=now, credential=None)
        await scheduler.enqueue(
            _key("user", "two"),
            created_at=now + timedelta(seconds=1),
            credential=None,
        )
        with anyio.fail_after(1):
            while len(started) < 2:
                await anyio.sleep(0)
        assert started == ["one", "two"]
        releases["one"].set()
        releases["two"].set()
        await scheduler.wait_idle()
        await scheduler.stop_dispatch()


@pytest.mark.anyio
async def test_scheduler_rotates_users_and_preserves_per_user_fifo() -> None:
    started: list[str] = []
    release = anyio.Event()

    async def runner(item: ScheduledAnalysis) -> None:
        started.append(item.key.analysis_id)
        if item.key.analysis_id == "a1":
            await release.wait()

    async def cancel_running(_key: AnalysisExecutionKey) -> None:
        return

    scheduler = AnalysisScheduler(
        capacity=1,
        runner=runner,
        cancel_running=cancel_running,
        work_removed=_ignore_key,
    )
    now = datetime.now(UTC)
    async with anyio.create_task_group() as task_group:
        scheduler.start(task_group)
        await scheduler.enqueue(_key("alice", "a1"), created_at=now, credential=None)
        await scheduler.enqueue(
            _key("alice", "a2"),
            created_at=now + timedelta(seconds=1),
            credential=None,
        )
        with anyio.fail_after(1):
            while started != ["a1"]:
                await anyio.sleep(0)
        await scheduler.enqueue(_key("bob", "b1"), created_at=now, credential=None)
        release.set()
        with anyio.fail_after(1):
            while len(started) < 3:
                await anyio.sleep(0)
        assert started == ["a1", "b1", "a2"]
        await scheduler.stop_dispatch()


@pytest.mark.anyio
async def test_queued_cancellation_never_calls_runner() -> None:
    started: list[str] = []
    first_release = anyio.Event()
    running_cancellations: list[str] = []

    async def runner(item: ScheduledAnalysis) -> None:
        started.append(item.key.analysis_id)
        if item.key.analysis_id == "running":
            await first_release.wait()

    async def cancel_running(key: AnalysisExecutionKey) -> None:
        running_cancellations.append(key.analysis_id)

    scheduler = AnalysisScheduler(
        capacity=1,
        runner=runner,
        cancel_running=cancel_running,
        work_removed=_ignore_key,
    )
    now = datetime.now(UTC)
    queued = _key("user", "queued")
    async with anyio.create_task_group() as task_group:
        scheduler.start(task_group)
        await scheduler.enqueue(
            _key("user", "running"), created_at=now, credential=None
        )
        await scheduler.enqueue(
            queued,
            created_at=now + timedelta(seconds=1),
            credential=None,
        )
        with anyio.fail_after(1):
            while started != ["running"]:
                await anyio.sleep(0)
        await scheduler.cancel(queued)
        first_release.set()
        with anyio.move_on_after(0.05):
            while len(started) < 2:
                await anyio.sleep(0)
        assert started == ["running"]
        assert running_cancellations == []
        await scheduler.stop_dispatch()


@pytest.mark.anyio
async def test_scheduler_reports_queued_and_running_work_removal() -> None:
    removed: list[str] = []
    release = anyio.Event()

    async def runner(item: ScheduledAnalysis) -> None:
        if item.key.analysis_id == "running":
            await release.wait()

    async def work_removed(key: AnalysisExecutionKey) -> None:
        removed.append(key.analysis_id)

    scheduler = AnalysisScheduler(
        capacity=1,
        runner=runner,
        cancel_running=_ignore_key,
        work_removed=work_removed,
    )
    now = datetime.now(UTC)
    queued = _key("user", "queued")
    async with anyio.create_task_group() as task_group:
        scheduler.start(task_group)
        await scheduler.enqueue(
            _key("user", "running"), created_at=now, credential=None
        )
        await scheduler.enqueue(
            queued,
            created_at=now + timedelta(seconds=1),
            credential=None,
        )
        with anyio.fail_after(1):
            while not await scheduler.active_keys():
                await anyio.sleep(0)

        await scheduler.cancel(queued)
        assert removed == ["queued"]

        release.set()
        await scheduler.wait_idle()
        assert removed == ["queued", "running"]
        await scheduler.stop_dispatch()
