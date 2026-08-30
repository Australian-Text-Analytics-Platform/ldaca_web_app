"""Strict Workspace-owned Analysis model and lifecycle invariants."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import TypeAdapter, ValidationError

from ldaca_wordflow.domain.workspace import (
    AnalysisQuerySnapshotRecord,
    AnalysisRecord,
    AnalysisExecutionScope,
    AnalysisRequest,
    AnalysisState,
    AnalysisKind,
    AnnotationAnalysisRequest,
    AnnotationAnalysisSubmission,
    ConcordanceAnalysisRequest,
    ConcordanceDocumentDataBlockCreationAnalysisRequest,
    ConcordanceDocumentDataBlockCreationSource,
    ConcordanceMatchDataBlockCreationAnalysisRequest,
    ConcordanceRunAllAnalysisRequest,
    Failure,
    LocalQuotationEngineSelection,
    Progress,
    Tab,
    TokenFrequencyAnalysisRequest,
    TopicModelingAnalysisRequest,
    TopicModelingProjectionSelection,
    TopicModelingTabSettings,
    ValidAnalysisIntegrity,
    Workspace,
    TopicModelingDataBlockCreationAnalysisRequest,
    QuotationAnalysisRequest,
    QuotationEngineType,
    QuotationResultDataBlockCreationAnalysisRequest,
    SequentialDataBlockCreationAnalysisRequest,
    SequentialDataBlockCreationSource,
    DataBlockCreationSource,
    persisted_submission,
    public_analysis,
)


def _concordance() -> ConcordanceAnalysisRequest:
    node_id = uuid.uuid4()
    return ConcordanceAnalysisRequest(
        node_ids=[node_id],
        node_columns={node_id: "text"},
        search_word="word",
    )


def test_concordance_ignore_punctuation_defaults_false_and_persists_true() -> None:
    legacy = _concordance()
    enabled = legacy.model_copy(update={"ignore_punctuation": True})

    assert legacy.ignore_punctuation is False
    assert enabled.model_dump(mode="json")["ignore_punctuation"] is True


def _analysis(
    request: AnalysisRequest,
    *,
    timestamp: datetime,
    tab_id: uuid.UUID | None = None,
    execution_scope: AnalysisExecutionScope = AnalysisExecutionScope.PREVIEW,
    parent_analysis_id: uuid.UUID | None = None,
) -> AnalysisRecord:
    return AnalysisRecord.create(
        request,
        tab_id=tab_id or uuid.uuid4(),
        execution_scope=execution_scope,
        timestamp=timestamp,
        parent_analysis_id=parent_analysis_id,
    )


def test_analysis_request_union_is_strict_and_discriminated() -> None:
    request = _concordance()
    restored = TypeAdapter(AnalysisRequest).validate_python(
        request.model_dump(mode="json")
    )

    assert restored == request
    with pytest.raises(ValidationError):
        TypeAdapter(AnalysisRequest).validate_python(
            {**request.model_dump(mode="json"), "unknown": True}
        )


def test_presentation_fields_are_rejected_from_analysis_requests() -> None:
    node_id = uuid.uuid4()
    token_payload = {
        "node_ids": [node_id],
        "node_columns": {node_id: "text"},
        "node_tokenizer_models": {node_id: "native:plain_words_en"},
        "stop_words": ["the"],
    }
    topic_payload = {
        "node_ids": [node_id],
        "node_columns": {node_id: "text"},
        "representative_words_count": 15,
    }

    with pytest.raises(ValidationError):
        TokenFrequencyAnalysisRequest.model_validate(token_payload)
    with pytest.raises(ValidationError):
        TopicModelingAnalysisRequest.model_validate(topic_payload)


def test_data_block_creation_kind_strictly_replaces_result_data_block_creation() -> (
    None
):
    source_id = uuid.uuid4()
    payload = {
        "kind": "concordance_match_data_block_creation",
        "sources": [
            {
                "source_node_id": str(source_id),
                "selected_columns": ["text", "CONC_matched_text"],
                "new_node_name": "Concordance matches",
            }
        ],
    }

    restored = TypeAdapter(AnalysisRequest).validate_python(payload)
    assert restored.kind == "concordance_match_data_block_creation"
    with pytest.raises(ValidationError):
        TypeAdapter(AnalysisRequest).validate_python(
            {**payload, "kind": "concordance_match_publication"}
        )


def test_tokenizer_mappings_follow_each_analysis_mode_contract() -> None:
    first = uuid.uuid4()
    second = uuid.uuid4()

    with pytest.raises(ValidationError, match="exactly match"):
        TokenFrequencyAnalysisRequest(
            node_ids=[first, second],
            node_columns={first: "text", second: "body"},
            node_tokenizer_models={first: "native:plain_words_en"},
        )

    text_request = ConcordanceAnalysisRequest(
        node_ids=[first, second],
        node_columns={first: "text", second: "body"},
        node_tokenizer_models={first: "native:plain_words_en"},
        search_word="word",
    )
    assert text_request.node_tokenizer_models == {first: "native:plain_words_en"}

    with pytest.raises(ValidationError, match="Tokens mode"):
        ConcordanceAnalysisRequest(
            node_ids=[first, second],
            node_columns={first: "text", second: "body"},
            node_tokenizer_models={first: "native:plain_words_en"},
            search_word="word",
            search_mode="tokens",
        )

    tokens_request = ConcordanceAnalysisRequest(
        node_ids=[first, second],
        node_columns={first: "text", second: "body"},
        node_tokenizer_models={
            first: "native:plain_words_en",
            second: "lindera:jieba",
        },
        search_word="word",
        search_mode="tokens",
    )
    assert set(tokens_request.node_tokenizer_models) == {first, second}


def test_topic_modeling_data_block_creation_request_preserves_ordered_sources() -> None:
    first = uuid.uuid4()
    second = uuid.uuid4()
    request = TopicModelingDataBlockCreationAnalysisRequest(
        node_ids=[first, second],
        selected_columns={first: ["text"], second: []},
        new_node_names={first: "First topics", second: "Second topics"},
        topic_ids=[3, 1],
        cluster_count=4,
        top_n_topics=2,
        topic_meanings_override=[
            {"topic_id": 3, "words": ["one", "two"]},
            {"topic_id": 1, "words": ["three"]},
        ],
    )

    restored = TypeAdapter(AnalysisRequest).validate_python(
        request.model_dump(mode="json")
    )
    assert restored == request
    assert tuple(restored.node_ids) == (first, second)
    assert restored.selected_columns[second] == []

    with pytest.raises(ValidationError, match="unique"):
        TopicModelingDataBlockCreationAnalysisRequest(
            node_ids=[first, first],
            selected_columns={first: ["text"]},
            new_node_names={first: "Topics"},
            cluster_count=2,
            top_n_topics=2,
        )
    with pytest.raises(ValidationError, match="fit"):
        TopicModelingDataBlockCreationAnalysisRequest(
            node_ids=[first],
            selected_columns={first: ["text"]},
            new_node_names={first: "Topics"},
            topic_ids=[2],
            cluster_count=2,
            top_n_topics=2,
        )

    document_creation = ConcordanceDocumentDataBlockCreationAnalysisRequest(
        sources=[
            ConcordanceDocumentDataBlockCreationSource(
                source_node_id=first,
                selected_metadata_columns=["author"],
                new_node_name="First documents",
                excluded_matched_texts=["Word"],
                bin_count=10,
                selected_bins=[2, 3],
            )
        ]
    )
    assert (
        TypeAdapter(AnalysisRequest).validate_python(
            document_creation.model_dump(mode="json")
        )
        == document_creation
    )
    with pytest.raises(ValidationError, match="align"):
        TopicModelingDataBlockCreationAnalysisRequest(
            node_ids=[first, second],
            selected_columns={first: ["text"]},
            new_node_names={first: "Topics", second: "Other topics"},
            cluster_count=2,
            top_n_topics=2,
        )
    with pytest.raises(ValidationError):
        ConcordanceAnalysisRequest(
            node_ids=request.node_ids,
            node_columns={},
            search_word="word",
        )


def test_run_all_and_data_block_creation_have_distinct_strict_requests() -> None:
    first = uuid.uuid4()
    second = uuid.uuid4()
    source = ConcordanceAnalysisRequest(
        node_ids=[first, second],
        node_columns={first: "text", second: "body"},
        search_word="word",
    )

    run_all = ConcordanceRunAllAnalysisRequest(source=source)
    assert (
        TypeAdapter(AnalysisRequest).validate_python(run_all.model_dump(mode="json"))
        == run_all
    )
    with pytest.raises(ValidationError):
        ConcordanceRunAllAnalysisRequest.model_validate(
            {
                **run_all.model_dump(mode="json"),
                "metadata_columns": ["author"],
            }
        )

    creation = ConcordanceMatchDataBlockCreationAnalysisRequest(
        sources=[
            DataBlockCreationSource(
                source_node_id=first,
                selected_columns=["text", "CONC_matched_text"],
                new_node_name="First concordance",
            ),
            DataBlockCreationSource(
                source_node_id=second,
                selected_columns=["body"],
                new_node_name="Second concordance",
            ),
        ]
    )
    restored = TypeAdapter(AnalysisRequest).validate_python(
        creation.model_dump(mode="json")
    )
    assert restored == creation
    with pytest.raises(ValidationError, match="unique"):
        ConcordanceMatchDataBlockCreationAnalysisRequest(
            sources=[creation.sources[0], creation.sources[0]]
        )

    quotation_source = QuotationAnalysisRequest(
        node_id=first,
        column="text",
        engine=LocalQuotationEngineSelection(type=QuotationEngineType.LOCAL),
    )
    quotation_run_all = QuotationResultDataBlockCreationAnalysisRequest(
        source=DataBlockCreationSource(
            source_node_id=quotation_source.node_id,
            selected_columns=["text", "QUOTE_quote"],
            new_node_name="Quotations",
        )
    )
    assert (
        TypeAdapter(AnalysisRequest).validate_python(
            quotation_run_all.model_dump(mode="json")
        )
        == quotation_run_all
    )


def test_sequential_data_block_creation_filter_is_strict_and_ordered() -> None:
    source_id = uuid.uuid4()
    request = SequentialDataBlockCreationAnalysisRequest(
        source=SequentialDataBlockCreationSource(
            source_node_id=source_id,
            selected_columns=["when", "text", "group"],
            new_node_name="Selected trends",
            selected_period_indices=[3, 1],
            excluded_group_indices=[2],
        )
    )

    restored = TypeAdapter(AnalysisRequest).validate_python(
        request.model_dump(mode="json")
    )
    assert restored == request
    assert restored.source.selected_columns == ["when", "text", "group"]
    with pytest.raises(ValidationError, match="unique"):
        SequentialDataBlockCreationSource(
            source_node_id=source_id,
            selected_columns=["when"],
            new_node_name="Duplicate period",
            selected_period_indices=[1, 1],
        )
    with pytest.raises(ValidationError, match="out of range"):
        SequentialDataBlockCreationSource(
            source_node_id=source_id,
            selected_columns=["when"],
            new_node_name="Negative group",
            excluded_group_indices=[-1],
        )


def test_annotation_submission_strips_transient_secret_before_persistence() -> None:
    submission = AnnotationAnalysisSubmission(
        node_id=uuid.uuid4(),
        text_column="text",
        annotation_column="class",
        class_node_id=uuid.uuid4(),
        class_column="class",
        description_column="description",
        classes=[{"name": "Relevant", "description": ""}],
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
        model="model",
        instruction="Classify the text",
        api_key="transient-secret",
    )

    persisted = persisted_submission(submission)

    assert isinstance(persisted, AnnotationAnalysisRequest)
    assert persisted.kind == "annotation"
    assert "api_key" not in persisted.model_dump(mode="json")
    assert "transient-secret" not in repr(submission)


@pytest.mark.parametrize(
    "progress",
    [
        {"fraction": -0.1, "message": "Bad"},
        {"fraction": 1.1, "message": "Bad"},
        {"fraction": float("nan"), "message": "Bad"},
        {"fraction": float("inf"), "message": "Bad"},
        {"fraction": "0.5", "message": "Bad"},
        {"fraction": 0.5, "message": 123},
        {"fraction": 0.5, "message": "bad\u0000message"},
        {"fraction": 0.5, "message": "x" * 501},
    ],
)
def test_progress_rejects_normalization_and_unsafe_values(
    progress: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        Progress.model_validate(progress)


def test_analysis_lifecycle_and_public_shape_are_exact() -> None:
    created_at = datetime.now(UTC)
    record = _analysis(_concordance(), timestamp=created_at)
    public = public_analysis(record, integrity=ValidAnalysisIntegrity())

    assert set(public.model_dump()) == {
        "availability",
        "id",
        "tab_id",
        "parent_analysis_id",
        "execution_scope",
        "supersedes_analysis_ids",
        "request",
        "state",
        "progress",
        "cancellation_requested_at",
        "error",
        "integrity",
        "created_at",
        "started_at",
        "finished_at",
        "revision",
        "output_node_ids",
    }
    assert record.state is AnalysisState.QUEUED
    assert record.progress == Progress(fraction=0.0, message="Queued")
    assert record.output_node_ids == []
    assert public.output_node_ids == []

    payload = record.model_dump()
    payload.update(
        state="succeeded",
        started_at=created_at + timedelta(seconds=1),
        finished_at=created_at + timedelta(seconds=2),
        progress={"fraction": 0.9, "message": "Done"},
        result_payload={"ok": True},
    )
    with pytest.raises(ValidationError):
        AnalysisRecord.model_validate(payload)

    payload.update(progress={"fraction": 1.0, "message": "Done"})
    succeeded = AnalysisRecord.model_validate(payload)
    assert succeeded.state is AnalysisState.SUCCEEDED


def test_failed_and_cancelled_lifecycle_fields_are_not_interchangeable() -> None:
    record = _analysis(_concordance(), timestamp=datetime.now(UTC))
    payload = record.model_dump()
    payload.update(
        state="failed",
        finished_at=record.created_at,
        error=Failure(code="analysis_execution_failed", message="Analysis failed"),
    )
    assert AnalysisRecord.model_validate(payload).state is AnalysisState.FAILED

    payload.update(state="cancelled", error=None)
    with pytest.raises(ValidationError):
        AnalysisRecord.model_validate(payload)
    payload["cancellation_requested_at"] = record.created_at
    assert AnalysisRecord.model_validate(payload).state is AnalysisState.CANCELLED


def test_workspace_supports_arbitrary_depth_analysis_forests_and_reservations() -> None:
    workspace = Workspace(name="analyses")
    node_id = uuid.uuid4()
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.CONCORDANCE,
            name="Concordance",
            timestamp=datetime.now(UTC),
        )
    )
    request = ConcordanceAnalysisRequest(
        node_ids=[node_id],
        node_columns={node_id: "text"},
        search_word="word",
    )
    root = workspace.add_analysis(
        _analysis(request, tab_id=tab.id, timestamp=datetime.now(UTC))
    )
    run_all_request = ConcordanceRunAllAnalysisRequest(source=request)
    child = workspace.add_analysis(
        _analysis(
            run_all_request,
            tab_id=tab.id,
            execution_scope=AnalysisExecutionScope.SUPPORTING,
            timestamp=datetime.now(UTC),
            parent_analysis_id=root.id,
        )
    )

    assert workspace.analysis_children(root.id) == [child]
    assert workspace.reserved_node_ids() == {node_id}

    grandchild = _analysis(
        run_all_request,
        tab_id=tab.id,
        execution_scope=AnalysisExecutionScope.SUPPORTING,
        timestamp=datetime.now(UTC),
        parent_analysis_id=child.id,
    )
    workspace.add_analysis(grandchild)

    assert workspace.analysis_descendants(root.id) == [child, grandchild]
    assert tab.analysis_ids == [root.id, child.id, grandchild.id]


def test_removing_topic_analysis_clears_its_tab_projection_selection() -> None:
    workspace = Workspace(name="topics")
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.TOPIC_MODELING,
            name="Topics",
            timestamp=datetime.now(UTC),
        )
    )
    node_id = uuid.uuid4()
    analysis = workspace.add_analysis(
        _analysis(
            TopicModelingAnalysisRequest(
                node_ids=[node_id],
                node_columns={node_id: "text"},
            ),
            tab_id=tab.id,
            execution_scope=AnalysisExecutionScope.RUN_ALL,
            timestamp=datetime.now(UTC),
        )
    )
    assert isinstance(tab.settings, TopicModelingTabSettings)
    tab.settings.projection_selection = TopicModelingProjectionSelection(
        analysis_id=analysis.id,
        cluster_count=2,
        top_n_topics=2,
    )

    workspace.remove_analysis(analysis.id)

    assert tab.settings.projection_selection is None


def test_workspace_separates_live_visibility_from_detached_reservations() -> None:
    workspace = Workspace(name="analyses")
    node_id = uuid.uuid4()
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.CONCORDANCE,
            name="Concordance",
            timestamp=datetime.now(UTC),
        )
    )
    root = workspace.add_analysis(
        _analysis(
            ConcordanceAnalysisRequest(
                node_ids=[node_id],
                node_columns={node_id: "text"},
                search_word="word",
            ),
            tab_id=tab.id,
            timestamp=datetime.now(UTC),
        )
    )

    assert workspace.live_analysis_ids() == {root.id}
    assert workspace.analysis_tab_id(root.id) == tab.id

    tab.analysis_ids.clear()

    assert workspace.live_analysis_ids() == set()
    assert workspace.analysis_tab_id(root.id) is None
    assert workspace.reserved_node_ids() == {node_id}


def test_analysis_transition_methods_preserve_request_and_advance_revision() -> None:
    created_at = datetime.now(UTC)
    record = _analysis(_concordance(), timestamp=created_at)

    running = record.start(created_at + timedelta(seconds=1))
    requested = running.request_running_cancellation(created_at + timedelta(seconds=2))
    repeated = requested.request_running_cancellation(created_at + timedelta(seconds=3))
    cancelled = requested.confirm_cancelled(
        created_at + timedelta(seconds=4),
        progress=Progress(fraction=0.5, message="Stopping"),
    )

    assert running.revision == 2
    assert requested.revision == 3
    assert repeated is requested
    assert cancelled.revision == 4
    assert cancelled.request == record.request
    assert cancelled.state is AnalysisState.CANCELLED
    assert cancelled.progress.fraction == 0.5


def test_queued_cancellation_and_interrupted_failure_have_exact_timestamps() -> None:
    created_at = datetime.now(UTC)
    record = _analysis(_concordance(), timestamp=created_at)
    cancelled_at = created_at + timedelta(seconds=1)

    cancelled = record.cancel_queued(cancelled_at)
    failed = record.fail(
        cancelled_at,
        failure=Failure(code="analysis_interrupted", message="Analysis interrupted"),
        progress=record.progress,
    )

    assert cancelled.cancellation_requested_at == cancelled_at
    assert cancelled.finished_at == cancelled_at
    assert cancelled.started_at is None
    assert failed.state is AnalysisState.FAILED
    assert failed.started_at is None


def test_success_is_one_atomic_validated_transition() -> None:
    created_at = datetime.now(UTC)
    record = _analysis(_concordance(), timestamp=created_at)
    running = record.start(created_at + timedelta(seconds=1))

    succeeded = running.succeed(
        created_at + timedelta(seconds=2),
        result_payload={"kind": "concordance"},
    )

    assert succeeded.state is AnalysisState.SUCCEEDED
    assert succeeded.progress.fraction == 1.0
    assert succeeded.result_payload == {"kind": "concordance"}
    assert succeeded.output_node_ids == []
    with pytest.raises(ValueError, match="running"):
        record.succeed(created_at, result_payload={"kind": "concordance"})


def test_success_records_query_snapshot_as_a_private_explicit_dependency() -> None:
    created_at = datetime.now(UTC)
    running = _analysis(_concordance(), timestamp=created_at).start(
        created_at + timedelta(seconds=1)
    )
    query_snapshot = AnalysisQuerySnapshotRecord(
        relative_path=f"analyses/{running.id}/query-input"
    )

    succeeded = running.succeed(
        created_at + timedelta(seconds=2),
        result_payload={"kind": "concordance"},
        query_snapshot=query_snapshot,
    )

    assert succeeded.query_snapshot == query_snapshot
    assert (
        "query_snapshot"
        not in public_analysis(
            succeeded, integrity=ValidAnalysisIntegrity()
        ).model_dump()
    )

    invalid = running.model_dump()
    invalid["query_snapshot"] = query_snapshot.model_dump()
    with pytest.raises(ValidationError, match="successful"):
        AnalysisRecord.model_validate(invalid)


def test_analysis_output_node_ids_are_required_unique_and_strictly_plural() -> None:
    created_at = datetime.now(UTC)
    first = uuid.uuid4()
    second = uuid.uuid4()
    succeeded = (
        _analysis(_concordance(), timestamp=created_at)
        .start(created_at + timedelta(seconds=1))
        .succeed(
            created_at + timedelta(seconds=2),
            result_payload={"kind": "concordance"},
            output_node_ids=[first, second],
        )
    )

    assert succeeded.output_node_ids == [first, second]
    assert public_analysis(
        succeeded, integrity=ValidAnalysisIntegrity()
    ).output_node_ids == [first, second]

    missing = succeeded.model_dump(exclude={"output_node_ids"})
    with pytest.raises(ValidationError):
        AnalysisRecord.model_validate(missing)

    singular = succeeded.model_dump(exclude={"output_node_ids"})
    singular["output_node_id"] = first
    with pytest.raises(ValidationError):
        AnalysisRecord.model_validate(singular)

    duplicate = succeeded.model_dump()
    duplicate["output_node_ids"] = [first, first]
    with pytest.raises(ValidationError, match="unique"):
        AnalysisRecord.model_validate(duplicate)
