"""Strict stored, query, and public Result models for Workspace Analyses."""

from __future__ import annotations

import uuid
from typing import Annotated, Generic, Literal, TypeVar, cast

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from ..domain.annotation import (
    ANNOTATION_PROVIDER_SAFE_MESSAGES,
    AnnotationProviderFailureCode,
)
from ..domain.workspace import NodeProvenance
from ..shared.json_data import JsonData
from .names import NodeName
from .tables import CompleteTableResource, ProjectedTableResource, PagedTableResource


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _PagedQuery(_StrictModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=500)
    sort_by: str | None = None
    descending: bool = False


class TopicModelingResultQuery(_PagedQuery):
    kind: Literal["topic_modeling"] = "topic_modeling"
    topic_ids: list[int] | None = None


class ConcordanceResultQuery(_PagedQuery):
    kind: Literal["concordance"] = "concordance"
    node_id: uuid.UUID | None = None


class ConcordanceDocumentProjectionQuery(_PagedQuery):
    """Filter and page document rows from an immutable Concordance Result."""

    excluded_matched_texts: list[str] = Field(default_factory=list)
    bin_count: Literal[4, 5, 10, 20, 25, 50, 100] | None = None
    selected_bins: list[int] | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_filter(self) -> "ConcordanceDocumentProjectionQuery":
        if any(not value for value in self.excluded_matched_texts) or len(
            self.excluded_matched_texts
        ) != len(set(self.excluded_matched_texts)):
            raise ValueError("Excluded Concordance terms must be non-empty and unique")
        if (self.bin_count is None) != (self.selected_bins is None):
            raise ValueError("Selected bins and bin count must be provided together")
        if self.selected_bins is not None:
            if len(self.selected_bins) != len(set(self.selected_bins)):
                raise ValueError("Selected Concordance bins must be unique")
            assert self.bin_count is not None
            if any(index < 0 or index >= self.bin_count for index in self.selected_bins):
                raise ValueError("Selected Concordance bin is out of range")
        return self


class QuotationResultQuery(_PagedQuery):
    kind: Literal["quotation"] = "quotation"


class AnnotationResultQuery(_StrictModel):
    kind: Literal["annotation"] = "annotation"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=10, ge=1, le=200)
    api_key: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=4_000,
        json_schema_extra={"writeOnly": True},
    )


AnalysisResultQuery = Annotated[
    TopicModelingResultQuery
    | ConcordanceResultQuery
    | QuotationResultQuery
    | AnnotationResultQuery,
    Field(discriminator="kind"),
]


class ArtifactResource(_StrictModel):
    name: str = Field(min_length=1, max_length=500)
    media_type: str | None = Field(default=None, max_length=200)
    url: str = Field(min_length=1)


class StoredArtifactIdentity(_StrictModel):
    name: str = Field(min_length=1, max_length=500)
    media_type: str | None = Field(default=None, max_length=200)


class ResultPagination(_StrictModel):
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_rows: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class SourcePagePagination(_StrictModel):
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_source_rows: int = Field(ge=0)
    total_source_pages: int = Field(ge=0)
    result_count: int = Field(ge=0)
    has_next: bool
    has_prev: bool


class ResultSorting(_StrictModel):
    sort_by: str | None = None
    descending: bool


class ResultColumnMetadata(_StrictModel):
    concordance_columns: list[str] = Field(default_factory=list)
    quotation_columns: list[str] = Field(default_factory=list)
    metadata_columns: list[str] = Field(default_factory=list)
    all_columns: list[str]


ArtifactValueT = TypeVar("ArtifactValueT")
PrivateArtifactPath = Annotated[str, Field(min_length=1)]


class CompleteTableIdentity(_StrictModel, Generic[ArtifactValueT]):
    table_id: str = Field(min_length=1, max_length=200)
    artifact: ArtifactValueT


class PagedTableIdentity(_StrictModel, Generic[ArtifactValueT]):
    table_id: str = Field(min_length=1, max_length=200)
    artifact: ArtifactValueT


class ProjectedTableIdentity(_StrictModel, Generic[ArtifactValueT]):
    table_id: str = Field(min_length=1, max_length=200)
    artifact: ArtifactValueT
    supports_density: bool


class ConcordanceDensitySeries(_StrictModel):
    label: str
    counts: list[int] = Field(min_length=100, max_length=100)


