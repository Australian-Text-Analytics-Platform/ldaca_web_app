"""Explicit open state, per-Workspace serialization, and persistence tests."""

from __future__ import annotations

import threading
import json
import uuid
from pathlib import Path

import anyio
import polars as pl
import pytest

from ldaca_wordflow.shared.errors import (
    AppError,
    BackendCapacityExceededError,
    InvalidWorkspaceArchiveError,
    WorkspaceClosingError,
    WorkspaceCorruptError,
    WorkspaceInUseError,
    WorkspaceLockUnavailableError,
    WorkspaceNotFoundError,
    WorkspaceNotOpenError,
)
from ldaca_wordflow.domain.workspace import Node, Workspace
from ldaca_wordflow.infrastructure.storage.workspace_access import (
    write_workspace_owner,
)
from ldaca_wordflow.infrastructure.storage.workspace_store import WorkspaceStore
from ldaca_wordflow.services.workspace import (
    UnavailableWorkspaceRecord,
    WorkspaceRecord,
    WorkspaceService,
)
from ldaca_wordflow.services.events import EventHub
from ldaca_wordflow.infrastructure.storage.layout import (
    user_root,
    workspace_locks_root,
    workspaces_root,
)
from ldaca_wordflow.settings import Settings

from ._storage import unlimited_storage_admission


def _service(
    tmp_path: Path,
    *,
    multi_user: bool = False,
    max_open_workspace_bytes: int = 4 * 1024 * 1024 * 1024,
) -> WorkspaceService:
    settings = Settings(
        data_root=tmp_path,
        multi_user=multi_user,
        max_open_workspace_bytes=max_open_workspace_bytes,
        google_client_id="test-client" if multi_user else "",
    )
    limiter = anyio.CapacityLimiter(4)
    return WorkspaceService(
        settings,
        store=WorkspaceStore(
            max_nodes=settings.max_workspace_nodes,
            max_snapshot_bytes=settings.max_workspace_snapshot_bytes,
        ),
        storage_admission=unlimited_storage_admission(tmp_path, limiter=limiter),
        events=EventHub(),
        io_limiter=limiter,
    )


def _publish_workspace(
    service: WorkspaceService,
    *,
    owner_id: str,
    name: str,
) -> str:
    workspace_id = str(uuid.uuid4())
    path = workspaces_root(service.settings) / workspace_id
    workspace = Workspace(name=name, workspace_id=workspace_id)
    WorkspaceStore(
        max_nodes=service.settings.max_workspace_nodes,
        max_snapshot_bytes=service.settings.max_workspace_snapshot_bytes,
    ).commit(path, workspace, expected_revision=None)
    write_workspace_owner(path, owner_id)
    return workspace_id


@pytest.mark.anyio
async def test_workspace_creation_uses_global_catalogue_and_exact_access_sidecar(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)

    created = await service.create_workspace("owner", "Global")
    path = workspaces_root(service.settings) / created.id

    assert path.is_dir()
    assert (path / "workspace.json").is_file()
    assert json.loads((path / "access.json").read_text(encoding="utf-8")) == {
        "owner_id": "owner"
    }
    assert not (user_root(service.settings, "owner") / "user_workspaces").exists()


