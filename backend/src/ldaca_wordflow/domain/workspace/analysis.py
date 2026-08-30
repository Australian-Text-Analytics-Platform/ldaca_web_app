"""Strict Workspace-owned Analysis requests and lifecycle records."""

from __future__ import annotations

import math
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StringConstraints,
    model_validator,
)

from ...shared.json_data import JsonData
from ..annotation import (
    AnnotationClass,
    AnnotationExampleSamplingMethod,
    AnnotationProviderSnapshot,
)
from ..background import BackgroundState, Failure, Progress


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


NonEmptyText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]


AnalysisState = BackgroundState


class AnalysisExecutionScope(StrEnum):
    PREVIEW = "preview"
    RUN_ALL = "run_all"
    SUPPORTING = "supporting"


class ValidAnalysisIntegrity(_StrictModel):
    status: Literal["valid"] = "valid"


class InvalidAnalysisIntegrity(_StrictModel):
    status: Literal["invalid"] = "invalid"
    code: Literal["analysis_input_missing"] = "analysis_input_missing"
    missing_input_ids: list[uuid.UUID]

    @model_validator(mode="after")
    def require_distinct_missing_inputs(self) -> InvalidAnalysisIntegrity:
        if not self.missing_input_ids or len(self.missing_input_ids) != len(
            set(self.missing_input_ids)
        ):
            raise ValueError("Missing Analysis inputs must be distinct")
        return self


AnalysisIntegrity = Annotated[
    ValidAnalysisIntegrity | InvalidAnalysisIntegrity,
    Field(discriminator="status"),
]


class QuotationEngineType(StrEnum):
    LOCAL = "local"
    REMOTE = "remote"


class LocalQuotationEngineSelection(_StrictModel):
    type: Literal[QuotationEngineType.LOCAL]


class RemoteQuotationEngineSelection(_StrictModel):
    type: Literal[QuotationEngineType.REMOTE]
    engine_id: NonEmptyText = Field(max_length=64)


type QuotationEngineSelection = Annotated[
    LocalQuotationEngineSelection | RemoteQuotationEngineSelection,
    Field(discriminator="type"),
]


def _validate_node_columns(
    node_ids: list[uuid.UUID],
    node_columns: dict[uuid.UUID, str],
) -> None:
    if len(node_ids) != len(set(node_ids)):
        raise ValueError("Data Block IDs must be distinct")
    if set(node_columns) != set(node_ids):
        raise ValueError("Data Block columns must exactly match the requested IDs")
    if any(not column.strip() for column in node_columns.values()):
        raise ValueError("Every Data Block requires a non-empty source column")


class TokenFrequencyAnalysisRequest(_StrictModel):
    kind: Literal["token_frequency"] = "token_frequency"
    node_ids: list[uuid.UUID] = Field(min_length=1, max_length=2)
    node_columns: dict[uuid.UUID, NonEmptyText]
    token_limit: int = Field(default=25, ge=1, le=5000)
    node_tokenizer_models: dict[uuid.UUID, NonEmptyText]

    @model_validator(mode="after")
    def validate_nodes(self) -> TokenFrequencyAnalysisRequest:
        _validate_node_columns(self.node_ids, self.node_columns)
        if set(self.node_tokenizer_models) != set(self.node_ids):
            raise ValueError("Tokenizer models must exactly match requested inputs")
        return self


class TopicSegmentationMethod(StrEnum):
    AUTOMATIC = "automatic"
    PARAGRAPH = "paragraph"
    SENTENCE = "sentence"


class TopicModelingAnalysisRequest(_StrictModel):
    kind: Literal["topic_modeling"] = "topic_modeling"
    node_ids: list[uuid.UUID] = Field(min_length=1, max_length=2)
    node_columns: dict[uuid.UUID, NonEmptyText]
    min_cluster_size: int = Field(default=10, ge=2)
    random_seed: int = 0
    sample_fractions: list[float | None] | None = None
    segmentation_method: TopicSegmentationMethod = TopicSegmentationMethod.AUTOMATIC
    max_segment_tokens: int = Field(default=256, ge=32, le=510)

    @model_validator(mode="after")
    def validate_nodes_and_sampling(self) -> TopicModelingAnalysisRequest:
        _validate_node_columns(self.node_ids, self.node_columns)
        if self.sample_fractions is not None:
            if len(self.sample_fractions) != len(self.node_ids):
                raise ValueError("Sample fractions must align with Data Block IDs")
            if any(
                fraction is not None
                and (not math.isfinite(fraction) or not 0 < fraction <= 1)
                for fraction in self.sample_fractions
            ):
                raise ValueError("Sample fractions must be finite and in (0, 1]")
        return self


