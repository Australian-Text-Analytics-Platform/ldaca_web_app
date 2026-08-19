"""Prepare immutable process inputs for Workspace-owned root Analyses."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from functools import partial
from pathlib import Path

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

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
    TokenFrequencyAnalysisRequest,
    TopicModelingAnalysisRequest,
    TopicModelingDataBlockCreationAnalysisRequest,
    Workspace,
    analysis_snapshot_input_ids,
)
from ..infrastructure.storage.embedding_cache import embeddings_cache_path
from ..models.quotation import QuotationEngineType, ResolvedQuotationEngine
from ..models.analysis_results import (
    ConcordanceRunAllStoredResult,
    QuotationRunAllStoredResult,
    TopicModelingStoredResult,
)
from ..settings import Settings
from ..shared.errors import InvalidInputError
from ..workers.entrypoints import (
    annotation_process,
    concordance_run_all_process,
    preview_ready_process,
    quotation_run_all_process,
    result_data_block_creation_process,
    sequential_process,
    token_frequency_process,
    topic_modeling_process,
    topic_modeling_data_block_creation_process,
)
from ..workers.input_snapshots import create_worker_input_snapshot
from .analysis_execution_types import AnalysisInvocation
from .workspace import WorkspaceLease


class AnalysisExecutionPreparer:
    """Build one process invocation while the Workspace gate is held."""

    def __init__(
        self,
        settings: Settings,
        *,
        limiter: anyio.CapacityLimiter,
        cache_root: Callable[[str], Path],
    ) -> None:
        self._settings = settings
        self._limiter = limiter
        self._cache_root = cache_root

    async def prepare(
        self,
        lease: WorkspaceLease,
        record: AnalysisRecord,
        credential: str | None,
        *,
        user_id: str,
    ) -> AnalysisInvocation:
        """Snapshot selected Data Blocks and return only private immutable inputs."""

        analysis_id = str(record.id)
        workspace = lease.workspace
        node_ids = [
            str(node_id) for node_id in analysis_snapshot_input_ids(record.request)
        ]
        analysis_dir = lease.path / "analyses" / analysis_id
        execution_dir = analysis_dir / ".execution"
        snapshot_dir = execution_dir / "input"
        artifact_dir = execution_dir / "output"
        scratch_dir = execution_dir / "scratch"
        try:
            await run_sync_in_worker_thread(
                partial(
                    create_worker_input_snapshot,
                    workspace_id=workspace.id,
                    node_ids=node_ids,
                    workspace=workspace,
                    workspace_data_dir=lease.path / "data",
                    snapshot_dir=snapshot_dir,
                    max_snapshot_bytes=self._settings.max_analysis_storage_bytes,
                ),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
            return self._invocation(
                record,
                user_id=user_id,
                workspace_id=workspace.id,
                workspace=workspace,
                workspace_path=lease.path,
                snapshot_dir=snapshot_dir,
                artifact_dir=artifact_dir,
                scratch_dir=scratch_dir,
                credential=credential,
            )
        except BaseException:
            with anyio.CancelScope(shield=True):
                await run_sync_in_worker_thread(
                    _remove_execution_staging,
                    execution_dir,
                    abandon_on_cancel=False,
                    limiter=self._limiter,
                )
            raise

    def _invocation(
        self,
        record: AnalysisRecord,
        *,
        user_id: str,
        workspace_id: str,
        workspace: Workspace,
        workspace_path: Path,
        snapshot_dir: Path,
        artifact_dir: Path,
        scratch_dir: Path,
        credential: str | None,
    ) -> AnalysisInvocation:
        request = record.request
        common: dict[str, object] = {
            "user_id": user_id,
            "workspace_id": workspace_id,
            "input_snapshot_dir": str(snapshot_dir),
        }

        def owned(
            function: Callable[..., object],
            kwargs: dict[str, object],
        ) -> AnalysisInvocation:
            return AnalysisInvocation(
                function=function,
                kwargs=kwargs,
                storage_roots=(str(snapshot_dir.parent),),
                max_storage_bytes=self._settings.max_analysis_storage_bytes,
                max_storage_files=self._settings.max_analysis_storage_files,
            )

        if isinstance(request, AnnotationAnalysisRequest):
            return owned(
                preview_ready_process,
                {},
            )

        if isinstance(request, TokenFrequencyAnalysisRequest):
            node_ids = [str(node_id) for node_id in request.node_ids]
            node_columns = {
                str(node_id): column for node_id, column in request.node_columns.items()
            }
            tokenizer_models = {
                str(node_id): model
                for node_id, model in request.node_tokenizer_models.items()
            }
            return owned(
                token_frequency_process,
                {
                    **common,
                    "node_ids": node_ids,
                    "node_columns": node_columns,
                    "artifact_dir": str(artifact_dir),
                    "scratch_dir": str(scratch_dir),
                    "artifact_prefix": "token_frequency",
                    "token_limit": request.token_limit,
                    "node_tokenizer_models": tokenizer_models,
                    "token_cache_path": str(
                        tokens_cache_path(self._cache_root(user_id))
                    ),
                },
            )

        if isinstance(request, TopicModelingAnalysisRequest):
            node_ids = [str(node_id) for node_id in request.node_ids]
            node_columns = {
                str(node_id): column for node_id, column in request.node_columns.items()
            }
            return owned(
                topic_modeling_process,
                {
                    **common,
                    "node_infos": [
                        {"node_id": node_id, "text_column": node_columns[node_id]}
                        for node_id in node_ids
                    ],
                    "artifact_dir": str(artifact_dir),
                    "artifact_prefix": "topic_modeling",
                    "min_cluster_size": request.min_cluster_size,
                    "random_seed": request.random_seed,
                    "sample_fractions": request.sample_fractions,
                    "segmentation_method": request.segmentation_method.value,
                    "max_segment_tokens": request.max_segment_tokens,
                    "embedding_cache_path": str(
                        embeddings_cache_path(self._cache_root(user_id))
                    ),
                },
            )

        if isinstance(request, ConcordanceAnalysisRequest):
            return owned(
                preview_ready_process,
                {},
            )

        if isinstance(request, QuotationAnalysisRequest):
            return owned(
                preview_ready_process,
                {},
            )

        if isinstance(request, SequentialAnalysisRequest):
            return owned(
                sequential_process,
                {
                    **common,
                    "node_id": str(request.node_id),
                    "artifact_dir": str(artifact_dir),
                    "request_payload": request.model_dump(
                        mode="json",
                        exclude={"kind", "node_id"},
                    ),
                },
            )

        parent = (
            workspace.analyses.get(str(record.parent_analysis_id))
            if record.parent_analysis_id is not None
            else None
        )
        parent_request = parent.request if parent is not None else None
        if isinstance(request, TopicModelingDataBlockCreationAnalysisRequest) and isinstance(
            parent_request,
            TopicModelingAnalysisRequest,
        ):
            if parent is None or parent.result_payload is None:
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
                        workspace_path
                        / "analyses"
                        / str(parent.id)
                        / reference.relative_path
                    ).resolve(strict=True)
                )
                for reference in parent.artifact_references
            }
            context = stored.clustering_context.artifact
            if context is None or context.name not in artifact_paths:
                raise InvalidInputError("Topic clustering context is unavailable")
            source_projection: dict[str, dict[str, object]] = {}
            offset = 0
            for index, source in enumerate(stored.sources):
                size = stored.corpus_sizes[index]
                source_projection[str(source.node_id)] = {
                    "row_indices": stored.clustering_context.source_row_indices[index],
                    "offset": offset,
                    "size": size,
                }
                offset += size
            return owned(
                topic_modeling_data_block_creation_process,
                {
                    "input_snapshot_dir": str(snapshot_dir),
                    "output_dir": str(artifact_dir),
                    "request_payload": request.model_dump(mode="json"),
                    "clustering_context_path": artifact_paths[context.name],
                    "source_projection": source_projection,
                },
            )
        if isinstance(
            request,
            (
                ConcordanceMatchDataBlockCreationAnalysisRequest,
                ConcordanceDocumentDataBlockCreationAnalysisRequest,
                QuotationResultDataBlockCreationAnalysisRequest,
            ),
        ):
            if parent is None or parent.result_payload is None:
                raise InvalidInputError("Run All Result is unavailable")
            selections = (
                request.sources
                if isinstance(
                    request,
                    (
                        ConcordanceMatchDataBlockCreationAnalysisRequest,
                        ConcordanceDocumentDataBlockCreationAnalysisRequest,
                    ),
                )
                else [request.source]
            )
            result_paths: dict[str, str] = {}
            document_columns: dict[str, str] = {}
            if isinstance(
                request,
                (
                    ConcordanceMatchDataBlockCreationAnalysisRequest,
                    ConcordanceDocumentDataBlockCreationAnalysisRequest,
                ),
            ):
                if not isinstance(parent_request, ConcordanceRunAllAnalysisRequest):
                    raise InvalidInputError(
                        "Concordance Data Block Creation parent is invalid"
                    )
                group = ConcordanceRunAllStoredResult.model_validate(
                    parent.result_payload
                )
                if group.result_type != "group" or group.sources is None:
                    raise InvalidInputError("Concordance Run All Result is unavailable")
                descriptors = {item.node_id: item for item in group.sources}
                for selection in selections:
                    descriptor = descriptors.get(selection.source_node_id)
                    if descriptor is None:
                        raise InvalidInputError(
                            "Data Block Creation source is unavailable"
                        )
                    child = workspace.analyses.get(str(descriptor.analysis_id))
                    if child is None or child.result_payload is None:
                        raise InvalidInputError(
                            "Concordance source Result is unavailable"
                        )
                    child_result = ConcordanceRunAllStoredResult.model_validate(
                        child.result_payload
                    )
                    if child_result.source is None:
                        raise InvalidInputError(
                            "Concordance source Result is unavailable"
                        )
                    if not isinstance(
                        selection, ConcordanceDocumentDataBlockCreationSource
                    ):
                        _validate_data_block_creation_columns(
                            selection.selected_columns,
                            child_result.source,
                        )
                    else:
                        _validate_document_data_block_creation_columns(
                            selection.selected_metadata_columns,
                            child_result.source,
                        )
                    result_paths[str(selection.source_node_id)] = str(
                        _analysis_artifact_path(
                            workspace_path,
                            child,
                            child_result.source.table.artifact.name,
                        )
                    )
                    document_columns[str(selection.source_node_id)] = (
                        descriptor.document_column
                    )
            else:
                if not isinstance(parent_request, QuotationRunAllAnalysisRequest):
                    raise InvalidInputError(
                        "Quotation Data Block Creation parent is invalid"
                    )
                stored = QuotationRunAllStoredResult.model_validate(
                    parent.result_payload
                )
                selection = request.source
                if selection.source_node_id != stored.source.node_id:
                    raise InvalidInputError("Data Block Creation source is unavailable")
                _validate_data_block_creation_columns(
                    selection.selected_columns,
                    stored.source,
                )
                result_paths[str(selection.source_node_id)] = str(
                    _analysis_artifact_path(
                        workspace_path,
                        parent,
                        stored.source.table.artifact.name,
                    )
                )
                document_columns[str(selection.source_node_id)] = (
                    stored.source.document_column
                )
            return owned(
                result_data_block_creation_process,
                {
                    "artifact_dir": str(artifact_dir),
                    "request_payload": request.model_dump(mode="json"),
                    "result_paths": result_paths,
                    "document_columns": document_columns,
                    "source_colors": {
                        str(selection.source_node_id): descriptors[
                            selection.source_node_id
                        ].color
                        for selection in selections
                    }
                    if isinstance(
                        request,
                        (
                            ConcordanceMatchDataBlockCreationAnalysisRequest,
                            ConcordanceDocumentDataBlockCreationAnalysisRequest,
                        ),
                    )
                    else {
                        str(selections[0].source_node_id): stored.source.color
                    },
                },
            )
        if isinstance(request, ConcordanceRunAllAnalysisRequest):
            source = request.source
            if len(source.node_ids) != 1:
                raise InvalidInputError(
                    "A Concordance supporting Analysis requires one source"
                )
            node_id = source.node_ids[0]
            column = source.node_columns[node_id]
            return owned(
                concordance_run_all_process,
                {
                    "artifact_dir": str(artifact_dir),
                    "input_snapshot_dir": str(snapshot_dir),
                    "parent_node_id": str(node_id),
                    "document_column": column,
                    "search_word": source.search_word,
                    "num_left_tokens": source.num_left_tokens,
                    "num_right_tokens": source.num_right_tokens,
                    "regex": source.regex,
                    "whole_word": source.whole_word,
                    "case_sensitive": source.case_sensitive,
                    "ignore_punctuation": source.ignore_punctuation,
                    "search_mode": source.search_mode,
                    "tokenizer_model": source.node_tokenizer_models.get(
                        node_id
                    ),
                    "token_cache_path": str(
                        tokens_cache_path(self._cache_root(user_id))
                    ),
                },
            )

        if isinstance(request, QuotationRunAllAnalysisRequest):
            source = request.source
            return owned(
                quotation_run_all_process,
                {
                    "artifact_dir": str(artifact_dir),
                    "input_snapshot_dir": str(snapshot_dir),
                    "parent_node_id": str(source.node_id),
                    "document_column": source.column,
                    "engine": resolve_analysis_quotation_engine(
                        source,
                        self._settings,
                    ).model_dump(mode="json"),
                    "quotation_service_max_batch_size": (
                        self._settings.quotation_service_max_batch_size
                    ),
                    "quotation_service_timeout": (
                        self._settings.quotation_service_timeout
                    ),
                },
            )
        if isinstance(request, AnnotationRunAllAnalysisRequest):
            if credential is None and request.source.provider != "custom":
                raise InvalidInputError("Annotation credential is unavailable")
            return owned(
                annotation_process,
                {
                    "input_snapshot_dir": str(snapshot_dir),
                    "output_dir": str(artifact_dir),
                    "request_payload": request.model_dump(mode="json"),
                    "api_key": credential,
                },
            )
        raise InvalidInputError("Analysis kind has no process implementation")


def _analysis_artifact_path(
    workspace_path: Path,
    record: AnalysisRecord,
    artifact_name: str,
) -> Path:
    reference = next(
        (
            item
            for item in record.artifact_references
            if item.name == artifact_name
        ),
        None,
    )
    if reference is None:
        raise InvalidInputError("Run All Result artifact is unavailable")
    return (
        workspace_path
        / "analyses"
        / str(record.id)
        / reference.relative_path
    ).resolve(strict=True)


def _validate_data_block_creation_columns(
    selected_columns: list[str],
    source: object,
) -> None:
    document_column = getattr(source, "document_column")
    metadata_columns = getattr(source, "metadata_columns")
    analysis_columns = getattr(source, "analysis_columns")
    allowed = {document_column, *metadata_columns, *analysis_columns}
    if document_column not in selected_columns:
        raise InvalidInputError("Data Block Creation requires the document column")
    if any(column not in allowed for column in selected_columns):
        raise InvalidInputError("Data Block Creation column is unavailable")


def _validate_document_data_block_creation_columns(
    selected_metadata_columns: list[str],
    source: object,
) -> None:
    metadata_columns = set(getattr(source, "metadata_columns"))
    if any(column not in metadata_columns for column in selected_metadata_columns):
        raise InvalidInputError("Document Data Block Creation metadata column is unavailable")


def _remove_execution_staging(path: Path) -> None:
    try:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        elif path.exists() or path.is_symlink():
            path.unlink()
    except FileNotFoundError:
        return


def resolve_analysis_quotation_engine(
    request: QuotationAnalysisRequest,
    settings: Settings,
) -> ResolvedQuotationEngine:
    if request.engine.type.value == "local":
        return ResolvedQuotationEngine()
    endpoint = next(
        (
            engine.url
            for engine in settings.quotation_remote_engines
            if engine.id == request.engine.engine_id
        ),
        None,
    )
    if endpoint is None:
        raise InvalidInputError("Quotation engine is not configured")
    return ResolvedQuotationEngine(type=QuotationEngineType.REMOTE, url=endpoint)


__all__ = ["AnalysisExecutionPreparer", "resolve_analysis_quotation_engine"]
