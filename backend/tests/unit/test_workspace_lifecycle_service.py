"""Workspace close and deletion coordination with private Analysis execution."""

from pathlib import Path
from typing import Any, cast
import uuid

import anyio
import pytest

from ldaca_wordflow.infrastructure.storage.workspace_store import WorkspaceStore
from ldaca_wordflow.services.events import EventHub
from ldaca_wordflow.services.workspace import WorkspaceRecord, WorkspaceService
from ldaca_wordflow.services.workspace_lifecycle import WorkspaceLifecycleService
from ldaca_wordflow.settings import Settings
from ldaca_wordflow.shared.errors import WorkspaceInUseError, WorkspaceNotFoundError

from ._storage import unlimited_storage_admission


class _Analyses:
    def __init__(self) -> None:
        self.active = False
        self.active_workspace_ids: set[uuid.UUID] = set()
        self.cancelled: list[tuple[str, uuid.UUID]] = []
        self.finalized: list[tuple[str, uuid.UUID]] = []

    async def has_workspace_work(self, user_id: str, workspace_id: uuid.UUID) -> bool:
        del user_id
        return self.active or workspace_id in self.active_workspace_ids

    async def cancel_workspace(self, user_id: str, workspace_id: uuid.UUID) -> None:
        self.cancelled.append((user_id, workspace_id))

    async def finalize_interrupted_analyses(
        self,
        user_id: str,
        workspace_id: uuid.UUID,
    ) -> None:
        self.finalized.append((user_id, workspace_id))


def _workspace_service(
    tmp_path: Path,
    *,
    multi_user: bool = False,
    events: EventHub | None = None,
) -> WorkspaceService:
    settings = Settings(
        data_root=tmp_path,
        multi_user=multi_user,
        google_client_id="test-client" if multi_user else "",
    )
    limiter = anyio.CapacityLimiter(2)
    return WorkspaceService(
        settings,
        store=WorkspaceStore(
            max_nodes=settings.max_workspace_nodes,
            max_snapshot_bytes=settings.max_workspace_snapshot_bytes,
        ),
        storage_admission=unlimited_storage_admission(tmp_path, limiter=limiter),
        events=events or EventHub(),
        io_limiter=limiter,
    )


def _lifecycle(
    workspaces: WorkspaceService,
    analyses: _Analyses,
) -> WorkspaceLifecycleService:
    return WorkspaceLifecycleService(
        workspaces,
        cast(Any, analyses),
        cast(Any, analyses),
    )


async def test_open_makes_target_the_only_open_workspace(tmp_path: Path) -> None:
    workspaces = _workspace_service(tmp_path)
    analyses = _Analyses()
    lifecycle = _lifecycle(workspaces, analyses)
    first = await workspaces.create_workspace("owner", "First")
    second = await workspaces.create_workspace("owner", "Second")
    await workspaces.open_workspace("owner", first.id)

    opened = await lifecycle.open("owner", second.id)

    assert opened.runtime_state == "open"
    assert (await workspaces.get_workspace("owner", first.id)).runtime_state == (
        "closed"
    )
    assert (await workspaces.get_workspace("owner", second.id)).runtime_state == (
        "open"
    )
    assert analyses.finalized == [("owner", second.id)]

    await lifecycle.open("owner", second.id)

    assert analyses.finalized == [("owner", second.id)]


async def test_workspace_switch_publishes_every_runtime_transition(
    tmp_path: Path,
) -> None:
    events = EventHub()
    workspaces = _workspace_service(tmp_path, events=events)
    analyses = _Analyses()
    lifecycle = _lifecycle(workspaces, analyses)
    first = await workspaces.create_workspace("owner", "First")
    second = await workspaces.create_workspace("owner", "Second")
    subscription = await events.subscribe("owner", "session")
    await subscription.receive()

    await lifecycle.open("owner", first.id)
    await lifecycle.open("owner", second.id)

    transitions = [await subscription.receive() for _ in range(3)]
    runtime_events = [
        event
        for event in transitions
        if event is not None and event.type == "workspace_runtime_changed"
    ]
    assert [event.runtime_state for event in runtime_events] == [
        "open",
        "closed",
        "open",
    ]
    assert [event.resource_id for event in runtime_events] == [
        first.id,
        first.id,
        second.id,
    ]
    await events.close()


async def test_open_marks_busy_sibling_closing_and_reopening_it_reverses_roles(
    tmp_path: Path,
) -> None:
    workspaces = _workspace_service(tmp_path)
    analyses = _Analyses()
    lifecycle = _lifecycle(workspaces, analyses)
    first = await workspaces.create_workspace("owner", "First")
    second = await workspaces.create_workspace("owner", "Second")
    await workspaces.open_workspace("owner", first.id)
    analyses.active_workspace_ids.add(first.id)

    await lifecycle.open("owner", second.id)

    assert (await workspaces.get_workspace("owner", first.id)).runtime_state == (
        "closing"
    )
    assert (await workspaces.get_workspace("owner", second.id)).runtime_state == (
        "open"
    )

    reopened = await lifecycle.open("owner", first.id)

    assert reopened.runtime_state == "open"
    assert (await workspaces.get_workspace("owner", second.id)).runtime_state == (
        "closed"
    )