class ConcordanceAnalysisRequest(_StrictModel):
    kind: Literal["concordance"] = "concordance"
    node_ids: list[uuid.UUID] = Field(min_length=1, max_length=2)
    node_columns: dict[uuid.UUID, NonEmptyText]
    search_word: NonEmptyText
    num_left_tokens: int = Field(default=10, ge=0, le=1000)
    num_right_tokens: int = Field(default=10, ge=0, le=1000)
    regex: bool = False
    whole_word: bool = False
    case_sensitive: bool = False
    ignore_punctuation: bool = False
    search_mode: Literal["regex", "tokens"] = "regex"
    node_tokenizer_models: dict[uuid.UUID, NonEmptyText] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_nodes(self) -> ConcordanceAnalysisRequest:
        _validate_node_columns(self.node_ids, self.node_columns)
        tokenizer_ids = set(self.node_tokenizer_models)
        requested_ids = set(self.node_ids)
        if tokenizer_ids - requested_ids:
            raise ValueError("Tokenizer models may reference only requested inputs")
        if self.search_mode == "tokens" and tokenizer_ids != requested_ids:
            raise ValueError(
                "Tokens mode tokenizer models must exactly match requested inputs"
            )
        return self


class QuotationAnalysisRequest(_StrictModel):
    kind: Literal["quotation"] = "quotation"
    node_id: uuid.UUID
    column: NonEmptyText
    engine: QuotationEngineSelection


class SequentialAnalysisRequest(_StrictModel):
    kind: Literal["sequential"] = "sequential"
    node_id: uuid.UUID
    time_column: NonEmptyText
    group_by_columns: list[NonEmptyText] = Field(default_factory=list, max_length=3)
    frequency: Literal[
        "second",
        "minute",
        "hourly",
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
        "custom",
    ] = "monthly"
    sort_by_time: bool = True
    column_type: Literal["datetime", "numeric"] = "datetime"
    numeric_origin: float | None = Field(default=None, allow_inf_nan=False)
    numeric_interval: float | None = Field(default=None, allow_inf_nan=False)
    custom_interval_value: int | None = Field(default=None, ge=1)
    custom_interval_unit: (
        Literal["seconds", "minutes", "hours", "days", "weeks"] | None
    ) = None

    @model_validator(mode="after")
    def validate_interval(self) -> SequentialAnalysisRequest:
        if self.column_type == "numeric" and (
            self.numeric_interval is None or self.numeric_interval <= 0
        ):
            raise ValueError("Numeric input requires a positive numeric_interval")
        if (
            self.column_type == "datetime"
            and self.frequency == "custom"
            and (
                self.custom_interval_value is None or self.custom_interval_unit is None
            )
        ):
            raise ValueError("Custom datetime frequency requires a value and unit")
        return self


class _AnnotationInferenceFields(AnnotationProviderSnapshot):
    kind: Literal["annotation"] = "annotation"
    node_id: uuid.UUID
    text_column: NonEmptyText = Field(max_length=500)
    annotation_column: NonEmptyText = Field(max_length=500)
    correction_column: NonEmptyText | None = Field(default=None, max_length=500)
    class_node_id: uuid.UUID
    class_column: NonEmptyText = Field(max_length=500)
    description_column: NonEmptyText = Field(max_length=500)
    example_node_id: uuid.UUID | None = None
    example_text_column: NonEmptyText | None = Field(default=None, max_length=500)
    example_annotation_column: NonEmptyText | None = Field(default=None, max_length=500)
    max_examples_per_class: int = Field(default=10, ge=1)
    example_sampling_method: AnnotationExampleSamplingMethod = "random"
    example_random_seed: int = Field(default=0, ge=0)
    classes: list[AnnotationClass] = Field(min_length=1, max_length=200)
    model: NonEmptyText = Field(max_length=500)
    instruction: NonEmptyText = Field(max_length=20_000)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0, allow_inf_nan=False)
    max_retries_per_batch: int = Field(default=2, ge=0, le=10)
    reasoning_enabled: bool = False
    reasoning_effort: Literal["low", "medium", "high"] = "medium"

    @model_validator(mode="after")
    def validate_annotation_fields(self) -> _AnnotationInferenceFields:
        normalized = [item.name.casefold() for item in self.classes]
        if len(normalized) != len(set(normalized)):
            raise ValueError("Annotation class names must be unique")
        if self.correction_column in {self.text_column, self.annotation_column}:
            raise ValueError(
                "Annotation correction column must differ from text and annotation columns"
            )
        example_fields = (
            self.example_node_id,
            self.example_text_column,
            self.example_annotation_column,
        )
        if any(value is not None for value in example_fields) and any(
            value is None for value in example_fields
        ):
            raise ValueError("Example Data Block fields must be provided together")
        return self


