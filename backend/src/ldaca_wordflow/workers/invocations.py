"""Frozen picklable inputs for every Analysis worker kind."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal
import uuid

from ..analysis.topic_projection import TopicNodeInfo

if TYPE_CHECKING:
    from ..models.quotation import ResolvedQuotationEngine


@dataclass(frozen=True, slots=True)
class PreviewReadyInput:
    kind: Literal["preview_ready"] = field(default="preview_ready", init=False)


@dataclass(frozen=True, slots=True)
class TokenFrequencyInput:
    node_ids: list[uuid.UUID]
    node_columns: dict[uuid.UUID, str]
    artifact_dir: str
    scratch_dir: str
    input_snapshot_dir: str
    token_limit: int
    node_tokenizer_models: dict[uuid.UUID, str]
    token_cache_path: str
    kind: Literal["token_frequency"] = field(default="token_frequency", init=False)


@dataclass(frozen=True, slots=True)
class TopicModelingInput:
    node_infos: list[TopicNodeInfo]
    artifact_dir: str
    input_snapshot_dir: str
    embedding_cache_path: str
    min_cluster_size: int
    random_seed: int
    segmentation_method: str
    max_segment_tokens: int
    sample_fractions: list[float | None] | None
    kind: Literal["topic_modeling"] = field(default="topic_modeling", init=False)


@dataclass(frozen=True, slots=True)
class SequentialInput:
    input_snapshot_dir: str
    node_id: uuid.UUID
    artifact_dir: str
    request_payload: dict[str, Any]
    kind: Literal["sequential"] = field(default="sequential", init=False)


@dataclass(frozen=True, slots=True)
class TopicDataBlockCreationInput:
    input_snapshot_dir: str
    output_dir: str
    request_payload: dict[str, Any]
    clustering_context_path: str
    source_projection: dict[uuid.UUID, dict[str, Any]]
    kind: Literal["topic_data_block_creation"] = field(
        default="topic_data_block_creation",
        init=False,
    )


@dataclass(frozen=True, slots=True)
class ResultDataBlockCreationInput:
    artifact_dir: str
    request_payload: dict[str, Any]
    result_paths: dict[uuid.UUID, str]
    document_columns: dict[uuid.UUID, str | None]
    kind: Literal["result_data_block_creation"] = field(
        default="result_data_block_creation",
        init=False,
    )


@dataclass(frozen=True, slots=True)
class ConcordanceRunAllInput:
    artifact_dir: str
    input_snapshot_dir: str
    parent_node_id: uuid.UUID
    document_column: str
    search_word: str
    num_left_tokens: int
    num_right_tokens: int
    regex: bool
    whole_word: bool
    case_sensitive: bool
    ignore_punctuation: bool
    search_mode: str
    tokenizer_model: str | None
    token_cache_path: str
    kind: Literal["concordance_run_all"] = field(
        default="concordance_run_all",
        init=False,
    )


@dataclass(frozen=True, slots=True)
class QuotationRunAllInput:
    artifact_dir: str
    input_snapshot_dir: str
    parent_node_id: uuid.UUID
    document_column: str
    engine: ResolvedQuotationEngine
    quotation_service_max_batch_size: int
    quotation_service_timeout: float
    kind: Literal["quotation_run_all"] = field(
        default="quotation_run_all",
        init=False,
    )


@dataclass(frozen=True, slots=True)
class AnnotationInput:
    input_snapshot_dir: str
    output_dir: str
    request_payload: dict[str, Any]
    api_key: str | None
    kind: Literal["annotation"] = field(default="annotation", init=False)


@dataclass(frozen=True, slots=True)
class DataPortalImportInput:
    identifier: str
    requested_name: str | None
    api_base_url: str
    api_token: str | None
    timeout: float
    download_concurrency: int
    staging_dir: str
    max_output_bytes: int
    kind: Literal["data_portal_import"] = field(
        default="data_portal_import",
        init=False,
    )


type AnalysisWorkerInput = (
    PreviewReadyInput
    | TokenFrequencyInput
    | TopicModelingInput
    | SequentialInput
    | TopicDataBlockCreationInput
    | ResultDataBlockCreationInput
    | ConcordanceRunAllInput
    | QuotationRunAllInput
    | AnnotationInput
)


__all__ = [
    "AnalysisWorkerInput",
    "AnnotationInput",
    "ConcordanceRunAllInput",
    "DataPortalImportInput",
    "PreviewReadyInput",
    "QuotationRunAllInput",
    "ResultDataBlockCreationInput",
    "SequentialInput",
    "TokenFrequencyInput",
    "TopicDataBlockCreationInput",
    "TopicModelingInput",
    "TopicNodeInfo",
]
