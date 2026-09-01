"""Focused worker-input preparation for each Analysis request family."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import cast
import uuid

from ..analysis.token_cache import tokens_cache_path
from ..domain.workspace import (
    AnalysisRecord,
    AnnotationAnalysisRequest,
    AnnotationRunAllAnalysisRequest,
    ConcordanceAnalysisRequest,
    ConcordanceDocumentDataBlockCreationAnalysisRequest,
    ConcordanceDocumentDataBlockCreationSource,
    ConcordanceMatchDataBlockCreationAnalysisRequest,
    ConcordanceRunAllAnalysisRequest,
    QuotationAnalysisRequest,
    QuotationResultDataBlockCreationAnalysisRequest,
    QuotationRunAllAnalysisRequest,
    SequentialAnalysisRequest,
    SequentialDataBlockCreationAnalysisRequest,
    TokenFrequencyAnalysisRequest,
    TopicModelingAnalysisRequest,
    TopicModelingDataBlockCreationAnalysisRequest,
    Workspace,
)
from ..infrastructure.providers.quotation_engines import resolve_quotation_engine
from ..infrastructure.storage.embedding_cache import embeddings_cache_path
from ..models.analysis_results import (
    ConcordanceRunAllStoredResult,
    QuotationRunAllStoredResult,
    RunAllSourceDescriptor,
    SequentialStoredResult,
    TopicModelingStoredResult,
)
from ..settings import Settings
from ..shared.errors import InvalidInputError
from ..workers.invocations import (
    AnalysisWorkerInput,
    AnnotationInput,
    ConcordanceRunAllInput,
    PreviewReadyInput,
    QuotationRunAllInput,
    ResultDataBlockCreationInput,
    SequentialInput,
    TokenFrequencyInput,
    TopicDataBlockCreationInput,
    TopicModelingInput,
    TopicNodeInfo,
)

type PreviewRequest = (
    AnnotationAnalysisRequest | ConcordanceAnalysisRequest | QuotationAnalysisRequest
)
type ResultDataBlockCreationRequest = (
    ConcordanceMatchDataBlockCreationAnalysisRequest
    | ConcordanceDocumentDataBlockCreationAnalysisRequest
    | QuotationResultDataBlockCreationAnalysisRequest
    | SequentialDataBlockCreationAnalysisRequest
)


@dataclass(frozen=True, slots=True)
class AnalysisPreparationContext:
    """Immutable paths and authorities shared by focused preparation functions."""

    record: AnalysisRecord
    user_id: str
    workspace: Workspace
    workspace_path: Path
    snapshot_dir: Path
    artifact_dir: Path
    scratch_dir: Path
    credential: str | None
    settings: Settings
    cache_root: Path


type PreparationHandler = Callable[
    [object, AnalysisPreparationContext], AnalysisWorkerInput
]


def prepare_analysis_worker_input(
    context: AnalysisPreparationContext,
) -> AnalysisWorkerInput:
    """Dispatch one exact request model to its focused preparation function."""

    request = context.record.request
    try:
        handler = _PREPARATION_HANDLERS[type(request)]
    except KeyError as exc:
        raise InvalidInputError("Analysis kind has no process implementation") from exc
    return handler(request, context)


def _prepare_preview(
    _request: PreviewRequest,
    _context: AnalysisPreparationContext,
) -> PreviewReadyInput:
    return PreviewReadyInput()


def _prepare_token_frequency(
    request: TokenFrequencyAnalysisRequest,
    context: AnalysisPreparationContext,
) -> TokenFrequencyInput:
    return TokenFrequencyInput(
        node_ids=list(request.node_ids),
        node_columns=dict(request.node_columns),
        artifact_dir=str(context.artifact_dir),
        scratch_dir=str(context.scratch_dir),
        input_snapshot_dir=str(context.snapshot_dir),
        token_limit=request.token_limit,
        node_tokenizer_models=dict(request.node_tokenizer_models),
        token_cache_path=str(tokens_cache_path(context.cache_root)),
    )


def _prepare_topic_modeling(
    request: TopicModelingAnalysisRequest,
    context: AnalysisPreparationContext,
) -> TopicModelingInput:
    return TopicModelingInput(
        node_infos=[
            TopicNodeInfo(
                node_id=node_id,
                text_column=request.node_columns[node_id],
            )
            for node_id in request.node_ids
        ],
        artifact_dir=str(context.artifact_dir),
        input_snapshot_dir=str(context.snapshot_dir),
        embedding_cache_path=str(embeddings_cache_path(context.cache_root)),
        min_cluster_size=request.min_cluster_size,
        random_seed=request.random_seed,
        segmentation_method=request.segmentation_method.value,
        max_segment_tokens=request.max_segment_tokens,
        sample_fractions=request.sample_fractions,
    )


def _prepare_sequential(
    request: SequentialAnalysisRequest,
    context: AnalysisPreparationContext,
) -> SequentialInput:
    return SequentialInput(
        input_snapshot_dir=str(context.snapshot_dir),
        node_id=request.node_id,
        artifact_dir=str(context.artifact_dir),
        request_payload=request.model_dump(mode="json", exclude={"kind", "node_id"}),
    )


def _prepare_topic_data_block_creation(
    request: TopicModelingDataBlockCreationAnalysisRequest,
    context: AnalysisPreparationContext,
) -> TopicDataBlockCreationInput:
    parent = _parent_analysis(context)
    if not isinstance(parent.request, TopicModelingAnalysisRequest):
        raise InvalidInputError("Topic Modeling Data Block Creation parent is invalid")
    if parent.result_payload is None:
        raise InvalidInputError("Topic Modeling Result is unavailable")
    stored = TopicModelingStoredResult.model_validate(parent.result_payload)
    if not (
        stored.clustering.min_cluster_count
        <= request.cluster_count
        <= stored.clustering.max_cluster_count
    ):
        raise InvalidInputError(
            "Topic Modeling Data Block Creation cluster count is unavailable"
        )
    minimum_top_n = 0 if request.cluster_count == 0 else 1
    if not minimum_top_n <= request.top_n_topics <= request.cluster_count:
        raise InvalidInputError(
            "Topic Modeling Data Block Creation Top N is unavailable"
        )
    artifact_paths = {
        reference.name: str(
            (
                context.workspace_path
                / "analyses"
                / str(parent.id)
                / reference.relative_path
            ).resolve(strict=True)
        )
        for reference in parent.artifact_references
    }
    projection_context = stored.projection_context.artifact
    if projection_context is None or projection_context.name not in artifact_paths:
        raise InvalidInputError("Topic projection context is unavailable")
    source_projection: dict[uuid.UUID, dict[str, object]] = {}
    offset = 0
    for index, source in enumerate(stored.sources):
        size = stored.corpus_sizes[index]
        source_projection[source.node_id] = {
            "row_indices": stored.projection_context.source_row_indices[index],
            "offset": offset,
            "size": size,
        }
        offset += size
    return TopicDataBlockCreationInput(
        input_snapshot_dir=str(context.snapshot_dir),
        output_dir=str(context.artifact_dir),
        request_payload=request.model_dump(mode="json"),
        projection_context_path=artifact_paths[projection_context.name],
        source_projection=source_projection,
    )


def _prepare_result_data_block_creation(
    request: ResultDataBlockCreationRequest,
    context: AnalysisPreparationContext,
) -> ResultDataBlockCreationInput:
    parent = _parent_analysis(context)
    if parent.result_payload is None:
        raise InvalidInputError("Run All Result is unavailable")
    result_paths: dict[uuid.UUID, str] = {}
    document_columns: dict[uuid.UUID, str | None] = {}

    if isinstance(
        request,
        (
            ConcordanceMatchDataBlockCreationAnalysisRequest,
            ConcordanceDocumentDataBlockCreationAnalysisRequest,
        ),
    ):
        _prepare_concordance_data_block_sources(
            request,
            context,
            parent,
            result_paths,
            document_columns,
        )
    elif isinstance(request, QuotationResultDataBlockCreationAnalysisRequest):
        _prepare_quotation_data_block_source(
            request,
            context,
            parent,
            result_paths,
            document_columns,
        )
    else:
        _prepare_sequential_data_block_source(
            request,
            context,
            parent,
            result_paths,
            document_columns,
        )
    return ResultDataBlockCreationInput(
        artifact_dir=str(context.artifact_dir),
        request_payload=request.model_dump(mode="json"),
        result_paths=result_paths,
        document_columns=document_columns,
    )


def _prepare_concordance_data_block_sources(
    request: ConcordanceMatchDataBlockCreationAnalysisRequest
    | ConcordanceDocumentDataBlockCreationAnalysisRequest,
    context: AnalysisPreparationContext,
    parent: AnalysisRecord,
    result_paths: dict[uuid.UUID, str],
    document_columns: dict[uuid.UUID, str | None],
) -> None:
    if not isinstance(parent.request, ConcordanceRunAllAnalysisRequest):
        raise InvalidInputError("Concordance Data Block Creation parent is invalid")
    group = ConcordanceRunAllStoredResult.model_validate(parent.result_payload)
    if group.result_type != "group" or group.sources is None:
        raise InvalidInputError("Concordance Run All Result is unavailable")
    descriptors = {item.node_id: item for item in group.sources}
    for selection in request.sources:
        descriptor = descriptors.get(selection.source_node_id)
        if descriptor is None:
            raise InvalidInputError("Data Block Creation source is unavailable")
        child = context.workspace.analyses.get(descriptor.analysis_id)
        if child is None or child.result_payload is None:
            raise InvalidInputError("Concordance source Result is unavailable")
        child_result = ConcordanceRunAllStoredResult.model_validate(
            child.result_payload
        )
        if child_result.source is None:
            raise InvalidInputError("Concordance source Result is unavailable")
        if isinstance(selection, ConcordanceDocumentDataBlockCreationSource):
            _validate_document_data_block_creation_columns(
                selection.selected_metadata_columns,
                child_result.source,
            )
        else:
            _validate_data_block_creation_columns(
                selection.selected_columns,
                child_result.source,
            )
        result_paths[selection.source_node_id] = str(
            _analysis_artifact_path(
                context.workspace_path,
                child,
                child_result.source.table.artifact.name,
            )
        )
        document_columns[selection.source_node_id] = descriptor.document_column


def _prepare_quotation_data_block_source(
    request: QuotationResultDataBlockCreationAnalysisRequest,
    context: AnalysisPreparationContext,
    parent: AnalysisRecord,
    result_paths: dict[uuid.UUID, str],
    document_columns: dict[uuid.UUID, str | None],
) -> None:
    if not isinstance(parent.request, QuotationRunAllAnalysisRequest):
        raise InvalidInputError("Quotation Data Block Creation parent is invalid")
    stored = QuotationRunAllStoredResult.model_validate(parent.result_payload)
    selection = request.source
    if selection.source_node_id != stored.source.node_id:
        raise InvalidInputError("Data Block Creation source is unavailable")
    _validate_data_block_creation_columns(selection.selected_columns, stored.source)
    result_paths[selection.source_node_id] = str(
        _analysis_artifact_path(
            context.workspace_path,
            parent,
            stored.source.table.artifact.name,
        )
    )
    document_columns[selection.source_node_id] = stored.source.document_column


def _prepare_sequential_data_block_source(
    request: SequentialDataBlockCreationAnalysisRequest,
    context: AnalysisPreparationContext,
    parent: AnalysisRecord,
    result_paths: dict[uuid.UUID, str],
    document_columns: dict[uuid.UUID, str | None],
) -> None:
    if not isinstance(parent.request, SequentialAnalysisRequest):
        raise InvalidInputError("Trends Data Block Creation parent is invalid")
    stored = SequentialStoredResult.model_validate(parent.result_payload)
    selection = request.source
    if selection.source_node_id != stored.source.node_id:
        raise InvalidInputError("Data Block Creation source is unavailable")
    if any(
        column not in stored.source.columns for column in selection.selected_columns
    ):
        raise InvalidInputError("Data Block Creation column is unavailable")
    if parent.request.time_column not in selection.selected_columns:
        raise InvalidInputError("Trends Data Block Creation requires the axis column")
    if selection.selected_period_indices is not None and any(
        index >= stored.source.period_count
        for index in selection.selected_period_indices
    ):
        raise InvalidInputError("Selected Trends period is out of range")
    if any(
        index >= stored.source.group_count for index in selection.excluded_group_indices
    ):
        raise InvalidInputError("Excluded Trends group is out of range")
    result_paths[selection.source_node_id] = str(
        _analysis_artifact_path(
            context.workspace_path,
            parent,
            stored.publication_artifact.name,
        )
    )
    document_columns[selection.source_node_id] = stored.source.document_column


def _prepare_concordance_run_all(
    request: ConcordanceRunAllAnalysisRequest,
    context: AnalysisPreparationContext,
) -> ConcordanceRunAllInput:
    source = request.source
    if len(source.node_ids) != 1:
        raise InvalidInputError("A Concordance supporting Analysis requires one source")
    node_id = source.node_ids[0]
    return ConcordanceRunAllInput(
        artifact_dir=str(context.artifact_dir),
        input_snapshot_dir=str(context.snapshot_dir),
        parent_node_id=node_id,
        document_column=source.node_columns[node_id],
        search_word=source.search_word,
        num_left_tokens=source.num_left_tokens,
        num_right_tokens=source.num_right_tokens,
        regex=source.regex,
        whole_word=source.whole_word,
        case_sensitive=source.case_sensitive,
        ignore_punctuation=source.ignore_punctuation,
        search_mode=source.search_mode,
        tokenizer_model=source.node_tokenizer_models.get(node_id),
        token_cache_path=str(tokens_cache_path(context.cache_root)),
    )


def _prepare_quotation_run_all(
    request: QuotationRunAllAnalysisRequest,
    context: AnalysisPreparationContext,
) -> QuotationRunAllInput:
    source = request.source
    return QuotationRunAllInput(
        artifact_dir=str(context.artifact_dir),
        input_snapshot_dir=str(context.snapshot_dir),
        parent_node_id=source.node_id,
        document_column=source.column,
        engine=resolve_quotation_engine(source.engine, context.settings),
        quotation_service_max_batch_size=(
            context.settings.quotation_service_max_batch_size
        ),
        quotation_service_timeout=context.settings.quotation_service_timeout,
    )


def _prepare_annotation_run_all(
    request: AnnotationRunAllAnalysisRequest,
    context: AnalysisPreparationContext,
) -> AnnotationInput:
    if context.credential is None and request.source.provider != "custom":
        raise InvalidInputError("Annotation credential is unavailable")
    return AnnotationInput(
        input_snapshot_dir=str(context.snapshot_dir),
        output_dir=str(context.artifact_dir),
        request_payload=request.model_dump(mode="json"),
        api_key=context.credential,
    )


def _parent_analysis(context: AnalysisPreparationContext) -> AnalysisRecord:
    parent_id = context.record.parent_analysis_id
    parent = (
        context.workspace.analyses.get(parent_id) if parent_id is not None else None
    )
    if parent is None:
        raise InvalidInputError("Analysis parent is unavailable")
    return parent


def _analysis_artifact_path(
    workspace_path: Path,
    record: AnalysisRecord,
    artifact_name: str,
) -> Path:
    reference = next(
        (item for item in record.artifact_references if item.name == artifact_name),
        None,
    )
    if reference is None:
        raise InvalidInputError("Run All Result artifact is unavailable")
    return (
        workspace_path / "analyses" / str(record.id) / reference.relative_path
    ).resolve(strict=True)


def _validate_data_block_creation_columns(
    selected_columns: list[str],
    source: RunAllSourceDescriptor,
) -> None:
    allowed = {
        source.document_column,
        *source.metadata_columns,
        *source.analysis_columns,
    }
    if source.document_column not in selected_columns:
        raise InvalidInputError("Data Block Creation requires the document column")
    if any(column not in allowed for column in selected_columns):
        raise InvalidInputError("Data Block Creation column is unavailable")


def _validate_document_data_block_creation_columns(
    selected_metadata_columns: list[str],
    source: RunAllSourceDescriptor,
) -> None:
    metadata_columns = set(source.metadata_columns)
    if any(column not in metadata_columns for column in selected_metadata_columns):
        raise InvalidInputError(
            "Document Data Block Creation metadata column is unavailable"
        )


_PREPARATION_HANDLERS: dict[type[object], PreparationHandler] = {
    AnnotationAnalysisRequest: cast("PreparationHandler", _prepare_preview),
    ConcordanceAnalysisRequest: cast("PreparationHandler", _prepare_preview),
    QuotationAnalysisRequest: cast("PreparationHandler", _prepare_preview),
    TokenFrequencyAnalysisRequest: cast("PreparationHandler", _prepare_token_frequency),
    TopicModelingAnalysisRequest: cast("PreparationHandler", _prepare_topic_modeling),
    SequentialAnalysisRequest: cast("PreparationHandler", _prepare_sequential),
    TopicModelingDataBlockCreationAnalysisRequest: cast(
        "PreparationHandler", _prepare_topic_data_block_creation
    ),
    ConcordanceMatchDataBlockCreationAnalysisRequest: cast(
        "PreparationHandler", _prepare_result_data_block_creation
    ),
    ConcordanceDocumentDataBlockCreationAnalysisRequest: cast(
        "PreparationHandler", _prepare_result_data_block_creation
    ),
    QuotationResultDataBlockCreationAnalysisRequest: cast(
        "PreparationHandler", _prepare_result_data_block_creation
    ),
    SequentialDataBlockCreationAnalysisRequest: cast(
        "PreparationHandler", _prepare_result_data_block_creation
    ),
    ConcordanceRunAllAnalysisRequest: cast(
        "PreparationHandler", _prepare_concordance_run_all
    ),
    QuotationRunAllAnalysisRequest: cast(
        "PreparationHandler", _prepare_quotation_run_all
    ),
    AnnotationRunAllAnalysisRequest: cast(
        "PreparationHandler", _prepare_annotation_run_all
    ),
}

__all__ = ["AnalysisPreparationContext", "prepare_analysis_worker_input"]