class AnnotationAnalysisRequest(_AnnotationInferenceFields):
    """Secret-free immutable Annotation request stored in a Workspace."""


class AnnotationAnalysisSubmission(_AnnotationInferenceFields):
    """Annotation creation command with an optional request-only credential."""

    api_key: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=4_000,
        json_schema_extra={"writeOnly": True},
    )

    def persisted_request(self) -> AnnotationAnalysisRequest:
        return AnnotationAnalysisRequest.model_validate(
            self.model_dump(exclude={"api_key"})
        )


PreviewAnalysisRequest = Annotated[
    TokenFrequencyAnalysisRequest
    | TopicModelingAnalysisRequest
    | ConcordanceAnalysisRequest
    | QuotationAnalysisRequest
    | SequentialAnalysisRequest
    | AnnotationAnalysisRequest,
    Field(discriminator="kind"),
]

PreviewAnalysisSubmission = Annotated[
    TokenFrequencyAnalysisRequest
    | TopicModelingAnalysisRequest
    | ConcordanceAnalysisRequest
    | QuotationAnalysisRequest
    | SequentialAnalysisRequest
    | AnnotationAnalysisSubmission,
    Field(discriminator="kind"),
]


class ConcordanceRunAllAnalysisRequest(_StrictModel):
    kind: Literal["concordance_run_all"] = "concordance_run_all"
    source: ConcordanceAnalysisRequest


class QuotationRunAllAnalysisRequest(_StrictModel):
    kind: Literal["quotation_run_all"] = "quotation_run_all"
    source: QuotationAnalysisRequest


class DataBlockCreationSource(_StrictModel):
    """One immutable selection for publishing a successful Analysis Result."""

    source_node_id: uuid.UUID
    selected_columns: list[NonEmptyText] = Field(min_length=1)
    new_node_name: NonEmptyText = Field(max_length=500)

    @model_validator(mode="after")
    def validate_columns(self) -> DataBlockCreationSource:
        if len(self.selected_columns) != len(set(self.selected_columns)):
            raise ValueError("Data Block Creation columns must be unique")
        return self


class SequentialDataBlockCreationSource(DataBlockCreationSource):
    """One immutable Trends filter and source-column selection."""

    selected_period_indices: list[int] | None = Field(default=None, min_length=1)
    excluded_group_indices: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_filter(self) -> SequentialDataBlockCreationSource:
        if self.selected_period_indices is not None:
            if len(self.selected_period_indices) != len(
                set(self.selected_period_indices)
            ):
                raise ValueError("Selected Trends periods must be unique")
            if any(index < 0 for index in self.selected_period_indices):
                raise ValueError("Selected Trends period is out of range")
        if len(self.excluded_group_indices) != len(set(self.excluded_group_indices)):
            raise ValueError("Excluded Trends groups must be unique")
        if any(index < 0 for index in self.excluded_group_indices):
            raise ValueError("Excluded Trends group is out of range")
        return self