class ConcordanceDensityResult(_StrictModel):
    resolution: Literal[100] = 100
    document_count: int = Field(ge=0)
    match_count: int = Field(ge=0)
    series: list[ConcordanceDensitySeries]


class _TokenNodeTable(_StrictModel, Generic[ArtifactValueT]):
    node_id: uuid.UUID
    node_name: NodeName
    table: CompleteTableIdentity[ArtifactValueT]


class _TokenTables(_StrictModel, Generic[ArtifactValueT]):
    version: Literal[1]
    nodes: list[_TokenNodeTable[ArtifactValueT]]
    statistics: CompleteTableIdentity[ArtifactValueT] | None = None


class TokenResultMetadata(_StrictModel):
    effective_token_limit: int = Field(ge=1)
    server_token_limit: int = Field(ge=1)


class _TokenFrequencyBody(_StrictModel):
    metadata: TokenResultMetadata


class TokenFrequencyWorkerResult(_TokenFrequencyBody):
    state: Literal["successful"]
    message: str
    tables: _TokenTables[PrivateArtifactPath]


class TokenFrequencyStoredResult(_TokenFrequencyBody):
    tables: _TokenTables[StoredArtifactIdentity]


class _TokenNodeTableResource(_StrictModel):
    node_id: uuid.UUID
    node_name: NodeName
    table: CompleteTableResource


class _TokenTableResources(_StrictModel):
    version: Literal[1]
    nodes: list[_TokenNodeTableResource]
    statistics: CompleteTableResource | None = None


class TokenFrequencyResult(_TokenFrequencyBody):
    kind: Literal["token_frequency"] = "token_frequency"
    tables: _TokenTableResources


class RepresentativeWord(_StrictModel):
    word: str
    occurrence_count: int = Field(gt=0)


class TopicItem(_StrictModel):
    id: int
    representative_words: list[RepresentativeWord]
    size: list[int]
    total_size: int = Field(ge=0)
    x: float
    y: float


class _TopicNodeArtifact(_StrictModel, Generic[ArtifactValueT]):
    node_id: uuid.UUID
    node_name: NodeName
    text_column: str
    original_columns: list[str]
    assignments: PagedTableIdentity[ArtifactValueT]


class _TopicArtifacts(_StrictModel, Generic[ArtifactValueT]):
    version: Literal[1]
    topic_meanings_parquet_path: ArtifactValueT
    nodes: list[_TopicNodeArtifact[ArtifactValueT]]


class _TopicNodeArtifactResource(_StrictModel):
    node_id: uuid.UUID
    node_name: NodeName
    text_column: str
    original_columns: list[str]
    assignments: PagedTableResource


class _TopicArtifactsResource(_StrictModel):
    version: Literal[1]
    topic_meanings_parquet_path: ArtifactResource
    nodes: list[_TopicNodeArtifactResource]


class TopicStageTiming(_StrictModel):
    stage: str
    elapsed_ms: float = Field(ge=0)


class TopicMetadata(_StrictModel):
    embeddings_from_ctfidf: bool | None = None
    total_topics_incl_outlier: int | None = Field(default=None, ge=0)
    native: bool | None = None
    engine: str | None = None
    embedding_model: str | None = None
    embedding_backend: str | None = None
    min_topic_size: int | None = Field(default=None, ge=1)
    random_state: int | None = None
    vectorizer_model: str | None = None
    n_chunks: int | None = Field(default=None, ge=0)
    truncated_segment_count: int | None = Field(default=None, ge=0)
    corpus_sizes_before_sample: list[int] | None = None
    corpus_sizes_after_sample: list[int] | None = None
    stage_timings_ms: list[TopicStageTiming] | None = None
    node_names: list[str] = Field(default_factory=list)


class _TopicModelingBody(_StrictModel):
    topics: list[TopicItem]
    corpus_sizes: list[int]
    per_corpus_topic_counts: list[dict[int, int]] | None = None
    meta: TopicMetadata


class TopicModelingWorkerResult(_TopicModelingBody):
    artifacts: _TopicArtifacts[PrivateArtifactPath]


class TopicModelingStoredResult(_TopicModelingBody):
    artifacts: _TopicArtifacts[StoredArtifactIdentity]


class TopicModelingResult(_TopicModelingBody):
    kind: Literal["topic_modeling"] = "topic_modeling"
    artifacts: _TopicArtifactsResource
    pagination: ResultPagination
    query: TopicModelingResultQuery


