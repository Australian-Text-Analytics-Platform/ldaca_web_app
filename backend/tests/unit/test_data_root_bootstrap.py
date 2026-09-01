from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, cast

import anyio
import pytest
from anyio.abc import TaskStatus
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ldaca_wordflow.data_root_config import (
    DataRootConfigError,
    DataRootConfigStore,
    DataRootPaths,
    platform_data_root_paths,
    probe_data_root,
)
from ldaca_wordflow.main import RuntimeContextFactory, create_app
from ldaca_wordflow.models.data_root import DataRootUpdateRequest
from ldaca_wordflow.runtime import Runtime, RuntimeManager, runtime_manager_context
from ldaca_wordflow.settings import Settings
from ldaca_wordflow.shared.errors import (
    DataRootBusyError,
    DataRootInitializationError,
    DataRootManagedByOperatorError,
    DataRootTransitionError,
    format_exception_diagnostic,
    InternalServiceError,
)


class _IdleWork:
    async def has_work(self) -> bool:
        return False


class _BusyWork:
    async def has_work(self) -> bool:
        return True


class _FakeRuntime:
    def __init__(self, root: Path) -> None:
        self.settings = Settings(data_root=root)
        self.analysis_execution: _IdleWork | _BusyWork = _IdleWork()
        self.user_file_import_service = _IdleWork()


def _store(tmp_path: Path) -> DataRootConfigStore:
    return DataRootConfigStore(
        DataRootPaths(
            config_file=tmp_path / "config" / "settings.json",
            suggested_data_root=tmp_path / "application-data" / "data",
        )
    )


def test_platform_paths_use_the_wordflow_identifier_and_expected_leaf_names() -> None:
    paths = platform_data_root_paths()
    assert "au.edu.ldaca.wordflow" in str(paths.config_file)
    assert paths.config_file.name == "settings.json"
    assert paths.suggested_data_root.name == "data"