class ConcordanceDocumentDataBlockCreationSource(_StrictModel):
    """One source and exact Review filter for document-wise Data Block Creation."""

    source_node_id: uuid.UUID
    selected_metadata_columns: list[NonEmptyText] = Field(default_factory=list)
    new_node_name: NonEmptyText = Field(max_length=500)
    excluded_matched_texts: list[NonEmptyText] = Field(default_factory=list)
    bin_count: Literal[4, 5, 10, 20, 25, 50, 100] | None = None
    selected_bins: list[int] | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_filter(self) -> ConcordanceDocumentDataBlockCreationSource:
        if len(self.selected_metadata_columns) != len(
            set(self.selected_metadata_columns)
        ):
            raise ValueError(
                "Document Data Block Creation metadata columns must be unique"
            )
        if len(self.excluded_matched_texts) != len(set(self.excluded_matched_texts)):
            raise ValueError("Excluded Concordance terms must be unique")
        if (self.bin_count is None) != (self.selected_bins is None):
            raise ValueError("Selected bins and bin count must be provided together")
        if self.selected_bins is not None:
            if len(self.selected_bins) != len(set(self.selected_bins)):
                raise ValueError("Selected Concordance bins must be unique")
            assert self.bin_count is not None
            if any(
                index < 0 or index >= self.bin_count for index in self.selected_bins
            ):
                raise ValueError("Selected Concordance bin is out of range")
        return self


class ConcordanceMatchDataBlockCreationAnalysisRequest(_StrictModel):
    kind: Literal["concordance_match_data_block_creation"] = (
        "concordance_match_data_block_creation"
    )
    sources: list[DataBlockCreationSource] = Field(min_length=1, max_length=2)

    @model_validator(mode="after")
    def validate_sources(self) -> ConcordanceMatchDataBlockCreationAnalysisRequest:
        source_ids = [source.source_node_id for source in self.sources]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("Data Block Creation source IDs must be unique")
        return self


class ConcordanceDocumentDataBlockCreationAnalysisRequest(_StrictModel):
    kind: Literal["concordance_document_data_block_creation"] = (
        "concordance_document_data_block_creation"
    )
    sources: list[ConcordanceDocumentDataBlockCreationSource] = Field(
        min_length=1, max_length=2
    )

    @model_validator(mode="after")
    def validate_sources(self) -> ConcordanceDocumentDataBlockCreationAnalysisRequest:
        source_ids = [source.source_node_id for source in self.sources]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("Document Data Block Creation source IDs must be unique")
        return self


class QuotationResultDataBlockCreationAnalysisRequest(_StrictModel):
    kind: Literal["quotation_result_data_block_creation"] = (
        "quotation_result_data_block_creation"
    )
    source: DataBlockCreationSource


class SequentialDataBlockCreationAnalysisRequest(_StrictModel):
    kind: Literal["sequential_data_block_creation"] = "sequential_data_block_creation"
    source: SequentialDataBlockCreationSource


class AnnotationRunAllAnalysisRequest(_StrictModel):
    kind: Literal["annotation_run_all"] = "annotation_run_all"
    source: AnnotationAnalysisRequest
    batch_size: int = Field(default=20, ge=1, le=100)
    processing_mode: Literal["reprocess_all", "fill_missing"] = "reprocess_all"


class AnnotationRunAllSubmission(_StrictModel):
    kind: Literal["annotation_run_all"] = "annotation_run_all"
    source: AnnotationAnalysisRequest
    batch_size: int = Field(default=20, ge=1, le=100)
    processing_mode: Literal["reprocess_all", "fill_missing"] = "reprocess_all"
    api_key: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=4_000,
        json_schema_extra={"writeOnly": True},
    )

    def persisted_request(self) -> AnnotationRunAllAnalysisRequest:
        return AnnotationRunAllAnalysisRequest(
            source=self.source,
            batch_size=self.batch_size,
            processing_mode=self.processing_mode,
        )


class TopicMeaningOverride(_StrictModel):
    topic_id: int
    words: list[NonEmptyText]