class ConcordancePage(_StrictModel):
    data: list[list[dict[str, JsonData]]]
    columns: list[str]
    metadata: ResultColumnMetadata
    pagination: SourcePagePagination
    sorting: ResultSorting


class ConcordanceSourceResult(_StrictModel):
    node_id: uuid.UUID
    node_name: NodeName
    result: ConcordancePage


class PreviewReadyStoredResult(_StrictModel):
    ready: Literal[True] = True


class ConcordanceStoredResult(PreviewReadyStoredResult):
    pass


class ConcordanceResult(PreviewReadyStoredResult):
    kind: Literal["concordance"] = "concordance"
    sources: list[ConcordanceSourceResult] | None = Field(
        default=None, min_length=1, max_length=2
    )
    query: ConcordanceResultQuery | None = None


class QuotationStoredResult(PreviewReadyStoredResult):
    pass


class QuotationResult(PreviewReadyStoredResult):
    kind: Literal["quotation"] = "quotation"
    data: list[list[dict[str, JsonData]]] | None = None
    columns: list[str] | None = None
    metadata: ResultColumnMetadata | None = None
    pagination: SourcePagePagination | None = None
    sorting: ResultSorting | None = None
    query: QuotationResultQuery | None = None


class SequentialWorkerResult(_StrictModel):
    state: Literal["successful"]
    table: CompleteTableIdentity[PrivateArtifactPath]


class SequentialStoredResult(_StrictModel):
    table: CompleteTableIdentity[StoredArtifactIdentity]


class SequentialResult(SequentialStoredResult):
    kind: Literal["sequential"] = "sequential"
    table: CompleteTableResource


class PublishedDataBlockMetadata(_StrictModel):
    """Exact portable Data Block metadata accepted from a child process."""

    id: uuid.UUID
    name: NodeName
    provenance: NodeProvenance
    document: str | None = Field(default=None, max_length=500)
    color: str | None = Field(default=None, max_length=100)


class _PublishedDataBlockWorkerData(_StrictModel):
    data_block: PublishedDataBlockMetadata
    parquet_path: PrivateArtifactPath
    output_columns: list[str]
    record_count: int = Field(ge=0)


class PublishedDataBlockWorkerResult(_StrictModel):
    state: Literal["successful"]
    result: _PublishedDataBlockWorkerData
    message: str


class RunAllSourceDescriptor(_StrictModel):
    node_id: uuid.UUID
    node_name: NodeName
    color: str | None
    document_column: str = Field(min_length=1, max_length=500)
    metadata_columns: list[str]
    analysis_columns: list[str]
    internal_columns: list[str]
    document_count: int = Field(ge=0)
    match_count: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_columns(self) -> "RunAllSourceDescriptor":
        groups = (
            [self.document_column],
            self.metadata_columns,
            self.analysis_columns,
            self.internal_columns,
        )
        flattened = [column for group in groups for column in group]
        if len(flattened) != len(set(flattened)):
            raise ValueError("Run All Result column roles must be disjoint")
        return self


class RunAllSourceTable(RunAllSourceDescriptor, Generic[ArtifactValueT]):
    table: ProjectedTableIdentity[ArtifactValueT]


class ConcordanceRunAllWorkerResult(_StrictModel):
    state: Literal["successful"]
    result_type: Literal["source"] = "source"
    source: RunAllSourceTable[PrivateArtifactPath]
    message: str


class QuotationRunAllWorkerResult(_StrictModel):
    state: Literal["successful"]
    source: RunAllSourceTable[PrivateArtifactPath]
    message: str


class _AnnotationRunAllCounts(_StrictModel):
    record_count: int = Field(ge=0)
    attempted_count: int = Field(ge=0)
    failed_batch_count: int = Field(ge=0)
    failed_row_count: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_counts(self) -> "_AnnotationRunAllCounts":
        if self.attempted_count > self.record_count:
            raise ValueError("Annotation attempted count exceeds its row count")
        if self.failed_row_count > self.attempted_count:
            raise ValueError("Annotation failed row count exceeds its attempted count")
        if self.failed_batch_count > self.failed_row_count:
            raise ValueError("Annotation failed batch count exceeds its failed row count")
        return self


class AnnotationRunAllWorkerData(_AnnotationRunAllCounts):
    parquet_path: PrivateArtifactPath
    output_columns: list[str]


