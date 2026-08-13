"""Retained User File Import service lifecycle and isolation."""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import anyio
import pytest

from ldaca_wordflow.domain import (
    SampleUserFileImportRequest,
    SampleUserFileImportResult,
    UserFileImport,
)
from ldaca_wordflow.domain.background import BackgroundState, Progress
from ldaca_wordflow.infrastructure.storage.user_file_import_store import (
    UserFileImportStore,
)
from ldaca_wordflow.models.data_sources import SampleCollection
from ldaca_wordflow.services.sample_data import SampleImportExecution
from ldaca_wordflow.services.events import EventHub
from ldaca_wordflow.services.user_file_import_executor import (
    UserFileImportProcessExecutor,
)
from ldaca_wordflow.services.user_file_imports import UserFileImportService
from ldaca_wordflow.shared.errors import BackendStoppingError

from ._storage import unlimited_storage_admission


class _Samples:
    def __init__(self, root: Path, *, block: bool = False) -> None:
        self.root = root
        self.block = block
        self.started = anyio.Event()
        self.release = anyio.Event()
        self.cleaned: list[str] = []
        self.published: list[str] = []

    async def prepare_import(
        self,
        user_id: str,
        collection_id: str,
        import_id: str,
    ) -> SampleImportExecution:
        del user_id
        staging = self.root / import_id
        staging.mkdir(parents=True)
        return SampleImportExecution(
            SampleCollection(
                id=collection_id,
                name=collection_id,
                total_size_bytes=0,
                files=[],
            ),
            staging,
        )

    async def execute_import(
        self,
        execution: SampleImportExecution,
        report_progress: Any,
    ) -> SampleUserFileImportResult:
        self.started.set()
        await report_progress(Progress(fraction=0.5, message="Halfway"))
        if self.block:
            await self.release.wait()
        return SampleUserFileImportResult(
            collection_id=execution.collection.id,
            destination_path=f"sample_data/{execution.collection.id}",
            file_count=0,
            bytes_written=0,
        )

    async def publish_import(
        self,
        user_id: str,
        import_id: str,
        result: SampleUserFileImportResult,
    ) -> None:
        del user_id, result
        self.published.append(import_id)

    async def cleanup_import(self, user_id: str, import_id: str) -> None:
        del user_id
        self.cleaned.append(import_id)
        shutil.rmtree(self.root / import_id, ignore_errors=True)


class _Portal:
    async def cleanup_import(
        self,
        user_id: str,
        import_id: str,
    ) -> None:
        del user_id, import_id


def _service(
    tmp_path: Path,
    samples: _Samples,
    *,
    capacity: int = 1,
) -> tuple[UserFileImportService, UserFileImportStore]:
    limiter = anyio.CapacityLimiter(4)
    users = tmp_path / "users"
    store = UserFileImportStore(
        lambda user_id: users / user_id / "imports",
        all_users_root=users,
        max_record_bytes=64 * 1024,
        limiter=limiter,
    )
    service = UserFileImportService(
        store,
        cast(Any, samples),
        cast(Any, _Portal()),
        UserFileImportProcessExecutor(),
        unlimited_storage_admission(tmp_path, limiter=limiter),
        EventHub(),
        capacity=capacity,
        max_storage_bytes=1024,
        max_storage_files=10,
        max_record_bytes=64 * 1024,
    )
    return service, store


async def _wait_for_state(
    service: UserFileImportService,
    user_id: str,
    resource: UserFileImport,
    state: BackgroundState,
) -> UserFileImport:
    with anyio.fail_after(2):
        while True:
            current = await service.get(user_id, resource.id)
            if current.state is state:
                return current
            await anyio.sleep(0)


async def test_success_is_retained_and_history_deletion_keeps_publication(
    tmp_path: Path,
) -> None:
    samples = _Samples(tmp_path / "staging")
    service, store = _service(tmp_path, samples)

    async with anyio.create_task_group() as tasks:
        await service.start(tasks)
        created = await service.submit_sample("alice", "demo")
        succeeded = await _wait_for_state(
            service,
            "alice",
            created,
            BackgroundState.SUCCEEDED,
        )

        assert succeeded.progress == Progress(fraction=1.0, message="Complete")
        assert succeeded.result is not None
        assert samples.published == [str(created.id)]
        assert (await store.load_all()).records[0].resource == succeeded

        await service.delete("alice", created.id)
        assert samples.published == [str(created.id)]
        assert (await store.load_all()).records == []
        await service.close(anyio.current_time() + 1)


async def test_queued_cancellation_is_immediate_and_never_executes(
    tmp_path: Path,
) -> None:
    samples = _Samples(tmp_path / "staging", block=True)
    service, _store = _service(tmp_path, samples)

    async with anyio.create_task_group() as tasks:
        await service.start(tasks)
        first = await service.submit_sample("alice", "first")
        await samples.started.wait()
        second = await service.submit_sample("alice", "second")

        cancelled, pending = await service.cancel("alice", second.id)

        assert pending is False
        assert cancelled.state is BackgroundState.CANCELLED
        assert cancelled.started_at is None
        assert str(second.id) in samples.cleaned
        samples.release.set()
        await _wait_for_state(service, "alice", first, BackgroundState.SUCCEEDED)
        await service.close(anyio.current_time() + 1)


async def test_running_cancellation_becomes_terminal_only_after_cleanup(
    tmp_path: Path,
) -> None:
    samples = _Samples(tmp_path / "staging", block=True)
    service, _store = _service(tmp_path, samples)

    async with anyio.create_task_group() as tasks:
        await service.start(tasks)
        created = await service.submit_sample("alice", "demo")
        await samples.started.wait()

        requested, pending = await service.cancel("alice", created.id)
        assert pending is True
        assert requested.state is BackgroundState.RUNNING
        assert requested.cancellation_requested_at is not None

        cancelled = await _wait_for_state(
            service,
            "alice",
            created,
            BackgroundState.CANCELLED,
        )
        assert str(created.id) in samples.cleaned
        assert cancelled.finished_at is not None
        await service.close(anyio.current_time() + 1)


async def test_restart_fails_nonterminal_import_instead_of_resuming_it(
    tmp_path: Path,
) -> None:
    samples = _Samples(tmp_path / "staging")
    service, store = _service(tmp_path, samples)
    queued = UserFileImport.create(
        SampleUserFileImportRequest(collection_id="demo"),
        timestamp=datetime.now(UTC),
    )
    await store.save("alice", queued)

    async with anyio.create_task_group() as tasks:
        await service.start(tasks)

        interrupted = await service.get("alice", queued.id)
        assert interrupted.state is BackgroundState.FAILED
        assert interrupted.error is not None
        assert interrupted.error.code == "user_file_import_interrupted"
        await service.close(anyio.current_time() + 1)


async def test_enqueue_rejection_compensates_record_staging_and_reservation(
    tmp_path: Path,
) -> None:
    samples = _Samples(tmp_path / "staging")
    service, store = _service(tmp_path, samples)

    async with anyio.create_task_group() as tasks:
        await service.start(tasks)
        await service._scheduler.stop_dispatch()

        with pytest.raises(BackendStoppingError):
            await service.submit_sample("alice", "demo")

        assert (await store.load_all()).records == []
        assert len(samples.cleaned) == 1
        assert not any((tmp_path / "staging").iterdir())
        await service.close(anyio.current_time() + 1)