class TopicModelingDataBlockCreationAnalysisRequest(_StrictModel):
    kind: Literal["topic_modeling_data_block_creation"] = (
        "topic_modeling_data_block_creation"
    )
    node_ids: list[uuid.UUID] = Field(min_length=1, max_length=2)
    selected_columns: dict[uuid.UUID, list[NonEmptyText]]
    new_node_names: dict[uuid.UUID, NonEmptyText]
    topic_ids: list[int] | None = None
    cluster_count: int = Field(ge=0)
    top_n_topics: int = Field(ge=0)
    topic_meanings_override: list[TopicMeaningOverride] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_sources_and_topics(
        self,
    ) -> TopicModelingDataBlockCreationAnalysisRequest:
        if len(self.node_ids) != len(set(self.node_ids)):
            raise ValueError(
                "Topic Modeling Data Block Creation Data Block IDs must be unique"
            )
        expected = set(self.node_ids)
        if (
            set(self.selected_columns) != expected
            or set(self.new_node_names) != expected
        ):
            raise ValueError(
                "Topic Modeling Data Block Creation source fields must align"
            )
        if any(len(name) > 475 for name in self.new_node_names.values()):
            raise ValueError(
                "Topic Modeling Data Block Creation Data Block names are too long"
            )
        if self.topic_ids is not None and len(self.topic_ids) != len(
            set(self.topic_ids)
        ):
            raise ValueError("Selected Topic IDs must be unique")
        if self.topic_ids is not None and any(
            topic_id < 0 or topic_id >= self.cluster_count
            for topic_id in self.topic_ids
        ):
            raise ValueError("Selected Topic IDs must fit the selected cluster count")
        minimum_top_n = 0 if self.cluster_count == 0 else 1
        if not minimum_top_n <= self.top_n_topics <= self.cluster_count:
            raise ValueError("Top topics per row must fit the selected cluster count")
        override_ids = [item.topic_id for item in self.topic_meanings_override]
        if len(override_ids) != len(set(override_ids)):
            raise ValueError("Topic meaning overrides must be unique")
        if any(
            topic_id < 0 or topic_id >= self.cluster_count for topic_id in override_ids
        ):
            raise ValueError(
                "Topic meaning overrides must fit the selected cluster count"
            )
        return self


SupportingAnalysisRequest = Annotated[
    ConcordanceRunAllAnalysisRequest
    | QuotationRunAllAnalysisRequest
    | ConcordanceMatchDataBlockCreationAnalysisRequest
    | ConcordanceDocumentDataBlockCreationAnalysisRequest
    | QuotationResultDataBlockCreationAnalysisRequest
    | SequentialDataBlockCreationAnalysisRequest
    | AnnotationRunAllAnalysisRequest
    | TopicModelingDataBlockCreationAnalysisRequest,
    Field(discriminator="kind"),
]

AnalysisRequest = PreviewAnalysisRequest | SupportingAnalysisRequest

AnalysisSubmission = Annotated[
    TokenFrequencyAnalysisRequest
    | TopicModelingAnalysisRequest
    | ConcordanceAnalysisRequest
    | QuotationAnalysisRequest
    | SequentialAnalysisRequest
    | AnnotationAnalysisSubmission
    | ConcordanceRunAllAnalysisRequest
    | QuotationRunAllAnalysisRequest
    | ConcordanceMatchDataBlockCreationAnalysisRequest
    | ConcordanceDocumentDataBlockCreationAnalysisRequest
    | QuotationResultDataBlockCreationAnalysisRequest
    | SequentialDataBlockCreationAnalysisRequest
    | AnnotationRunAllSubmission
    | TopicModelingDataBlockCreationAnalysisRequest,
    Field(discriminator="kind"),
]

SupportingAnalysisSubmission = Annotated[
    ConcordanceRunAllAnalysisRequest
    | QuotationRunAllAnalysisRequest
    | ConcordanceMatchDataBlockCreationAnalysisRequest
    | ConcordanceDocumentDataBlockCreationAnalysisRequest
    | QuotationResultDataBlockCreationAnalysisRequest
    | SequentialDataBlockCreationAnalysisRequest
    | AnnotationRunAllSubmission
    | TopicModelingDataBlockCreationAnalysisRequest,
    Field(discriminator="kind"),
]


def persisted_submission(submission: AnalysisSubmission) -> AnalysisRequest:
    if isinstance(submission, AnnotationAnalysisSubmission):
        return submission.persisted_request()
    if isinstance(submission, AnnotationRunAllSubmission):
        return submission.persisted_request()
    return submission


def analysis_input_ids(request: AnalysisRequest) -> tuple[uuid.UUID, ...]:
    if isinstance(
        request,
        (
            ConcordanceRunAllAnalysisRequest,
            QuotationRunAllAnalysisRequest,
            AnnotationRunAllAnalysisRequest,
        ),
    ):
        return analysis_input_ids(request.source)
    if isinstance(
        request,
        (
            ConcordanceMatchDataBlockCreationAnalysisRequest,
            ConcordanceDocumentDataBlockCreationAnalysisRequest,
        ),
    ):
        return tuple(source.source_node_id for source in request.sources)
    if isinstance(
        request,
        QuotationResultDataBlockCreationAnalysisRequest
        | SequentialDataBlockCreationAnalysisRequest,
    ):
        return (request.source.source_node_id,)
    if isinstance(
        request,
        (
            TokenFrequencyAnalysisRequest,
            TopicModelingAnalysisRequest,
            ConcordanceAnalysisRequest,
            TopicModelingDataBlockCreationAnalysisRequest,
        ),
    ):
        return tuple(request.node_ids)
    ids = [request.node_id]
    if isinstance(request, AnnotationAnalysisRequest):
        ids.append(request.class_node_id)
        if request.example_node_id is not None:
            ids.append(request.example_node_id)
    return tuple(dict.fromkeys(ids))