class AnnotationRunAllWorkerResult(_StrictModel):
    state: Literal["successful"]
    result: AnnotationRunAllWorkerData
    message: str


class AnalysisWorkerFailureData(_StrictModel):
    """Safe terminal failure returned privately by a child worker process."""

    code: AnnotationProviderFailureCode
    message: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_safe_message(self) -> "AnalysisWorkerFailureData":
        if self.message != ANNOTATION_PROVIDER_SAFE_MESSAGES[self.code]:
            raise ValueError("Worker failure message does not match its safe code")
        return self


class AnalysisWorkerFailure(_StrictModel):
    """Discriminated worker envelope consumed before artifact publication.

    Used by ``AnalysisExecutionRuntime`` when a worker can classify a failure
    more precisely than a process crash. It deliberately carries no provider
    payload, SDK details, or artifact declaration.
    """

    state: Literal["failed"]
    failure: AnalysisWorkerFailureData


class TopicModelingDataBlockCreationWorkerOutput(_StrictModel):
    source_node_id: uuid.UUID
    topic_data: _PublishedDataBlockWorkerData
    topic_meanings: _PublishedDataBlockWorkerData


class TopicModelingDataBlockCreationWorkerResult(_StrictModel):
    state: Literal["successful"]
    outputs: list[TopicModelingDataBlockCreationWorkerOutput] = Field(min_length=1)
    message: str

    @model_validator(mode="after")
    def validate_outputs(self) -> "TopicModelingDataBlockCreationWorkerResult":
        source_ids = [item.source_node_id for item in self.outputs]
        output_ids = [
            data.data_block.id
            for output in self.outputs
            for data in (output.topic_data, output.topic_meanings)
        ]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("Topic Modeling Data Block Creation sources must be unique")
        if len(output_ids) != len(set(output_ids)):
            raise ValueError("Topic Modeling output Data Block IDs must be unique")
        return self


class DataBlockCreationWorkerOutput(_StrictModel):
    source_node_id: uuid.UUID
    data: _PublishedDataBlockWorkerData


class DataBlockCreationWorkerResult(_StrictModel):
    state: Literal["successful"]
    outputs: list[DataBlockCreationWorkerOutput] = Field(min_length=1, max_length=2)
    message: str

    @model_validator(mode="after")
    def validate_outputs(self) -> "DataBlockCreationWorkerResult":
        source_ids = [item.source_node_id for item in self.outputs]
        output_ids = [item.data.data_block.id for item in self.outputs]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("Data Block Creation sources must be unique")
        if len(output_ids) != len(set(output_ids)):
            raise ValueError("Data Block Creation outputs must be unique")
        return self


class PublishedDataBlockStoredResult(_StrictModel):
    output_node_ids: list[uuid.UUID] = Field(min_length=1)
    output_columns: list[str]
    record_count: int = Field(ge=0)


class ConcordanceRunAllGroupSource(RunAllSourceDescriptor):
    analysis_id: uuid.UUID


class ConcordanceRunAllStoredResult(_StrictModel):
    result_type: Literal["source", "group"]
    source: RunAllSourceTable[StoredArtifactIdentity] | None = None
    sources: list[ConcordanceRunAllGroupSource] | None = None

    @model_validator(mode="after")
    def validate_shape(self) -> "ConcordanceRunAllStoredResult":
        if self.result_type == "source":
            if self.source is None or self.sources is not None:
                raise ValueError("A source Result requires exactly one source table")
        elif self.sources is None or self.source is not None:
            raise ValueError("A group Result requires ordered source descriptors")
        elif not self.sources:
            raise ValueError("A group Result requires at least one source")
        return self


class RunAllSourceTableResource(RunAllSourceDescriptor):
    table: ProjectedTableResource


class ConcordanceRunAllResult(_StrictModel):
    kind: Literal["concordance_run_all"] = "concordance_run_all"
    result_type: Literal["source", "group"]
    source: RunAllSourceTableResource | None = None
    sources: list[ConcordanceRunAllGroupSource] | None = None


class QuotationRunAllStoredResult(_StrictModel):
    source: RunAllSourceTable[StoredArtifactIdentity]


class QuotationRunAllResult(_StrictModel):
    kind: Literal["quotation_run_all"] = "quotation_run_all"
    source: RunAllSourceTableResource


class AnnotationStoredResult(PreviewReadyStoredResult):
    pass