@pytest.mark.anyio
async def test_workspace_discovery_revalidates_ownership_without_a_catalogue_cache(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    created = await service.create_workspace("alice", "Owned by Alice")
    assert (await service.get_workspace("alice", created.id)).id == created.id

    path = workspaces_root(service.settings) / created.id
    write_workspace_owner(path, "bob")

    with pytest.raises(WorkspaceNotFoundError):
        await service.get_workspace("alice", created.id)
    assert [record.id for record in await service.list_workspaces("bob")] == [
        created.id
    ]


@pytest.mark.anyio
async def test_corrupt_owned_workspace_is_exposed_and_remains_deletable(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    valid = await service.create_workspace("owner", "Valid")
    corrupt_id = str(uuid.uuid4())
    corrupt = workspaces_root(service.settings) / corrupt_id
    corrupt.mkdir(parents=True)
    write_workspace_owner(corrupt, "owner")
    (corrupt / "workspace.json").write_text("not json", encoding="utf-8")

    records = await service.list_workspaces("owner")
    assert [record.id for record in records] == [valid.id, corrupt_id]
    assert isinstance(records[0], WorkspaceRecord)
    assert records[1] == UnavailableWorkspaceRecord(
        id=corrupt_id,
        reason="corrupt_snapshot",
        message="Workspace data is corrupt.",
    )
    with pytest.raises(WorkspaceCorruptError) as exc_info:
        await service.get_workspace("owner", corrupt_id)
    assert exc_info.value.details == {"workspace_id": corrupt_id}

    async with service.deletion_context("owner", corrupt_id):
        pass
    assert not corrupt.exists()


@pytest.mark.anyio
async def test_incompatible_workspace_versions_are_distinct_catalogue_entries(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    valid = await service.create_workspace("owner", "Valid")
    incompatible_ids = [
        _publish_workspace(service, owner_id="owner", name=f"Schema {version}")
        for version in (17, 18)
    ]
    for workspace_id, version in zip(incompatible_ids, (17, 18), strict=True):
        snapshot_path = workspaces_root(service.settings) / workspace_id / "workspace.json"
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
        payload["workspace_metadata"]["version"] = version
        payload["workspace_metadata"]["description"] = f"Description {version}"
        payload["workspace_metadata"]["created_at"] = "2024-01-01T00:00:00+00:00"
        payload["workspace_metadata"]["modified_at"] = "2024-01-02T00:00:00+00:00"
        snapshot_path.write_text(json.dumps(payload), encoding="utf-8")

    records = await service.list_workspaces("owner")

    assert isinstance(records[0], WorkspaceRecord)
    assert records[0].id == valid.id
    unavailable = records[1:]
    assert [record.id for record in unavailable] == sorted(incompatible_ids)
    assert {
        (record.stored_schema_version, record.supported_schema_version)
        for record in unavailable
        if isinstance(record, UnavailableWorkspaceRecord)
    } == {(17, 19), (18, 19)}
    assert all(
        isinstance(record, UnavailableWorkspaceRecord)
        and record.reason == "incompatible_format"
        for record in unavailable
    )
    unavailable_by_name = {record.name: record for record in unavailable}
    assert unavailable_by_name["Schema 17"].description == "Description 17"
    assert unavailable_by_name["Schema 18"].description == "Description 18"
    assert all(
        record.created_at == "2024-01-01T00:00:00+00:00"
        and record.modified_at == "2024-01-02T00:00:00+00:00"
        for record in unavailable_by_name.values()
    )


@pytest.mark.anyio
async def test_over_limit_workspace_has_a_distinct_catalogue_reason(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    created = await service.create_workspace("owner", "Over limit")
    await service.open_workspace("owner", created.id)
    async with service.mutation_context("owner", created.id) as lease:
        lease.workspace.add_node(
            Node(data=pl.DataFrame({"value": [1]}).lazy(), name="First")
        )
        lease.workspace.add_node(
            Node(data=pl.DataFrame({"value": [2]}).lazy(), name="Second")
        )
    service._store = WorkspaceStore(max_nodes=1, max_snapshot_bytes=8 * 1024 * 1024)

    assert await service.list_workspaces("owner") == [
        UnavailableWorkspaceRecord(
            id=created.id,
            reason="configured_limit",
            message="Workspace exceeds the configured limits.",
        )
    ]


@pytest.mark.anyio
async def test_other_users_never_parse_an_owned_corrupt_workspace(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    corrupt_id = str(uuid.uuid4())
    corrupt = workspaces_root(service.settings) / corrupt_id
    corrupt.mkdir(parents=True)
    write_workspace_owner(corrupt, "alice")
    (corrupt / "workspace.json").write_text("not json", encoding="utf-8")

    with pytest.raises(WorkspaceNotFoundError):
        await service.get_workspace("bob", corrupt_id)
    assert await service.list_workspaces("bob") == []


@pytest.mark.anyio
async def test_unattributable_workspace_entries_do_not_block_valid_siblings(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    valid = await service.create_workspace("owner", "Valid")
    unattributable_id = _publish_workspace(
        service,
        owner_id="owner",
        name="Unattributable",
    )
    (workspaces_root(service.settings) / unattributable_id / "access.json").unlink()
    (workspaces_root(service.settings) / "not-a-workspace").mkdir()

    assert [record.id for record in await service.list_workspaces("owner")] == [
        valid.id
    ]
    with pytest.raises(WorkspaceNotFoundError):
        await service.get_workspace("owner", unattributable_id)


@pytest.mark.anyio
async def test_workspace_revisions_are_server_ordered_and_monotonic(
    tmp_path: Path,
) -> None:
    """Each admitted command advances exactly once without client preconditions."""

    service = _service(tmp_path)
    created = await service.create_workspace("user", "Alpha", "first")

    assert created.revision == 1
    await service.open_workspace("user", created.id)
    updated = await service.mutate_workspace(
        "user",
        created.id,
        lambda workspace: setattr(workspace, "description", "second"),
    )
    assert updated.revision == 2
    later = await service.mutate_workspace(
        "user",
        created.id,
        lambda workspace: setattr(workspace, "description", "third"),
    )
    assert later.revision == 3
    detail = await service.get_workspace("user", created.id)
    assert detail.revision == 3
    assert detail.description == "third"


@pytest.mark.anyio
async def test_workspace_creation_stays_closed_until_explicit_open(
    tmp_path: Path,
) -> None:
    """A durable creation remains closed until a later explicit load boundary."""

    service = _service(tmp_path)
    created = await service.create_workspace("user", "Closed", "")

    assert created.runtime_state == "closed"
    assert service._slots == {}
    with pytest.raises(WorkspaceNotOpenError):
        async with service.read_context("user", created.id):
            pass

    opened = await service.open_workspace("user", created.id)
    assert opened.runtime_state == "open"


@pytest.mark.anyio
async def test_independent_services_cannot_open_the_same_workspace(
    tmp_path: Path,
) -> None:
    """A Workspace open in one backend is unavailable to another backend."""

    first = _service(tmp_path)
    second = _service(tmp_path)
    created = await first.create_workspace("user", "Exclusive")
    await first.open_workspace("user", created.id)

    with pytest.raises(AppError) as exc_info:
        await second.open_workspace("user", created.id)

    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "workspace_in_use"
    assert exc_info.value.message == (
        "Workspace is open in another Wordflow backend process"
    )


@pytest.mark.anyio
async def test_delete_rejects_external_owner_then_succeeds_after_close(
    tmp_path: Path,
) -> None:
    """Deletion shares the same per-Workspace process-ownership boundary."""

    holder = _service(tmp_path)
    other = _service(tmp_path)
    created = await holder.create_workspace("user", "Delete safely")
    await holder.open_workspace("user", created.id)

    with pytest.raises(WorkspaceInUseError):
        async with other.deletion_context("user", created.id):
            pass
    assert (workspaces_root(holder.settings) / created.id).is_dir()

    await holder.close()
    async with other.deletion_context("user", created.id):
        pass
    assert not (workspaces_root(holder.settings) / created.id).exists()


@pytest.mark.anyio
async def test_startup_reconciliation_skips_locked_workspace_and_repairs_sibling(
    tmp_path: Path,
) -> None:
    """One live Workspace does not block reconciliation of unlocked siblings."""

    holder = _service(tmp_path)
    reconciler = _service(tmp_path)
    locked = await holder.create_workspace("user", "Locked")
    sibling = await holder.create_workspace("user", "Sibling")
    await holder.open_workspace("user", locked.id)

    def mark_reconciled(workspace: Workspace) -> bool:
        workspace.description = "reconciled"
        return True

    await reconciler.reconcile_durable_workspaces(mark_reconciled)

    assert (await holder.get_workspace("user", locked.id)).description == ""
    assert (await holder.get_workspace("user", sibling.id)).description == "reconciled"


@pytest.mark.anyio
async def test_concurrent_open_loads_one_aggregate_and_reuses_it(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path)
    created = await service.create_workspace("user", "One load")
    original = service._load_sync
    calls = 0

    def counted_load(path: Path) -> tuple[Workspace, int, int]:
        nonlocal calls
        calls += 1
        return original(path)

    monkeypatch.setattr(service, "_load_sync", counted_load)
    results: list[str] = []

    async def open_once() -> None:
        results.append((await service.open_workspace("user", created.id)).runtime_state)

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(open_once)
        task_group.start_soon(open_once)

    assert results == ["open", "open"]
    assert calls == 1


@pytest.mark.anyio
async def test_failed_open_remains_closed_and_can_be_retried(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path)
    created = await service.create_workspace("user", "Retry")
    original = service._load_sync
    calls = 0

    def fail_once(path: Path) -> tuple[Workspace, int, int]:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise WorkspaceCorruptError("temporary load failure")
        return original(path)

    monkeypatch.setattr(service, "_load_sync", fail_once)
    with pytest.raises(WorkspaceCorruptError):
        await service.open_workspace("user", created.id)
    assert (await service.get_workspace("user", created.id)).runtime_state == "closed"

    opened = await service.open_workspace("user", created.id)
    assert opened.runtime_state == "open"
    assert calls == 2


@pytest.mark.anyio
async def test_failed_open_releases_process_ownership(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failing = _service(tmp_path)
    replacement = _service(tmp_path)
    created = await failing.create_workspace("user", "Release after failure")

    def fail_load(_path: Path) -> tuple[Workspace, int, int]:
        raise WorkspaceCorruptError("temporary load failure")

    monkeypatch.setattr(failing, "_load_sync", fail_load)
    with pytest.raises(WorkspaceCorruptError):
        await failing.open_workspace("user", created.id)

    assert (
        await replacement.open_workspace("user", created.id)
    ).runtime_state == "open"


@pytest.mark.anyio
async def test_cancelled_open_reservation_releases_process_ownership(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    replacement = _service(tmp_path)
    created = await service.create_workspace("user", "Cancelled reservation")
    ready = anyio.Event()
    finished = anyio.Event()
    scopes: list[anyio.CancelScope] = []

    async def reserve_until_cancelled() -> None:
        with anyio.CancelScope() as scope:
            scopes.append(scope)
            async with service.reserve_open("user", created.id):
                ready.set()
                await anyio.sleep_forever()
        finished.set()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(reserve_until_cancelled)
        await ready.wait()
        scopes[0].cancel()
        await finished.wait()

    assert (
        await replacement.open_workspace("user", created.id)
    ).runtime_state == "open"


@pytest.mark.anyio
async def test_unsafe_workspace_lock_entry_fails_closed_without_following_link(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    created = await service.create_workspace("user", "Unsafe lock")
    outside = tmp_path / "outside.txt"
    outside.write_text("do not modify", encoding="utf-8")
    lock_root = workspace_locks_root(service.settings)
    lock_root.mkdir(parents=True)
    lock_path = lock_root / f"{created.id}.lock"
    try:
        lock_path.symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"symlinks are unavailable: {exc}")

    with pytest.raises(WorkspaceLockUnavailableError):
        await service.open_workspace("user", created.id)

    assert outside.read_text(encoding="utf-8") == "do not modify"


@pytest.mark.anyio
async def test_hosted_open_capacity_rejects_without_loading_or_eviction(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path, multi_user=True, max_open_workspace_bytes=1)
    created = await service.create_workspace("user", "Too large")

    with pytest.raises(BackendCapacityExceededError):
        await service.open_workspace("user", created.id)

    assert (await service.get_workspace("user", created.id)).runtime_state == "closed"
    assert service._open_capacity_bytes == 0


@pytest.mark.anyio
async def test_single_user_mode_has_no_aggregate_open_capacity(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path, max_open_workspace_bytes=1)
    first = await service.create_workspace("user", "First")
    second = await service.create_workspace("user", "Second")

    await service.open_workspace("user", first.id)
    await service.open_workspace("user", second.id)

    assert (await service.get_workspace("user", first.id)).runtime_state == "open"
    assert (await service.get_workspace("user", second.id)).runtime_state == "open"


@pytest.mark.anyio
async def test_close_is_immediate_when_idle_and_open_cancels_deferred_close(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    created = await service.create_workspace("user", "Lifecycle")
    await service.open_workspace("user", created.id)

    async def idle(_user_id: str, _workspace_id: str) -> bool:
        return False

    assert await service.request_close("user", created.id, idle) is None
    assert (await service.get_workspace("user", created.id)).runtime_state == "closed"

    await service.open_workspace("user", created.id)
    active = True

    async def has_work(_user_id: str, _workspace_id: str) -> bool:
        return active

    closing = await service.request_close("user", created.id, has_work)
    assert closing is not None and closing.runtime_state == "closing"
    with pytest.raises(WorkspaceClosingError):
        async with service.mutation_context("user", created.id):
            pass
    async with service.read_context("user", created.id):
        pass

    reopened = await service.open_workspace("user", created.id)
    assert reopened.runtime_state == "open"
    active = True
    closing = await service.request_close("user", created.id, has_work)
    assert closing is not None and closing.runtime_state == "closing"
    competitor = _service(tmp_path)
    with pytest.raises(WorkspaceInUseError):
        await competitor.open_workspace("user", created.id)
    active = False
    await service.finalize_close_if_idle("user", created.id, has_work)
    assert (await service.get_workspace("user", created.id)).runtime_state == "closed"
    assert (
        await competitor.open_workspace("user", created.id)
    ).runtime_state == "open"


@pytest.mark.anyio
async def test_failed_metadata_commit_removes_published_mutation_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The workspace transaction owns rollback of files published before metadata."""

    service = _service(tmp_path)
    created = await service.create_workspace("user", "Rollback", "")
    await service.open_workspace("user", created.id)
    workspace_path = await service.resolve_workspace_dir("user", created.id)
    published = workspace_path / "data" / f"{uuid.uuid4()}.parquet"
    published.parent.mkdir()

    async def fail_persist(*_args: object, **_kwargs: object) -> int:
        raise OSError("simulated metadata failure")

    monkeypatch.setattr(service, "_persist", fail_persist)
    with pytest.raises(OSError, match="simulated metadata failure"):
        async with service.mutation_context("user", created.id) as lease:
            published.write_bytes(b"published before metadata")
            lease.rollback_paths.append(published)

    assert not published.exists()


@pytest.mark.anyio
async def test_failed_publication_restores_plan_and_preexisting_history(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _service(tmp_path)
    created = await service.create_workspace("user", "Plan rollback", "")
    await service.open_workspace("user", created.id)

    async with service.mutation_context("user", created.id) as lease:
        node = lease.workspace.add_node(
            Node(data=pl.DataFrame({"value": [1]}).lazy(), name="source")
        )
        node_id = node.id
    async with service.mutation_context("user", created.id) as lease:
        lease.workspace.nodes[node_id].data = pl.DataFrame({"value": [2]}).lazy()
    async with service.mutation_context("user", created.id) as lease:
        lease.workspace.nodes[node_id].data = pl.DataFrame({"value": [3]}).lazy()
    async with service.mutation_context("user", created.id) as lease:
        assert lease.workspace.nodes[node_id].undo_data()

    async def fail_persist(*_args: object, **_kwargs: object) -> int:
        raise OSError("simulated plan publication failure")

    monkeypatch.setattr(service, "_persist", fail_persist)
    with pytest.raises(OSError, match="simulated plan publication failure"):
        async with service.mutation_context("user", created.id) as lease:
            lease.workspace.nodes[node_id].data = pl.DataFrame(
                {"value": [4]}
            ).lazy()

    async with service.read_context("user", created.id) as lease:
        restored = lease.workspace.nodes[node_id]
        assert restored.data.collect().item() == 2
        assert restored.can_undo
        assert restored.can_redo
        assert restored.redo_data()
        assert restored.data.collect().item() == 3
        assert restored.undo_data()
        assert restored.undo_data()
        assert restored.data.collect().item() == 1


@pytest.mark.anyio
async def test_startup_reconciliation_removes_abandoned_export_generations(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    workspace_root = workspaces_root(service.settings)
    abandoned = (
        workspace_root / ".staging" / ".archive-export-sources" / "workspace-crash"
    )
    abandoned.mkdir(parents=True)
    (abandoned / "source.parquet").write_bytes(b"orphan")

    await service.reconcile_transient_storage()

    assert not (workspace_root / ".staging" / ".archive-export-sources").exists()


@pytest.mark.anyio
async def test_one_workspace_serializes_while_another_same_user_workspace_progresses(
    tmp_path: Path,
) -> None:
    """The keyed gate never serializes independent Workspaces by user."""

    service = _service(tmp_path)
    first = await service.create_workspace("one", "First", "")
    second = await service.create_workspace("one", "Second", "")
    await service.open_workspace("one", first.id)
    await service.open_workspace("one", second.id)
    first_entered = anyio.Event()
    release_first = anyio.Event()
    same_user_entered = anyio.Event()
    other_user_entered = anyio.Event()

    async def hold_first_user() -> None:
        async with service.mutation_context("one", first.id):
            first_entered.set()
            await release_first.wait()

    async def wait_for_same_user() -> None:
        async with service.mutation_context("one", first.id):
            same_user_entered.set()

    async def enter_other_workspace() -> None:
        async with service.mutation_context("one", second.id):
            other_user_entered.set()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(hold_first_user)
        await first_entered.wait()
        task_group.start_soon(wait_for_same_user)
        task_group.start_soon(enter_other_workspace)

        with anyio.fail_after(1):
            await other_user_entered.wait()
        assert not same_user_entered.is_set()
        release_first.set()
        with anyio.fail_after(1):
            await same_user_entered.wait()


@pytest.mark.anyio
async def test_cancelled_thread_write_is_not_abandoned(tmp_path: Path) -> None:
    """Cancellation cannot release a gate while its persistence thread runs."""

    service = _service(tmp_path)
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    returned = anyio.Event()
    cancel_scope: list[anyio.CancelScope] = []

    def blocking_write() -> None:
        started.set()
        release.wait(timeout=2)
        finished.set()

    async def run_write() -> None:
        with anyio.CancelScope() as scope:
            cancel_scope.append(scope)
            try:
                await service._run_io(blocking_write)
            finally:
                returned.set()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(run_write)
        with anyio.fail_after(1):
            while not started.is_set():
                await anyio.sleep(0.001)

        cancel_scope[0].cancel()
        await anyio.sleep(0.02)
        assert not returned.is_set()
        assert not finished.is_set()

        release.set()
        with anyio.fail_after(1):
            await returned.wait()

    assert finished.is_set()


@pytest.mark.anyio
async def test_shutdown_does_not_create_a_workspace_revision(tmp_path: Path) -> None:
    """Clean resident snapshots need no synthetic write during shutdown."""

    service = _service(tmp_path)
    created = await service.create_workspace("user", "Stable", "")

    await service.close()

    replacement = _service(tmp_path)
    restored = await replacement.get_workspace("user", created.id)
    assert restored.revision == created.revision


@pytest.mark.anyio
async def test_shutdown_releases_workspace_process_ownership(tmp_path: Path) -> None:
    service = _service(tmp_path)
    created = await service.create_workspace("user", "Shutdown release")
    await service.open_workspace("user", created.id)

    await service.close()

    replacement = _service(tmp_path)
    assert (
        await replacement.open_workspace("user", created.id)
    ).runtime_state == "open"


@pytest.mark.anyio
async def test_archive_install_rejects_uncompiled_client_plan_payloads(
    tmp_path: Path,
) -> None:
    """Only plans compiled from the materialized archive format may install."""

    service = _service(tmp_path)
    root = service.workspace_staging_root()
    outside_parquet = tmp_path / "outside.parquet"
    pl.DataFrame({"secret": ["exfiltrated"]}).write_parquet(outside_parquet)
    outside_plan = tmp_path / "outside.plbin"
    pl.scan_parquet(outside_parquet).serialize(outside_plan, format="binary")

    for data_path in (str(outside_plan), "data/internal.plbin"):
        staging = root / f"workspace-import-{uuid.uuid4().hex}"
        (staging / "data").mkdir(parents=True)
        if data_path == "data/internal.plbin":
            (staging / data_path).write_bytes(outside_plan.read_bytes())
        workspace_id = str(uuid.uuid4())
        (staging / "workspace.json").write_text(
            json.dumps(
                {
                    "workspace_metadata": {
                        "id": workspace_id,
                        "name": "Unsafe",
                        "version": 7,
                        "description": "",
                        "created_at": None,
                        "modified_at": None,
                    },
                    "nodes": [
                        {
                            "node_metadata": {
                                "id": str(uuid.uuid4()),
                                "name": "outside",
                                "provenance": {"type": "source"},
                                "document": None,
                                "color": None,
                                "tokenizer_model": None,
                            },
                            "data_path": data_path,
                        }
                    ],
                    "tabs": [],
                    "analyses": [],
                }
            ),
            encoding="utf-8",
        )

        reservation = await unlimited_storage_admission(tmp_path).acquire(
            "user",
            service.settings.max_workspace_snapshot_bytes,
        )
        try:
            with pytest.raises(InvalidWorkspaceArchiveError):
                await service.install_staged_archive(
                    "user",
                    staging,
                    "Unsafe",
                    reservation,
                )
        finally:
            await reservation.release()