def analysis_snapshot_input_ids(request: AnalysisRequest) -> tuple[uuid.UUID, ...]:
    """Return only Data Blocks whose plans execution or result queries read."""

    if isinstance(request, AnnotationRunAllAnalysisRequest):
        return analysis_snapshot_input_ids(request.source)
    if isinstance(request, AnnotationAnalysisRequest):
        ids = [request.node_id]
        if request.example_node_id is not None:
            ids.append(request.example_node_id)
        return tuple(dict.fromkeys(ids))
    return analysis_input_ids(request)


class AnalysisArtifactRecord(_StrictModel):
    """Private portable identity for one Analysis-owned artifact."""

    name: NonEmptyText = Field(max_length=500)
    relative_path: NonEmptyText = Field(max_length=1000)
    media_type: str | None = Field(default=None, max_length=200)


class AnalysisQuerySnapshotRecord(_StrictModel):
    """Private portable identity for a retained Result query input."""

    relative_path: NonEmptyText = Field(max_length=1000)


class _AnalysisLifecycle(_StrictModel):
    id: uuid.UUID
    tab_id: uuid.UUID
    parent_analysis_id: uuid.UUID | None
    execution_scope: AnalysisExecutionScope
    supersedes_analysis_ids: list[uuid.UUID]
    request: AnalysisRequest
    state: AnalysisState
    progress: Progress
    cancellation_requested_at: AwareDatetime | None
    error: Failure | None
    created_at: AwareDatetime
    started_at: AwareDatetime | None
    finished_at: AwareDatetime | None
    revision: int = Field(ge=1)
    output_node_ids: list[uuid.UUID]

    @model_validator(mode="after")
    def validate_lifecycle(self) -> _AnalysisLifecycle:
        if self.parent_analysis_id == self.id:
            raise ValueError("An Analysis cannot parent itself")
        if self.id in self.supersedes_analysis_ids or len(
            self.supersedes_analysis_ids
        ) != len(set(self.supersedes_analysis_ids)):
            raise ValueError("Superseded Analysis IDs must be distinct")
        terminal = self.state in {
            AnalysisState.SUCCEEDED,
            AnalysisState.FAILED,
            AnalysisState.CANCELLED,
        }
        if terminal != (self.finished_at is not None):
            raise ValueError("Terminal Analysis state and finished_at must agree")
        if self.state is AnalysisState.QUEUED and self.started_at is not None:
            raise ValueError("Queued Analyses cannot have started_at")
        if self.state in {AnalysisState.RUNNING, AnalysisState.SUCCEEDED} and (
            self.started_at is None
        ):
            raise ValueError("Running and successful Analyses require started_at")
        if (self.state is AnalysisState.FAILED) != (self.error is not None):
            raise ValueError("Only failed Analyses contain a Failure")
        if self.state is AnalysisState.CANCELLED and (
            self.cancellation_requested_at is None
        ):
            raise ValueError("Cancelled Analyses require a cancellation request")
        if self.state is AnalysisState.SUCCEEDED and self.progress.fraction != 1.0:
            raise ValueError("Successful Analyses require complete Progress")
        if self.state is not AnalysisState.SUCCEEDED and self.progress.fraction == 1.0:
            raise ValueError("Only successful Analyses may persist complete Progress")
        if self.started_at is not None and self.started_at < self.created_at:
            raise ValueError("started_at cannot precede created_at")
        if (
            self.cancellation_requested_at is not None
            and self.cancellation_requested_at < self.created_at
        ):
            raise ValueError("cancellation_requested_at cannot precede created_at")
        if self.finished_at is not None:
            lower_bound = self.started_at or self.created_at
            if self.finished_at < lower_bound:
                raise ValueError("finished_at precedes the Analysis lifecycle")
        return self