def test_config_store_is_versioned_atomic_and_ignores_legacy_backend_json(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    legacy = store.paths.config_file.parent / "backend.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text('{"data_root":"/legacy"}', encoding="utf-8")

    assert store.read() is None
    selected = (tmp_path / "selected").resolve()
    store.write(selected)
    assert store.read() == selected
    assert store.paths.config_file.read_text(encoding="utf-8")
    if store.paths.config_file.stat().st_mode & 0o777:
        assert store.paths.config_file.stat().st_mode & 0o777 == 0o600


def test_config_store_rejects_relative_or_unknown_schema(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.paths.config_file.parent.mkdir(parents=True)
    store.paths.config_file.write_text(
        '{"schema_version":2,"data_root":"relative"}', encoding="utf-8"
    )
    with pytest.raises(DataRootConfigError):
        store.read()


def test_probe_creates_and_canonicalizes_directory_and_rejects_files(
    tmp_path: Path,
) -> None:
    candidate = tmp_path / "missing" / "data"
    assert probe_data_root(candidate) == candidate.resolve()
    assert list(candidate.glob(".wordflow-probe.*")) == []

    regular_file = tmp_path / "file"
    regular_file.write_text("not a directory", encoding="utf-8")
    with pytest.raises((OSError, ValueError)):
        probe_data_root(regular_file)
    with pytest.raises(ValueError):
        probe_data_root(Path("relative"))


@pytest.mark.parametrize(
    ("raw_path", "expected"),
    [
        ("~", Path.home()),
        ("~/Documents/ldaca", Path.home() / "Documents" / "ldaca"),
    ],
)
def test_data_root_update_expands_the_backend_user_home(
    raw_path: str,
    expected: Path,
) -> None:
    request = DataRootUpdateRequest(data_root=raw_path)

    assert request.data_root == expected


@pytest.mark.parametrize("raw_path", ["relative/path", "~another-user/data"])
def test_data_root_update_rejects_other_non_absolute_paths(raw_path: str) -> None:
    with pytest.raises(ValidationError):
        DataRootUpdateRequest(data_root=raw_path)


@pytest.mark.anyio
async def test_environment_wins_and_is_immutable(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.write((tmp_path / "configured").resolve())

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[Runtime]:
        yield cast(Runtime, _FakeRuntime(settings.get_data_root()))

    environment_root = (tmp_path / "environment").resolve()
    async with runtime_manager_context(
        Settings(data_root=environment_root),
        factory,
        config_store=store,
    ) as manager:
        snapshot = manager.snapshot()
        assert snapshot.state == "ready"
        assert snapshot.source == "environment"
        assert snapshot.data_root == environment_root
        assert snapshot.mutable is False
        with pytest.raises(DataRootManagedByOperatorError):
            await manager.configure(tmp_path / "other")


@pytest.mark.anyio
async def test_unconfigured_manager_switches_and_same_root_is_idempotent(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    opened: list[Path] = []

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[Runtime]:
        opened.append(settings.get_data_root())
        yield cast(Runtime, _FakeRuntime(settings.get_data_root()))

    async with runtime_manager_context(
        Settings(), factory, config_store=store
    ) as manager:
        assert manager.snapshot().state == "unconfigured"
        assert manager.snapshot().runtime_generation == 0

        selected = tmp_path / "selected"
        first = await manager.configure(selected)
        second = await manager.configure(selected / ".")
        assert first.state == second.state == "ready"
        assert first.runtime_generation == second.runtime_generation == 1
        assert opened == [selected.resolve()]
        assert store.read() == selected.resolve()
        assert first.change_token == second.change_token


@pytest.mark.anyio
async def test_switch_rejects_active_work_without_closing_the_runtime(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    closed: list[Path] = []

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[Runtime]:
        runtime = _FakeRuntime(settings.get_data_root())
        runtime.analysis_execution = _BusyWork()
        try:
            yield cast(Runtime, runtime)
        finally:
            closed.append(settings.get_data_root())

    original = tmp_path / "original"
    store.write(original.resolve())
    async with runtime_manager_context(
        Settings(data_root=None), factory, config_store=store
    ) as manager:
        with pytest.raises(DataRootBusyError):
            await manager.configure(tmp_path / "candidate")
        assert manager.snapshot().state == "ready"
        assert manager.snapshot().data_root == original.resolve()
        assert closed == []


@pytest.mark.anyio
async def test_failed_candidate_reconstructs_previous_runtime(tmp_path: Path) -> None:
    store = _store(tmp_path)
    original = (tmp_path / "original").resolve()
    candidate = (tmp_path / "candidate").resolve()
    store.write(original)
    opened: list[Path] = []
    closed: list[Path] = []

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[Runtime]:
        root = settings.get_data_root()
        opened.append(root)
        if root == candidate:
            raise RuntimeError("candidate failed")
        try:
            yield cast(Runtime, _FakeRuntime(root))
        finally:
            closed.append(root)

    async with runtime_manager_context(
        Settings(), factory, config_store=store
    ) as manager:
        with pytest.raises(DataRootInitializationError) as captured:
            await manager.configure(candidate)
        assert format_exception_diagnostic(captured.value) == (
            "RuntimeError: candidate failed"
        )
        assert manager.snapshot().state == "ready"
        assert manager.snapshot().data_root == original
        assert manager.snapshot().runtime_generation == 1
        assert opened == [original, candidate, original]
        assert closed == [original]
        assert store.read() == original


@pytest.mark.anyio
async def test_persistence_failure_closes_candidate_and_restores_previous_runtime(
    tmp_path: Path,
) -> None:
    original = (tmp_path / "original").resolve()
    candidate = (tmp_path / "candidate").resolve()
    seeded = _store(tmp_path)
    seeded.write(original)

    class FailingWriteStore(DataRootConfigStore):
        def write(self, data_root: Path) -> None:
            raise OSError("persistence failed")

    closed: list[Path] = []

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[Runtime]:
        root = settings.get_data_root()
        try:
            yield cast(Runtime, _FakeRuntime(root))
        finally:
            closed.append(root)

    async with runtime_manager_context(
        Settings(),
        factory,
        config_store=FailingWriteStore(seeded.paths),
    ) as manager:
        with pytest.raises(InternalServiceError):
            await manager.configure(candidate)
        assert manager.snapshot().state == "ready"
        assert manager.snapshot().data_root == original
        assert manager.snapshot().runtime_generation == 1
        assert closed == [original, candidate]
        assert seeded.read() == original


@pytest.mark.anyio
async def test_concurrent_transition_is_rejected_instead_of_queued(tmp_path: Path) -> None:
    @asynccontextmanager
    async def unused_factory(settings: Settings) -> AsyncIterator[Runtime]:
        yield cast(Runtime, _FakeRuntime(settings.get_data_root()))

    async with runtime_manager_context(
        Settings(),
        unused_factory,
        config_store=_store(tmp_path),
    ) as manager:
        await manager._transition_lock.acquire()
        try:
            with pytest.raises(DataRootTransitionError):
                await manager.configure(tmp_path / "candidate")
        finally:
            manager._transition_lock.release()


@pytest.mark.anyio
async def test_switch_waits_for_finite_request_leases_to_drain(tmp_path: Path) -> None:
    store = _store(tmp_path)
    original = (tmp_path / "original").resolve()
    candidate = (tmp_path / "candidate").resolve()
    store.write(original)
    opened: list[Path] = []
    completed: list[Path] = []

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[Runtime]:
        opened.append(settings.get_data_root())
        yield cast(Runtime, _FakeRuntime(settings.get_data_root()))

    async with runtime_manager_context(
        Settings(), factory, config_store=store
    ) as manager:
        async def switch() -> None:
            snapshot = await manager.configure(candidate)
            completed.append(snapshot.data_root or Path())

        async with anyio.create_task_group() as tasks:
            async with manager.lease():
                tasks.start_soon(switch)
                while manager.state != "reconfiguring":
                    await anyio.sleep(0)
                assert opened == [original]
                assert completed == []
        assert opened == [original, candidate]
        assert completed == [candidate]


@pytest.mark.anyio
async def test_switch_from_another_task_replaces_the_runtime_without_stopping_the_owner(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    original = (tmp_path / "original").resolve()
    candidate = (tmp_path / "candidate").resolve()
    store.write(original)
    opened: list[Path] = []
    closed: list[Path] = []

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[Runtime]:
        root = settings.get_data_root()
        opened.append(root)
        try:
            async with anyio.create_task_group():
                yield cast(Runtime, _FakeRuntime(root))
        finally:
            closed.append(root)

    stop_owner = anyio.Event()

    async def own_manager(*, task_status: TaskStatus[RuntimeManager]) -> None:
        async with runtime_manager_context(
            Settings(), factory, config_store=store
        ) as manager:
            task_status.started(manager)
            await stop_owner.wait()

    async with anyio.create_task_group() as tasks:
        manager = await tasks.start(own_manager)
        try:
            with anyio.fail_after(2):
                snapshot = await manager.configure(candidate)
        finally:
            stop_owner.set()

    assert snapshot.state == "ready"
    assert snapshot.data_root == candidate
    assert snapshot.runtime_generation == 2
    assert store.read() == candidate
    assert opened == [original, candidate]
    assert closed == [original, candidate]


def test_control_plane_is_live_while_unconfigured_then_becomes_ready(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _store(tmp_path)
    monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[_FakeRuntime]:
        yield _FakeRuntime(settings.get_data_root())

    app = create_app(
        Settings(),
        cast(RuntimeContextFactory, factory),
        serve_frontend=False,
        data_root_config_store=store,
    )
    with TestClient(app, base_url="http://localhost") as client:
        assert client.get("/health/live").status_code == 200
        assert client.get("/health/ready").status_code == 503
        assert client.get("/api/session").status_code == 503
        initial = client.get("/api/data-root").json()
        assert initial["state"] == "unconfigured"
        assert initial["source"] == "none"
        assert initial["mutable"] is True
        assert initial["suggested_data_root"] == str(store.paths.suggested_data_root)

        denied = client.put(
            "/api/data-root",
            headers={
                "Origin": "http://localhost",
                "X-Data-Root-Token": "wrong-token",
            },
            json={"data_root": str(tmp_path / "denied")},
        )
        assert denied.status_code == 403

        response = client.put(
            "/api/data-root",
            headers={
                "Origin": "http://localhost",
                "X-Data-Root-Token": initial["change_token"],
            },
            json={"data_root": "~/selected"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["state"] == "ready"
        assert response.json()["data_root"] == str(tmp_path / "selected")
        assert response.json()["runtime_generation"] == 1
        assert client.get("/health/ready").status_code == 200


def test_failed_http_initialization_exposes_the_python_error_in_response_and_state(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[_FakeRuntime]:
        if settings.get_data_root().name == "selected":
            raise PermissionError("[Errno 13] Permission denied while opening SQLite")
        yield _FakeRuntime(settings.get_data_root())

    app = create_app(
        Settings(),
        cast(RuntimeContextFactory, factory),
        serve_frontend=False,
        data_root_config_store=store,
    )
    with TestClient(app, base_url="http://localhost") as client:
        initial = client.get("/api/data-root").json()
        response = client.put(
            "/api/data-root",
            headers={
                "Origin": "http://localhost",
                "X-Data-Root-Token": initial["change_token"],
            },
            json={"data_root": str(tmp_path / "selected")},
        )
        refreshed = client.get("/api/data-root")

    assert response.status_code == 500
    assert response.json()["code"] == "data_root_initialization_failed"
    assert response.json()["message"] == (
        "PermissionError: [Errno 13] Permission denied while opening SQLite"
    )
    assert refreshed.json()["error"] == {
        "code": "data_root_initialization_failed",
        "message": "PermissionError: [Errno 13] Permission denied while opening SQLite",
    }


def test_multi_user_startup_failure_exposes_diagnostic_but_redacts_paths(
    tmp_path: Path,
) -> None:
    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[_FakeRuntime]:
        raise OSError("database schema could not be loaded")
        yield _FakeRuntime(settings.get_data_root())

    app = create_app(
        Settings(
            data_root=tmp_path,
            multi_user=True,
            google_client_id="client",
            trusted_hosts=("wordflow.example",),
        ),
        cast(RuntimeContextFactory, factory),
        serve_frontend=False,
    )
    with TestClient(app, base_url="https://wordflow.example") as client:
        response = client.get("/api/data-root")

    assert response.status_code == 200
    assert response.json()["data_root"] is None
    assert response.json()["error"] == {
        "code": "data_root_unavailable",
        "message": "OSError: database schema could not be loaded",
    }


def test_http_switch_replaces_a_task_group_runtime_without_restarting_the_app(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    original = (tmp_path / "original").resolve()
    candidate = (tmp_path / "candidate").resolve()
    store.write(original)

    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[Runtime]:
        async with anyio.create_task_group():
            yield cast(Runtime, _FakeRuntime(settings.get_data_root()))

    app = create_app(
        Settings(),
        factory,
        serve_frontend=False,
        data_root_config_store=store,
    )
    with TestClient(app, base_url="http://localhost") as client:
        initial = client.get("/api/data-root").json()

        response = client.put(
            "/api/data-root",
            headers={
                "Origin": "http://localhost",
                "X-Data-Root-Token": initial["change_token"],
            },
            json={"data_root": str(candidate)},
        )

        assert response.status_code == 200, response.text
        assert response.json()["state"] == "ready"
        assert response.json()["data_root"] == str(candidate)
        assert response.json()["runtime_generation"] == 2
        assert client.get("/health/live").status_code == 200
        assert client.get("/health/ready").status_code == 200
        assert store.read() == candidate


def test_multi_user_data_root_response_redacts_paths(tmp_path: Path) -> None:
    @asynccontextmanager
    async def factory(settings: Settings) -> AsyncIterator[_FakeRuntime]:
        yield _FakeRuntime(settings.get_data_root())

    app = create_app(
        Settings(
            data_root=tmp_path,
            multi_user=True,
            google_client_id="client",
            trusted_hosts=("wordflow.example",),
        ),
        cast(RuntimeContextFactory, factory),
        serve_frontend=False,
    )
    with TestClient(app, base_url="https://wordflow.example") as client:
        payload: dict[str, Any] = client.get("/api/data-root").json()
        assert payload["state"] == "ready"
        assert payload["data_root"] is None
        assert payload["suggested_data_root"] is None
        assert payload["change_token"] is None
        assert payload["mutable"] is False