class AnnotationResult(PreviewReadyStoredResult):
    kind: Literal["annotation"] = "annotation"
    node_id: uuid.UUID | None = None
    page: int | None = Field(default=None, ge=1)
    page_size: int | None = Field(default=None, ge=1)
    total_rows: int | None = Field(default=None, ge=0)
    rows: list[dict[str, JsonData]] | None = None
    labels: list["AnnotationPreviewLabel"] | None = None
    query: AnnotationResultQuery | None = None


class AnnotationPreviewLabel(_StrictModel):
    row_index: int = Field(ge=0)
    label: str | None


class AnnotationRunAllStoredResult(_AnnotationRunAllCounts):
    affected_node_id: uuid.UUID
    annotation_column: str = Field(min_length=1, max_length=500)
    committed_workspace_revision: int = Field(ge=1)
    annotated_count: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_annotated_count(self) -> "AnnotationRunAllStoredResult":
        if self.annotated_count > self.record_count:
            raise ValueError("Annotation annotated count exceeds its row count")
        return self


class AnnotationRunAllResult(AnnotationRunAllStoredResult):
    kind: Literal["annotation_run_all"] = "annotation_run_all"


class TopicModelingDataBlockCreationOutput(_StrictModel):
    source_node_id: uuid.UUID
    topic_data_node_id: uuid.UUID
    topic_meanings_node_id: uuid.UUID
    topic_data_columns: list[str]
    topic_data_record_count: int = Field(ge=0)
    topic_meanings_record_count: int = Field(ge=0)