class AnalysisRecord(_AnalysisLifecycle):
    """Strict internal record persisted beneath its owning Workspace."""

    result_payload: dict[str, JsonData] | None = None
    artifact_references: list[AnalysisArtifactRecord] = Field(default_factory=list)
    query_snapshot: AnalysisQuerySnapshotRecord | None = None

    @model_validator(mode="after")
    def validate_result(self) -> AnalysisRecord:
        succeeded = self.state is AnalysisState.SUCCEEDED
        if succeeded != (self.result_payload is not None):
            raise ValueError("Only a successful Analysis has a Result")
        if not succeeded and self.artifact_references:
            raise ValueError("Only a successful Analysis owns published Artifacts")
        if not succeeded and self.query_snapshot is not None:
            raise ValueError("Only a successful Analysis owns a query snapshot")
        if self.query_snapshot is not None:
            expected = f"analyses/{self.id}/query-input"
            if self.request.kind not in {"annotation", "concordance", "quotation"}:
                raise ValueError("Analysis kind does not support a query snapshot")
            if self.query_snapshot.relative_path != expected:
                raise ValueError("Analysis query snapshot path is invalid")
        names = [artifact.name for artifact in self.artifact_references]
        paths = [artifact.relative_path for artifact in self.artifact_references]
        if len(names) != len(set(names)) or len(paths) != len(set(paths)):
            raise ValueError("Analysis Artifact references must be unique")
        if len(self.output_node_ids) != len(set(self.output_node_ids)):
            raise ValueError("Analysis output Data Block IDs must be unique")
        if not succeeded and self.output_node_ids:
            raise ValueError("Only a successful Analysis may publish Data Blocks")
        return self

    def _transition(self, **changes: object) -> AnalysisRecord:
        payload = self.model_dump()
        payload.update(changes)
        payload["revision"] = self.revision + 1
        return AnalysisRecord.model_validate(payload)

    def start(self, timestamp: datetime) -> AnalysisRecord:
        if self.state is not AnalysisState.QUEUED:
            raise ValueError("Only a queued Analysis can start")
        return self._transition(
            state=AnalysisState.RUNNING,
            started_at=timestamp,
        )

    def cancel_queued(self, timestamp: datetime) -> AnalysisRecord:
        if self.state is not AnalysisState.QUEUED:
            raise ValueError("Only a queued Analysis can be cancelled immediately")
        return self._transition(
            state=AnalysisState.CANCELLED,
            cancellation_requested_at=timestamp,
            finished_at=timestamp,
        )

    def request_running_cancellation(self, timestamp: datetime) -> AnalysisRecord:
        if self.state is not AnalysisState.RUNNING:
            raise ValueError("Only a running Analysis can request cancellation")
        if self.cancellation_requested_at is not None:
            return self
        return self._transition(cancellation_requested_at=timestamp)

    def confirm_cancelled(
        self,
        timestamp: datetime,
        *,
        progress: Progress,
    ) -> AnalysisRecord:
        if (
            self.state is not AnalysisState.RUNNING
            or self.cancellation_requested_at is None
        ):
            raise ValueError("Cancellation confirmation requires a pending request")
        return self._transition(
            state=AnalysisState.CANCELLED,
            progress=progress,
            finished_at=timestamp,
        )

    def fail(
        self,
        timestamp: datetime,
        *,
        failure: Failure,
        progress: Progress,
    ) -> AnalysisRecord:
        if self.state not in {AnalysisState.QUEUED, AnalysisState.RUNNING}:
            raise ValueError("Only a non-terminal Analysis can fail")
        return self._transition(
            state=AnalysisState.FAILED,
            progress=progress,
            error=failure,
            finished_at=timestamp,
        )

    def succeed(
        self,
        timestamp: datetime,
        *,
        result_payload: dict[str, JsonData],
        artifact_references: list[AnalysisArtifactRecord] | None = None,
        output_node_ids: list[uuid.UUID] | None = None,
        query_snapshot: AnalysisQuerySnapshotRecord | None = None,
    ) -> AnalysisRecord:
        if self.state is not AnalysisState.RUNNING:
            raise ValueError("Only a running Analysis can succeed")
        return self._transition(
            state=AnalysisState.SUCCEEDED,
            progress=Progress(fraction=1.0, message="Complete"),
            result_payload=result_payload,
            artifact_references=artifact_references or [],
            output_node_ids=output_node_ids or [],
            query_snapshot=query_snapshot,
            finished_at=timestamp,
        )

    @classmethod
    def create(
        cls,
        request: AnalysisRequest,
        *,
        tab_id: uuid.UUID,
        execution_scope: AnalysisExecutionScope,
        timestamp: datetime,
        parent_analysis_id: uuid.UUID | None = None,
        supersedes_analysis_ids: list[uuid.UUID] | None = None,
        analysis_id: uuid.UUID | None = None,
    ) -> AnalysisRecord:
        return cls(
            id=analysis_id or uuid.uuid4(),
            tab_id=tab_id,
            parent_analysis_id=parent_analysis_id,
            execution_scope=execution_scope,
            supersedes_analysis_ids=supersedes_analysis_ids or [],
            request=request,
            state=AnalysisState.QUEUED,
            progress=Progress(fraction=0.0, message="Queued"),
            cancellation_requested_at=None,
            error=None,
            created_at=timestamp,
            started_at=None,
            finished_at=None,
            revision=1,
            result_payload=None,
            artifact_references=[],
            query_snapshot=None,
            output_node_ids=[],
        )


