"""Workspace-gated Analysis creation, reads, cancellation, and clear tests."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import anyio
import polars as pl
import pytest

from ldaca_wordflow.domain.workspace import (
    AnalysisExecutionScope,
    AnalysisKind,
    AnalysisRecord,
    AnalysisState,
    AnnotationAnalysisSubmission,
    AnnotationRunAllSubmission,
    ConcordanceAnalysisRequest,
    ConcordanceRunAllAnalysisRequest,
    DerivationInput,
    DerivationProvenance,
    Node,
    Tab,
    TokenFrequencyAnalysisRequest,
    Workspace,
    node_reference,
)
from ldaca_wordflow.models.analyses import AnalysisCreate
from ldaca_wordflow.domain.workspace.provenance import CloneDerivation
from ldaca_wordflow.infrastructure.storage.workspace_store import WorkspaceStore
from ldaca_wordflow.infrastructure.storage.private_toml import PrivateTomlPersistence
from ldaca_wordflow.models.tabs import TabCreate
from ldaca_wordflow.models.node_resources import (
    CastNodeEditRequest,
    NodeUpdateRequest,
)
from ldaca_wordflow.services.analysis_execution_types import (
    AnalysisExecutionKey,
    AnalysisInvocation,
    AnalysisSchedulingStopped,
)
from ldaca_wordflow.workers.invocations import PreviewReadyInput
from ldaca_wordflow.services.events import EventHub
from ldaca_wordflow.services.analyses import AnalysisService, PublishedAnalysisResult
from ldaca_wordflow.services.nodes import NodeService
from ldaca_wordflow.services.provider_credentials import ProviderCredentialStore
from ldaca_wordflow.services.workspace import WorkspaceLease
from ldaca_wordflow.services.workspace import WorkspaceService
from ldaca_wordflow.settings import Settings
from ldaca_wordflow.shared.errors import (
    AnalysisInputGoneError,
    AnalysisInputMissingError,
    AnalysisKindMismatchError,
    AnalysisNotSucceededError,
    BackendStoppingError,
    DataBlockInUseError,
    InvalidInputError,
    ProviderCredentialMissingError,
    TabAnalysisExistsError,
)
from ldaca_wordflow.shared.json_data import JsonData

from ._storage import unlimited_storage_admission


class _ExecutionControl:
    def __init__(self) -> None:
        self.enqueued: list[tuple[AnalysisExecutionKey, datetime, str | None]] = []
        self.cancelled: list[AnalysisExecutionKey] = []
        self.enqueue_failure: Exception | None = None

    async def enqueue(
        self,
        key: AnalysisExecutionKey,
        *,
        created_at: datetime,
        credential: str | None,
    ) -> None:
        if self.enqueue_failure is not None:
            raise self.enqueue_failure
        self.enqueued.append((key, created_at, credential))

    async def cancel(self, key: AnalysisExecutionKey) -> None:
        self.cancelled.append(key)


class _Artifacts:
    async def publish_result(
        self,
        lease: WorkspaceLease,
        record: AnalysisRecord,
        raw_result: object,
    ) -> PublishedAnalysisResult:
        del lease, record
        if not isinstance(raw_result, dict):
            raise ValueError("Result must be an object")
        if raw_result == {"kind": "concordance"}:
            raw_result = {"ready": True}
        return PublishedAnalysisResult(
            payload=cast(dict[str, JsonData], raw_result),
            artifacts=[],
            output_node_ids=[],
            query_snapshot=None,
        )


def _workspace_service(tmp_path: Path) -> WorkspaceService:
    settings = Settings(data_root=tmp_path, multi_user=False)
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


async def _opened_workspace_with_tab(
    tmp_path: Path,
    *,
    kind: AnalysisKind = AnalysisKind.CONCORDANCE,
) -> tuple[WorkspaceService, uuid.UUID, uuid.UUID, uuid.UUID]:
    workspaces = _workspace_service(tmp_path)
    created = await workspaces.create_workspace("user", "Analyses")
    await workspaces.open_workspace("user", created.id)
    node_id = uuid.uuid4()

    def add_node(workspace: Workspace) -> None:
        workspace.add_node(
            Node(
                id=node_id,
                name="Documents",
                data=pl.DataFrame({"text": ["one", "two"]}).lazy(),
            )
        )

    await workspaces.mutate_workspace("user", created.id, add_node)
    tab = await workspaces.create_tab(
        "user",
        created.id,
        TabCreate(kind=kind, name=kind.value),
    )
    return workspaces, created.id, node_id, tab.id


def _request(node_id: uuid.UUID) -> ConcordanceAnalysisRequest:
    value = node_id
    return ConcordanceAnalysisRequest(
        node_ids=[value],
        node_columns={value: "text"},
        search_word="one",
    )


def _credential_store(
    tmp_path: Path,
    *,
    multi_user: bool = False,
) -> ProviderCredentialStore:
    settings = Settings(
        data_root=tmp_path,
        multi_user=multi_user,
        google_client_id="google-client" if multi_user else "",
    )
    limiter = anyio.CapacityLimiter(4)
    persistence = PrivateTomlPersistence(
        settings.get_users_root_folder(),
        unlimited_storage_admission(tmp_path, limiter=limiter),
        limiter=limiter,
    )
    return ProviderCredentialStore(
        settings,
        persistence,
    )


def _analysis_service(
    tmp_path: Path,
    workspaces: WorkspaceService,
    execution: _ExecutionControl,
    *,
    clock: Any = None,
    multi_user: bool = False,
) -> AnalysisService:
    kwargs: dict[str, Any] = {
        "credentials": _credential_store(tmp_path, multi_user=multi_user)
    }
    if clock is not None:
        kwargs["clock"] = clock
    return AnalysisService(workspaces, execution, _Artifacts(), **kwargs)


async def _submit(
    service: AnalysisService,
    user_id: str,
    workspace_id: uuid.UUID,
    tab_id: uuid.UUID,
    request: object,
    *,
    execution_scope: AnalysisExecutionScope = AnalysisExecutionScope.PREVIEW,
    parent_analysis_id: uuid.UUID | None = None,
    supersedes_analysis_ids: list[uuid.UUID] | None = None,
):
    return await service.submit(
        user_id,
        workspace_id,
        tab_id,
        AnalysisCreate.model_validate(
            {
                "execution_scope": execution_scope,
                "request": request,
                "parent_analysis_id": parent_analysis_id,
                "supersedes_analysis_ids": supersedes_analysis_ids or [],
            }
        ),
    )


async def _mark_succeeded(
    workspaces: WorkspaceService,
    workspace_id: uuid.UUID,
    analysis_id: uuid.UUID,
) -> None:
    timestamp = datetime.now(UTC)
    async with workspaces.mutation_context(
        "user", workspace_id, internal=True
    ) as lease:
        record = lease.workspace.analyses[analysis_id]
        running = record.start(timestamp)
        lease.workspace.replace_analysis(
            running.succeed(
                timestamp,
                result_payload={"kind": running.request.kind},
            )
        )


@pytest.mark.anyio
async def test_submission_atomically_assigns_one_queued_analysis(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)

    created = await _submit(
        service,
        "user",
        workspace_id,
        tab_id,
        _request(node_id),
    )

    assert created.state is AnalysisState.QUEUED
    assert created.request == _request(node_id)
    assert cast(
        Tab, await workspaces.get_tab("user", workspace_id, tab_id)
    ).analysis_ids == [created.id]
    page = await service.list_analyses("user", workspace_id, page=1, page_size=50)
    assert [item.id for item in page.items] == [created.id]
    assert execution.enqueued[0][0].analysis_id == created.id

    with pytest.raises(TabAnalysisExistsError):
        await _submit(service, "user", workspace_id, tab_id, _request(node_id))


@pytest.mark.anyio
async def test_multi_user_annotation_secret_reaches_execution_but_not_workspace_state(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path,
        kind=AnalysisKind.ANNOTATION,
    )
    execution = _ExecutionControl()
    service = _analysis_service(
        tmp_path,
        workspaces,
        execution,
        multi_user=True,
    )
    submission = AnnotationAnalysisSubmission(
        node_id=node_id,
        text_column="text",
        annotation_column="class",
        class_node_id=node_id,
        class_column="text",
        description_column="text",
        classes=[{"name": "Relevant", "description": ""}],
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
        model="model",
        instruction="Classify the text",
        api_key="request-only-secret",
    )

    with pytest.raises(ProviderCredentialMissingError):
        await _submit(
            service,
            "user",
            workspace_id,
            tab_id,
            submission.model_copy(update={"api_key": None}),
        )
    assert cast(
        Tab, await workspaces.get_tab("user", workspace_id, tab_id)
    ).analysis_ids == []

    created = await _submit(
        service,
        "user",
        workspace_id,
        tab_id,
        submission,
    )

    assert "api_key" not in created.request.model_dump(mode="json")
    assert execution.enqueued[0][2] == "request-only-secret"
    assert all(
        b"request-only-secret" not in path.read_bytes()
        for path in tmp_path.rglob("*")
        if path.is_file()
    )


@pytest.mark.anyio
async def test_annotation_submission_immediately_replaces_the_previous_analysis(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path,
        kind=AnalysisKind.ANNOTATION,
    )
    execution = _ExecutionControl()
    service = _analysis_service(
        tmp_path,
        workspaces,
        execution,
        multi_user=True,
    )
    preview = AnnotationAnalysisSubmission(
        node_id=node_id,
        text_column="text",
        annotation_column="class",
        class_node_id=node_id,
        class_column="text",
        description_column="text",
        classes=[{"name": "Relevant", "description": ""}],
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
        model="model",
        instruction="Classify the text",
        api_key="request-only-secret",
    )

    first = await _submit(service, "user", workspace_id, tab_id, preview)
    await _mark_succeeded(workspaces, workspace_id, first.id)

    first_run_all = await _submit(
        service,
        "user",
        workspace_id,
        tab_id,
        AnnotationRunAllSubmission(
            source=preview.persisted_request(),
            api_key="request-only-secret",
        ),
        execution_scope=AnalysisExecutionScope.RUN_ALL,
    )

    assert [item.id for item in await service.for_tab("user", workspace_id, tab_id)] == [
        first_run_all.id
    ]
    await _mark_succeeded(workspaces, workspace_id, first_run_all.id)

    second_run_all = await _submit(
        service,
        "user",
        workspace_id,
        tab_id,
        AnnotationRunAllSubmission(
            source=preview.persisted_request(),
            api_key="request-only-secret",
        ),
        execution_scope=AnalysisExecutionScope.RUN_ALL,
    )

    assert [item.id for item in await service.for_tab("user", workspace_id, tab_id)] == [
        second_run_all.id
    ]


@pytest.mark.anyio
async def test_rejected_submission_has_no_tab_or_workspace_side_effect(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    before = await workspaces.get_workspace("user", workspace_id)
    tab_before = await workspaces.get_tab("user", workspace_id, tab_id)

    # Build a valid request so kind rejection is proven to precede input lookup.
    missing_id = uuid.uuid4()
    other_kind = TokenFrequencyAnalysisRequest(
        node_ids=[missing_id],
        node_columns={missing_id: "text"},
        node_tokenizer_models={missing_id: "model"},
    )
    with pytest.raises(AnalysisKindMismatchError):
        await _submit(service, "user", workspace_id, tab_id, other_kind)

    missing_id = uuid.uuid4()
    missing = ConcordanceAnalysisRequest(
        node_ids=[missing_id],
        node_columns={missing_id: "text"},
        search_word="one",
    )
    with pytest.raises(AnalysisInputMissingError) as exc_info:
        await _submit(service, "user", workspace_id, tab_id, missing)

    assert exc_info.value.details == {"missing_input_ids": [str(missing_id)]}
    assert await workspaces.get_tab("user", workspace_id, tab_id) == tab_before
    assert (
        await workspaces.get_workspace("user", workspace_id)
    ).revision == before.revision
    assert execution.enqueued == []


@pytest.mark.anyio
async def test_stopped_scheduler_rolls_back_analysis_creation(tmp_path: Path) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    execution.enqueue_failure = AnalysisSchedulingStopped("stopped")
    service = _analysis_service(tmp_path, workspaces, execution)

    with pytest.raises(BackendStoppingError):
        await _submit(service, "user", workspace_id, tab_id, _request(node_id))

    assert cast(
        Tab, await workspaces.get_tab("user", workspace_id, tab_id)
    ).analysis_ids == []
    page = await service.list_analyses("user", workspace_id, page=1, page_size=50)
    assert page.items == []


@pytest.mark.anyio
async def test_stopped_scheduler_rolls_back_supporting_analysis_creation(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    root = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    await _mark_succeeded(workspaces, workspace_id, root.id)
    execution.enqueue_failure = AnalysisSchedulingStopped("stopped")

    with pytest.raises(BackendStoppingError):
        await _submit(
            service,
            "user",
            workspace_id,
            tab_id,
                ConcordanceRunAllAnalysisRequest(
                    source=_request(node_id),
                ),
            execution_scope=AnalysisExecutionScope.SUPPORTING,
            parent_analysis_id=root.id,
        )

    async with workspaces.read_context("user", workspace_id) as lease:
        assert lease.workspace.analysis_children(root.id) == []


@pytest.mark.anyio
async def test_unexpected_scheduling_failure_is_not_hidden(tmp_path: Path) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    execution.enqueue_failure = RuntimeError("scheduler defect")
    service = _analysis_service(tmp_path, workspaces, execution)

    with pytest.raises(RuntimeError, match="scheduler defect"):
        await _submit(service, "user", workspace_id, tab_id, _request(node_id))

    assert cast(
        Tab, await workspaces.get_tab("user", workspace_id, tab_id)
    ).analysis_ids == []
    page = await service.list_analyses("user", workspace_id, page=1, page_size=50)
    assert page.items == []


@pytest.mark.anyio
async def test_supporting_analyses_allow_arbitrary_depth_in_one_tab(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    root = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    supporting_request = ConcordanceRunAllAnalysisRequest(
        source=_request(node_id),
    )

    child = await _submit(
        service,
        "user",
        workspace_id,
        tab_id,
        supporting_request,
        execution_scope=AnalysisExecutionScope.SUPPORTING,
        parent_analysis_id=root.id,
    )
    grandchild = await _submit(
        service,
        "user",
        workspace_id,
        tab_id,
        supporting_request,
        execution_scope=AnalysisExecutionScope.SUPPORTING,
        parent_analysis_id=child.id,
    )
    assert child.parent_analysis_id == root.id
    assert grandchild.parent_analysis_id == child.id
    assert execution.enqueued[-1][0].analysis_id == grandchild.id
    assert [
        item.id for item in await service.for_tab("user", workspace_id, tab_id)
    ] == [
        root.id,
        child.id,
        grandchild.id,
    ]


@pytest.mark.anyio
async def test_queued_cancel_is_terminal_and_retained_on_the_tab(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))

    cancelled, pending = await service.cancel("user", workspace_id, created.id)

    assert pending is False
    assert cancelled.state is AnalysisState.CANCELLED
    assert cancelled.started_at is None
    assert cancelled.cancellation_requested_at == cancelled.finished_at
    assert [
        item.id for item in await service.for_tab("user", workspace_id, tab_id)
    ] == [created.id]
    assert execution.cancelled[-1].analysis_id == created.id


@pytest.mark.anyio
async def test_running_cancel_persists_one_request_and_remains_pending(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    now = datetime.now(UTC)
    ticks = iter([now, now + timedelta(seconds=1), now + timedelta(seconds=2)])
    service = _analysis_service(
        tmp_path,
        workspaces,
        execution,
        clock=lambda: next(ticks),
    )
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))

    async with workspaces.mutation_context(
        "user", workspace_id, internal=True
    ) as lease:
        record = lease.workspace.analyses[created.id]
        lease.workspace.replace_analysis(record.start(now + timedelta(milliseconds=1)))

    first, first_pending = await service.cancel("user", workspace_id, created.id)
    second, second_pending = await service.cancel("user", workspace_id, created.id)

    assert first_pending is second_pending is True
    assert first.cancellation_requested_at == second.cancellation_requested_at
    assert first.revision == second.revision
    assert len(execution.cancelled) == 1


@pytest.mark.anyio
async def test_clear_hides_analysis_and_allows_immediate_resubmission(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    first = await _submit(service, "user", workspace_id, tab_id, _request(node_id))

    await service.clear_tab("user", workspace_id, tab_id)

    assert cast(
        Tab, await workspaces.get_tab("user", workspace_id, tab_id)
    ).analysis_ids == []
    page = await service.list_analyses("user", workspace_id, page=1, page_size=50)
    assert page.items == []
    second = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    assert second.id != first.id


@pytest.mark.anyio
async def test_delete_tab_uses_analysis_cancellation_and_detachment_lifecycle(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    key = AnalysisExecutionKey("user", workspace_id, created.id)
    async with workspaces.mutation_context(
        "user", workspace_id, internal=True
    ) as lease:
        record = lease.workspace.analyses[created.id]
        lease.workspace.replace_analysis(record.start(datetime.now(UTC)))

    await service.delete_tab("user", workspace_id, tab_id)

    async with workspaces.read_context("user", workspace_id) as lease:
        assert tab_id not in lease.workspace.tabs
        detached = lease.workspace.analyses[created.id]
        assert detached.cancellation_requested_at is not None
        assert lease.workspace.live_analysis_ids() == set()
    assert execution.cancelled == [key]

    await service.complete_execution(key, {"kind": "concordance"})
    async with workspaces.read_context("user", workspace_id) as lease:
        assert created.id not in lease.workspace.analyses


@pytest.mark.anyio
async def test_dispatch_preserves_expected_domain_failure(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    service = _analysis_service(tmp_path, workspaces, _ExecutionControl())
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    key = AnalysisExecutionKey("user", workspace_id, created.id)

    async def prepare(_lease, _record, _credential: str | None) -> AnalysisInvocation:
        raise InvalidInputError("Raw-text Data Blocks require a tokenizer model")

    async def launch_control(_key: AnalysisExecutionKey) -> None:
        return None

    invocation = await service.admit_execution(
        key,
        credential=None,
        prepare=prepare,
        reserve_launch=launch_control,
        discard_launch=launch_control,
    )
    failed = await service.get("user", workspace_id, created.id)

    assert invocation is None
    assert failed.state is AnalysisState.FAILED
    assert failed.started_at is None
    assert failed.error is not None
    assert failed.error.code == "invalid_input"
    assert failed.error.message == "Raw-text Data Blocks require a tokenizer model"


@pytest.mark.anyio
async def test_dispatch_preserves_unexpected_admission_diagnostic(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    service = _analysis_service(tmp_path, workspaces, _ExecutionControl())
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    key = AnalysisExecutionKey("user", workspace_id, created.id)

    async def prepare(_lease, _record, _credential: str | None) -> AnalysisInvocation:
        raise RuntimeError("private diagnostic")

    async def launch_control(_key: AnalysisExecutionKey) -> None:
        return None

    invocation = await service.admit_execution(
        key,
        credential=None,
        prepare=prepare,
        reserve_launch=launch_control,
        discard_launch=launch_control,
    )
    failed = await service.get("user", workspace_id, created.id)

    assert invocation is None
    assert failed.state is AnalysisState.FAILED
    assert failed.error is not None
    assert failed.error.code == "analysis_start_failed"
    assert failed.error.message == "RuntimeError: private diagnostic"


@pytest.mark.anyio
async def test_dispatch_progress_and_success_use_the_expected_write_boundaries(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    key = AnalysisExecutionKey("user", workspace_id, created.id)
    launch_entries: list[AnalysisExecutionKey] = []

    async def prepare(_lease, _record, _credential: str | None) -> AnalysisInvocation:
        return AnalysisInvocation(
            input=PreviewReadyInput(),
            storage_roots=(),
            max_storage_bytes=1024,
            max_storage_files=1,
        )

    async def reserve(value: AnalysisExecutionKey) -> None:
        launch_entries.append(value)

    async def discard(value: AnalysisExecutionKey) -> None:
        launch_entries.remove(value)

    invocation = await service.admit_execution(
        key,
        credential=None,
        prepare=prepare,
        reserve_launch=reserve,
        discard_launch=discard,
    )
    running = await service.get("user", workspace_id, created.id)
    running_workspace = await workspaces.get_workspace("user", workspace_id)

    assert invocation is not None
    assert running.state is AnalysisState.RUNNING
    assert launch_entries == [key]

    await service.report_progress(
        key,
        {"fraction": None, "message": "Waiting"},
    )
    await service.report_progress(
        key,
        {"fraction": None, "message": "Still waiting"},
    )
    live = await service.get("user", workspace_id, created.id)

    assert live.progress.fraction is None
    assert live.progress.message == "Still waiting"
    assert (
        await workspaces.get_workspace("user", workspace_id)
    ).revision == running_workspace.revision

    await service.complete_execution(key, {"kind": "concordance"})
    succeeded = await service.get("user", workspace_id, created.id)

    assert succeeded.state is AnalysisState.SUCCEEDED
    assert succeeded.progress.fraction == 1.0
    assert succeeded.revision == running.revision + 1


@pytest.mark.anyio
async def test_result_context_requires_success_and_current_inputs(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    service = _analysis_service(tmp_path, workspaces, _ExecutionControl())
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))

    with pytest.raises(AnalysisNotSucceededError):
        async with service.successful_record_context(
            "user",
            workspace_id,
            created.id,
            allow_closing=True,
        ):
            pass

    key = AnalysisExecutionKey("user", workspace_id, created.id)
    async with workspaces.mutation_context(
        "user", workspace_id, internal=True
    ) as lease:
        record = lease.workspace.analyses[created.id]
        lease.workspace.replace_analysis(record.start(datetime.now(UTC)))
    await service.complete_execution(key, {"kind": "concordance"})
    async with workspaces.mutation_context("user", workspace_id) as lease:
        assert lease.workspace.remove_node(node_id)

    with pytest.raises(AnalysisInputGoneError) as exc_info:
        async with service.successful_record_context(
            "user",
            workspace_id,
            created.id,
            allow_closing=True,
        ):
            pass
    assert exc_info.value.details == {"missing_input_ids": [str(node_id)]}


@pytest.mark.anyio
async def test_invalid_progress_fails_only_the_owning_analysis(tmp_path: Path) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    key = AnalysisExecutionKey("user", workspace_id, created.id)

    async with workspaces.mutation_context(
        "user", workspace_id, internal=True
    ) as lease:
        record = lease.workspace.analyses[created.id]
        lease.workspace.replace_analysis(record.start(datetime.now(UTC)))

    await service.report_progress(
        key,
        {"fraction": 1.0, "message": "Worker claimed success"},
    )
    failed = await service.get("user", workspace_id, created.id)

    assert failed.state is AnalysisState.FAILED
    assert failed.error is not None and failed.error.code == "progress_invalid"
    assert execution.cancelled[-1] == key


@pytest.mark.anyio
async def test_detached_running_completion_confirms_cancellation_then_cleans_up(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    key = AnalysisExecutionKey("user", workspace_id, created.id)
    async with workspaces.mutation_context(
        "user", workspace_id, internal=True
    ) as lease:
        record = lease.workspace.analyses[created.id]
        lease.workspace.replace_analysis(record.start(datetime.now(UTC)))

    await service.clear_tab("user", workspace_id, tab_id)
    await service.complete_execution(key, {"kind": "concordance"})

    async with workspaces.read_context("user", workspace_id) as lease:
        assert created.id not in lease.workspace.analyses
        assert node_id not in lease.workspace.reserved_node_ids()


@pytest.mark.anyio
async def test_shutdown_interruption_distinguishes_queued_running_and_user_cancel(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)

    queued = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    queued_key = AnalysisExecutionKey("user", workspace_id, queued.id)
    await service.interrupt_queued_execution(queued_key)
    queued_terminal = await service.get("user", workspace_id, queued.id)
    assert queued_terminal.state is AnalysisState.FAILED
    assert queued_terminal.error is not None
    assert queued_terminal.error.code == "analysis_interrupted"
    assert queued_terminal.cancellation_requested_at is None

    await service.clear_tab("user", workspace_id, tab_id)
    running = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    running_key = AnalysisExecutionKey("user", workspace_id, running.id)
    async with workspaces.mutation_context(
        "user", workspace_id, internal=True
    ) as lease:
        record = lease.workspace.analyses[running.id]
        lease.workspace.replace_analysis(record.start(datetime.now(UTC)))
    await service.interrupt_execution(running_key)
    running_terminal = await service.get("user", workspace_id, running.id)
    assert running_terminal.state is AnalysisState.FAILED
    assert running_terminal.error is not None
    assert running_terminal.error.code == "analysis_interrupted"

    await service.clear_tab("user", workspace_id, tab_id)
    cancelling = await _submit(service, "user", workspace_id, tab_id, _request(node_id))
    cancelling_key = AnalysisExecutionKey("user", workspace_id, cancelling.id)
    async with workspaces.mutation_context(
        "user", workspace_id, internal=True
    ) as lease:
        record = lease.workspace.analyses[cancelling.id]
        lease.workspace.replace_analysis(record.start(datetime.now(UTC)))
    await service.cancel("user", workspace_id, cancelling.id)
    await service.interrupt_execution(cancelling_key)
    cancelled = await service.get("user", workspace_id, cancelling.id)
    assert cancelled.state is AnalysisState.CANCELLED
    assert cancelled.cancellation_requested_at is not None


@pytest.mark.anyio
async def test_open_finalization_fails_interrupted_workspace_analyses(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, first_tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    execution = _ExecutionControl()
    service = _analysis_service(tmp_path, workspaces, execution)
    queued = await _submit(
        service, "user", workspace_id, first_tab_id, _request(node_id)
    )
    second_tab = await workspaces.create_tab(
        "user",
        workspace_id,
        TabCreate(kind=AnalysisKind.CONCORDANCE, name="Second"),
    )
    running = await _submit(
        service, "user", workspace_id, second_tab.id, _request(node_id)
    )
    async with workspaces.mutation_context(
        "user", workspace_id, internal=True
    ) as lease:
        record = lease.workspace.analyses[running.id]
        lease.workspace.replace_analysis(record.start(datetime.now(UTC)))

    async def no_active_work(_user_id: str, _workspace_id: uuid.UUID) -> bool:
        return False

    await workspaces.request_close("user", workspace_id, no_active_work)
    before = await workspaces.open_workspace("user", workspace_id)
    await service.finalize_interrupted_analyses("user", workspace_id)

    finalized = await workspaces.get_workspace("user", workspace_id)
    assert finalized.runtime_state == "open"
    assert finalized.revision == before.revision + 1
    queued_terminal = await service.get("user", workspace_id, queued.id)
    running_terminal = await service.get("user", workspace_id, running.id)
    assert queued_terminal.state is AnalysisState.FAILED
    assert running_terminal.state is AnalysisState.FAILED
    assert queued_terminal.error is not None
    assert running_terminal.error is not None
    assert queued_terminal.error.code == "analysis_interrupted"
    assert running_terminal.error.code == "analysis_interrupted"


@pytest.mark.anyio
async def test_unavailable_analysis_is_preserved_until_explicit_clear(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, node_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    service = _analysis_service(tmp_path, workspaces, _ExecutionControl())
    created = await _submit(service, "user", workspace_id, tab_id, _request(node_id))

    async def no_active_work(_user_id: str, _workspace_id: uuid.UUID) -> bool:
        return False

    await workspaces.request_close("user", workspace_id, no_active_work)
    workspace_path = tmp_path / "workspaces" / str(workspace_id)
    manifest = json.loads((workspace_path / "workspace.json").read_text(encoding="utf-8"))
    reference = next(item for item in manifest["analyses"] if item["id"] == str(created.id))
    analysis_path = workspace_path / reference["record_path"]
    invalid_bytes = b"not valid analysis json"
    analysis_path.write_bytes(invalid_bytes)

    await workspaces.open_workspace("user", workspace_id)
    resources = await service.for_tab("user", workspace_id, tab_id)

    assert len(resources) == 1
    assert resources[0].availability == "unavailable"
    assert resources[0].reason == "record_invalid"
    assert analysis_path.read_bytes() == invalid_bytes

    await service.clear_tab("user", workspace_id, tab_id)

    assert await service.for_tab("user", workspace_id, tab_id) == []
    assert not analysis_path.exists()


@pytest.mark.anyio
async def test_active_analysis_reservation_blocks_input_and_ancestor_mutation(
    tmp_path: Path,
) -> None:
    workspaces, workspace_id, source_id, tab_id = await _opened_workspace_with_tab(
        tmp_path
    )
    child_id = uuid.uuid4()

    def add_child(workspace: Workspace) -> None:
        source = workspace.nodes[source_id]
        workspace.add_node(
            Node(
                id=child_id,
                name="Derived documents",
                data=source.data,
                document="text",
                parents=[source],
                provenance=DerivationProvenance(
                    operation=CloneDerivation(),
                    inputs=[
                        DerivationInput(
                            role="source",
                            value=node_reference(source.id),
                        )
                    ],
                ),
            )
        )

    await workspaces.mutate_workspace("user", workspace_id, add_child)
    analyses = _analysis_service(tmp_path, workspaces, _ExecutionControl())
    await _submit(
        analyses,
        "user",
        workspace_id,
        tab_id,
        _request(child_id),
    )

    settings = workspaces.settings
    limiter = anyio.CapacityLimiter(4)
    nodes = NodeService(
        workspaces,
        cast(Any, None),
        storage_admission=unlimited_storage_admission(tmp_path, limiter=limiter),
        io_limiter=limiter,
        max_source_bytes=settings.max_preview_source_bytes,
        max_storage_bytes=settings.max_node_storage_bytes,
    )

    with pytest.raises(DataBlockInUseError):
        await nodes.update(
            "user",
            workspace_id,
            child_id,
            NodeUpdateRequest(name="Blocked rename"),
        )
    with pytest.raises(DataBlockInUseError):
        await nodes.delete("user", workspace_id, source_id)
    with pytest.raises(DataBlockInUseError):
        await nodes.edit(
            "user",
            workspace_id,
            child_id,
            CastNodeEditRequest(column="text", target_type="string"),
        )
    with pytest.raises(DataBlockInUseError):
        await nodes.undo("user", workspace_id, child_id)
    with pytest.raises(DataBlockInUseError):
        await nodes.redo("user", workspace_id, child_id)

    async with workspaces.read_context("user", workspace_id) as lease:
        assert set(lease.workspace.nodes) == {source_id, child_id}
        assert lease.workspace.nodes[child_id].parents == [
            lease.workspace.nodes[source_id]
        ]