async def test_concurrent_open_requests_never_leave_two_open_workspaces(
    tmp_path: Path,
) -> None:
    workspaces = _workspace_service(tmp_path)
    analyses = _Analyses()
    lifecycle = _lifecycle(workspaces, analyses)
    first = await workspaces.create_workspace("owner", "First")
    second = await workspaces.create_workspace("owner", "Second")

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(lifecycle.open, "owner", first.id)
        task_group.start_soon(lifecycle.open, "owner", second.id)

    records = await workspaces.list_workspaces("owner")
    assert sum(
        record.runtime_state == "open"
        for record in records
        if isinstance(record, WorkspaceRecord)
    ) == 1


async def test_open_lifecycle_is_independent_between_users(tmp_path: Path) -> None:
    workspaces = _workspace_service(tmp_path, multi_user=True)
    analyses = _Analyses()
    lifecycle = _lifecycle(workspaces, analyses)
    first_a = await workspaces.create_workspace("alice", "Alice first")
    second_a = await workspaces.create_workspace("alice", "Alice second")
    first_b = await workspaces.create_workspace("bob", "Bob first")
    await lifecycle.open("alice", first_a.id)
    await lifecycle.open("bob", first_b.id)

    await lifecycle.open("alice", second_a.id)

    assert (await workspaces.get_workspace("bob", first_b.id)).runtime_state == (
        "open"
    )


async def test_open_failure_exposes_sibling_transition_without_fake_rollback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspaces = _workspace_service(tmp_path)
    analyses = _Analyses()
    lifecycle = _lifecycle(workspaces, analyses)
    first = await workspaces.create_workspace("owner", "First")
    second = await workspaces.create_workspace("owner", "Second")
    await workspaces.open_workspace("owner", first.id)
    analyses.active_workspace_ids.add(first.id)
    original_open = workspaces.open_workspace

    async def fail_target(user_id: str, workspace_id: uuid.UUID):
        if workspace_id == second.id:
            raise RuntimeError("target load failed")
        return await original_open(user_id, workspace_id)

    monkeypatch.setattr(workspaces, "open_workspace", fail_target)

    with pytest.raises(RuntimeError, match="target load failed"):
        await lifecycle.open("owner", second.id)

    assert (await workspaces.get_workspace("owner", first.id)).runtime_state == (
        "closing"
    )
    assert (await workspaces.get_workspace("owner", second.id)).runtime_state == (
        "closed"
    )


async def test_process_lock_conflict_preserves_the_current_workspace(
    tmp_path: Path,
) -> None:
    """Target process ownership is established before local sibling closure."""

    external = _workspace_service(tmp_path)
    local = _workspace_service(tmp_path)
    analyses = _Analyses()
    lifecycle = _lifecycle(local, analyses)
    current = await local.create_workspace("owner", "Current")
    target = await external.create_workspace("owner", "Target")
    await local.open_workspace("owner", current.id)
    await external.open_workspace("owner", target.id)

    with pytest.raises(WorkspaceInUseError):
        await lifecycle.open("owner", target.id)

    assert (await local.get_workspace("owner", current.id)).runtime_state == "open"
    assert (await local.get_workspace("owner", target.id)).runtime_state == "closed"


async def test_close_defers_only_while_analysis_execution_is_active(
    tmp_path: Path,
) -> None:
    workspaces = _workspace_service(tmp_path)
    analyses = _Analyses()
    lifecycle = _lifecycle(workspaces, analyses)
    workspace = await workspaces.create_workspace("owner", "Close safely")
    await workspaces.open_workspace("owner", workspace.id)

    analyses.active = True
    closing = await lifecycle.request_close("owner", workspace.id)

    assert closing is not None
    assert closing.runtime_state == "closing"
    analyses.active = False
    await workspaces.finalize_close_if_idle(
        "owner",
        workspace.id,
        analyses.has_workspace_work,
    )
    assert (await workspaces.get_workspace("owner", workspace.id)).runtime_state == (
        "closed"
    )


async def test_delete_signals_execution_then_atomically_removes_workspace(
    tmp_path: Path,
) -> None:
    workspaces = _workspace_service(tmp_path)
    analyses = _Analyses()
    lifecycle = _lifecycle(workspaces, analyses)
    workspace = await workspaces.create_workspace("owner", "Delete safely")
    await workspaces.open_workspace("owner", workspace.id)

    await lifecycle.delete("owner", workspace.id)

    assert analyses.cancelled == [("owner", workspace.id)]
    with pytest.raises(WorkspaceNotFoundError):
        await workspaces.get_workspace("owner", workspace.id)