class Analysis(_AnalysisLifecycle):
    """Exact valid public Analysis representation."""

    availability: Literal["available"]
    integrity: AnalysisIntegrity


class UnavailableAnalysis(_StrictModel):
    """Minimal safe item for an invalid persisted Analysis record."""

    availability: Literal["unavailable"]
    id: uuid.UUID
    tab_id: uuid.UUID
    reason: Literal["record_invalid"]
    warning: Literal[
        "This Analysis is unavailable because its stored record is invalid."
    ]


type AnalysisResource = Annotated[
    Analysis | UnavailableAnalysis,
    Field(discriminator="availability"),
]


def public_analysis(
    record: AnalysisRecord,
    *,
    integrity: AnalysisIntegrity,
    progress: Progress | None = None,
) -> Analysis:
    payload = record.model_dump(
        exclude={
            "result_payload",
            "artifact_references",
            "query_snapshot",
        }
    )
    payload["progress"] = progress or record.progress
    payload["integrity"] = integrity
    payload["availability"] = "available"
    return Analysis.model_validate(payload)


__all__ = [
    "Analysis",
    "AnalysisArtifactRecord",
    "AnalysisQuerySnapshotRecord",
    "AnalysisIntegrity",
    "AnalysisExecutionScope",
    "AnalysisRecord",
    "AnalysisRequest",
    "AnalysisState",
    "AnalysisSubmission",
    "AnnotationAnalysisRequest",
    "AnnotationAnalysisSubmission",
    "AnnotationRunAllAnalysisRequest",
    "AnnotationRunAllSubmission",
    "ConcordanceAnalysisRequest",
    "ConcordanceDocumentDataBlockCreationAnalysisRequest",
    "ConcordanceDocumentDataBlockCreationSource",
    "ConcordanceMatchDataBlockCreationAnalysisRequest",
    "ConcordanceRunAllAnalysisRequest",
    "AnalysisResource",
    "Failure",
    "InvalidAnalysisIntegrity",
    "LocalQuotationEngineSelection",
    "Progress",
    "QuotationAnalysisRequest",
    "QuotationEngineSelection",
    "QuotationEngineType",
    "RemoteQuotationEngineSelection",
    "QuotationRunAllAnalysisRequest",
    "QuotationResultDataBlockCreationAnalysisRequest",
    "PreviewAnalysisRequest",
    "PreviewAnalysisSubmission",
    "SequentialAnalysisRequest",
    "SequentialDataBlockCreationAnalysisRequest",
    "SequentialDataBlockCreationSource",
    "DataBlockCreationSource",
    "TokenFrequencyAnalysisRequest",
    "TopicModelingAnalysisRequest",
    "TopicSegmentationMethod",
    "TopicModelingDataBlockCreationAnalysisRequest",
    "TopicMeaningOverride",
    "ValidAnalysisIntegrity",
    "UnavailableAnalysis",
    "analysis_input_ids",
    "analysis_snapshot_input_ids",
    "SupportingAnalysisRequest",
    "SupportingAnalysisSubmission",
    "persisted_submission",
    "public_analysis",
]