class TopicModelingDataBlockCreationStoredResult(_StrictModel):
    output_node_ids: list[uuid.UUID] = Field(min_length=2)
    outputs: list[TopicModelingDataBlockCreationOutput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_output_identity(self) -> "TopicModelingDataBlockCreationStoredResult":
        expected = [
            node_id
            for output in self.outputs
            for node_id in (
                output.topic_data_node_id,
                output.topic_meanings_node_id,
            )
        ]
        if self.output_node_ids != expected:
            raise ValueError("Topic Modeling output order does not match its Results")
        if len(self.output_node_ids) != len(set(self.output_node_ids)):
            raise ValueError("Topic Modeling output Data Block IDs must be unique")
        return self


class TopicModelingDataBlockCreationResult(TopicModelingDataBlockCreationStoredResult):
    kind: Literal["topic_modeling_data_block_creation"] = "topic_modeling_data_block_creation"


class DataBlockCreationOutput(_StrictModel):
    source_node_id: uuid.UUID
    output_node_id: uuid.UUID
    output_columns: list[str]
    record_count: int = Field(ge=0)


class DataBlockCreationStoredResult(_StrictModel):
    output_node_ids: list[uuid.UUID] = Field(min_length=1, max_length=2)
    outputs: list[DataBlockCreationOutput] = Field(min_length=1, max_length=2)

    @model_validator(mode="after")
    def validate_output_identity(self) -> "DataBlockCreationStoredResult":
        expected = [output.output_node_id for output in self.outputs]
        if self.output_node_ids != expected:
            raise ValueError("Data Block Creation output order is invalid")
        return self


class ConcordanceMatchDataBlockCreationResult(DataBlockCreationStoredResult):
    kind: Literal["concordance_match_data_block_creation"] = "concordance_match_data_block_creation"


class ConcordanceDocumentDataBlockCreationResult(DataBlockCreationStoredResult):
    kind: Literal["concordance_document_data_block_creation"] = (
        "concordance_document_data_block_creation"
    )


class QuotationResultDataBlockCreationResult(DataBlockCreationStoredResult):
    kind: Literal["quotation_result_data_block_creation"] = "quotation_result_data_block_creation"


AnalysisResult = Annotated[
    TokenFrequencyResult
    | TopicModelingResult
    | ConcordanceResult
    | QuotationResult
    | SequentialResult
    | AnnotationResult
    | ConcordanceRunAllResult
    | QuotationRunAllResult
    | AnnotationRunAllResult
    | TopicModelingDataBlockCreationResult
    | ConcordanceMatchDataBlockCreationResult
    | ConcordanceDocumentDataBlockCreationResult
    | QuotationResultDataBlockCreationResult,
    Field(discriminator="kind"),
]

ANALYSIS_WORKER_RESULT_MODELS: dict[str, type[BaseModel]] = {
    "token_frequency": TokenFrequencyWorkerResult,
    "topic_modeling": TopicModelingWorkerResult,
    "concordance": PreviewReadyStoredResult,
    "quotation": PreviewReadyStoredResult,
    "sequential": SequentialWorkerResult,
    "annotation": PreviewReadyStoredResult,
    "annotation_run_all": AnnotationRunAllWorkerResult,
    "concordance_run_all": ConcordanceRunAllWorkerResult,
    "quotation_run_all": QuotationRunAllWorkerResult,
    "topic_modeling_data_block_creation": TopicModelingDataBlockCreationWorkerResult,
    "concordance_match_data_block_creation": DataBlockCreationWorkerResult,
    "concordance_document_data_block_creation": DataBlockCreationWorkerResult,
    "quotation_result_data_block_creation": DataBlockCreationWorkerResult,
}

ANALYSIS_STORED_RESULT_MODELS: dict[str, type[BaseModel]] = {
    "token_frequency": TokenFrequencyStoredResult,
    "topic_modeling": TopicModelingStoredResult,
    "concordance": ConcordanceStoredResult,
    "quotation": QuotationStoredResult,
    "sequential": SequentialStoredResult,
    "annotation": AnnotationStoredResult,
    "annotation_run_all": AnnotationRunAllStoredResult,
    "concordance_run_all": ConcordanceRunAllStoredResult,
    "quotation_run_all": QuotationRunAllStoredResult,
    "topic_modeling_data_block_creation": TopicModelingDataBlockCreationStoredResult,
    "concordance_match_data_block_creation": DataBlockCreationStoredResult,
    "concordance_document_data_block_creation": DataBlockCreationStoredResult,
    "quotation_result_data_block_creation": DataBlockCreationStoredResult,
}


def stored_result_payload(kind: str, result: BaseModel) -> dict[str, JsonData]:
    """Remove execution-only status fields before persistence."""

    excluded = {
        "token_frequency": {"state", "message"},
        "concordance": {"state", "message"},
        "sequential": {"state"},
        "concordance_run_all": {"state", "message"},
        "quotation_run_all": {"state", "message"},
    }.get(kind, set())
    return cast(
        dict[str, JsonData],
        result.model_dump(mode="json", exclude=excluded),
    )


__all__ = [
    "ANALYSIS_STORED_RESULT_MODELS",
    "ANALYSIS_WORKER_RESULT_MODELS",
    "AnalysisWorkerFailure",
    "AnalysisResult",
    "AnalysisResultQuery",
    "AnnotationResultQuery",
    "AnnotationResult",
    "AnnotationStoredResult",
    "AnnotationRunAllResult",
    "AnnotationRunAllStoredResult",
    "AnnotationRunAllWorkerResult",
    "ArtifactResource",
    "ConcordanceResult",
    "ConcordanceResultQuery",
    "ConcordanceDocumentProjectionQuery",
    "ConcordanceDocumentDataBlockCreationResult",
    "ConcordanceMatchDataBlockCreationResult",
    "ConcordanceStoredResult",
    "CompleteTableIdentity",
    "ConcordanceRunAllResult",
    "ConcordanceRunAllStoredResult",
    "ConcordanceRunAllWorkerResult",
    "PublishedDataBlockMetadata",
    "PublishedDataBlockStoredResult",
    "PublishedDataBlockWorkerResult",
    "DataBlockCreationStoredResult",
    "DataBlockCreationOutput",
    "DataBlockCreationWorkerResult",
    "PrivateArtifactPath",
    "ProjectedTableIdentity",
    "ConcordanceDensityResult",
    "QuotationResult",
    "QuotationResultQuery",
    "QuotationStoredResult",
    "QuotationRunAllResult",
    "QuotationRunAllStoredResult",
    "QuotationRunAllWorkerResult",
    "RunAllSourceDescriptor",
    "RunAllSourceTable",
    "PreviewReadyStoredResult",
    "ResultPagination",
    "SequentialResult",
    "SequentialStoredResult",
    "SequentialWorkerResult",
    "StoredArtifactIdentity",
    "TokenFrequencyResult",
    "TokenFrequencyStoredResult",
    "TokenFrequencyWorkerResult",
    "TopicModelingResult",
    "TopicModelingResultQuery",
    "TopicModelingStoredResult",
    "TopicModelingWorkerResult",
    "TopicModelingDataBlockCreationResult",
    "TopicModelingDataBlockCreationStoredResult",
    "TopicModelingDataBlockCreationWorkerResult",
    "stored_result_payload",
]
