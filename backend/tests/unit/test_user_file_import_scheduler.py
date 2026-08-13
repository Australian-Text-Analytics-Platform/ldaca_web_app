"""Independent User File Import queue capacity and cancellation."""

from datetime import UTC, datetime, timedelta

import anyio
import pytest

from ldaca_wordflow.services.user_file_import_execution_types import (
    UserFileImportKey,
    UserFileImportSchedulingStopped,
)
from ldaca_wordflow.services.user_file_import_scheduler import (
    ScheduledUserFileImport,
    UserFileImportScheduler,
)


async def test_import_scheduler_is_work_conserving_and_fair() -> None:
    started: list[str] = []
    release = anyio.Event()

    async def runner(item: ScheduledUserFileImport) -> None:
        started.append(item.key.import_id)
        if item.key.import_id == "a1":
            await release.wait()

    scheduler = UserFileImportScheduler(capacity=1, runner=runner)
    now = datetime.now(UTC)
    async with anyio.create_task_group() as tasks:
        scheduler.start(tasks)
        await scheduler.enqueue(
            UserFileImportKey("alice", "a1"),
            created_at=now,
        )
        await scheduler.enqueue(
            UserFileImportKey("alice", "a2"),
            created_at=now + timedelta(seconds=1),
        )
        with anyio.fail_after(1):
            while started != ["a1"]:
                await anyio.sleep(0)
        await scheduler.enqueue(
            UserFileImportKey("bob", "b1"),
            created_at=now,
        )
        release.set()
        with anyio.fail_after(1):
            while len(started) < 3:
                await anyio.sleep(0)
        assert started == ["a1", "b1", "a2"]
        await scheduler.stop_dispatch()


async def test_import_scheduler_distinguishes_queued_and_running_cancellation() -> None:
    started = anyio.Event()
    cancelled = anyio.Event()

    async def runner(_item: ScheduledUserFileImport) -> None:
        started.set()
        try:
            await anyio.sleep_forever()
        except anyio.get_cancelled_exc_class():
            cancelled.set()
            raise

    scheduler = UserFileImportScheduler(capacity=1, runner=runner)
    running = UserFileImportKey("user", "running")
    queued = UserFileImportKey("user", "queued")
    async with anyio.create_task_group() as tasks:
        scheduler.start(tasks)
        await scheduler.enqueue(running, created_at=datetime.now(UTC))
        await started.wait()
        await scheduler.enqueue(queued, created_at=datetime.now(UTC))

        assert await scheduler.cancel(queued) == "queued"
        assert await scheduler.cancel(running) == "running"
        await cancelled.wait()
        await scheduler.wait_idle()
        assert await scheduler.cancel(running) == "missing"
        await scheduler.stop_dispatch()


async def test_import_scheduler_rejects_work_after_dispatch_stops() -> None:
    async def runner(_item: ScheduledUserFileImport) -> None:
        raise AssertionError("stopped scheduler dispatched work")

    scheduler = UserFileImportScheduler(capacity=1, runner=runner)
    async with anyio.create_task_group() as tasks:
        scheduler.start(tasks)
        await scheduler.stop_dispatch()

        with pytest.raises(UserFileImportSchedulingStopped):
            await scheduler.enqueue(
                UserFileImportKey("user", "late"),
                created_at=datetime.now(UTC),
            )
