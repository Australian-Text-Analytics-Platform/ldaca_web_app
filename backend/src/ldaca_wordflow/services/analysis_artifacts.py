"""Validation and atomic publication of Analysis-owned worker Artifacts."""

from __future__ import annotations

import os
import shutil
import stat
import uuid
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import cast

import anyio
import polars as pl
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..domain.workspace import (
    AnalysisArtifactRecord,
    AnalysisQuerySnapshotRecord,
    AnalysisRecord,
    AnnotationRunAllAnalysisRequest,
    ConcordanceDocumentDataBlockCreationAnalysisRequest,
    ConcordanceDocumentDataBlockCreationSource,
    ConcordanceDocumentDataBlockCreationDerivation,
    ConcordanceMatchDataBlockCreationAnalysisRequest,
    ConcordanceMatchDataBlockCreationDerivation,
    DerivationInput,
    DerivationProvenance,
    Node,
    QuotationResultDataBlockCreationAnalysisRequest,
    QuotationResultDataBlockCreationDerivation,
    SequentialAnalysisRequest,
    SequentialDataBlockCreationAnalysisRequest,
    SequentialDataBlockCreationDerivation,
    TopicModelingAnalysisRequest,
    TopicModelingDataBlockCreationAnalysisRequest,
    TopicModelingDataBlockCreationDerivation,
    Workspace,
    node_reference,
    referenced_node_ids,
)
from ..infrastructure.storage.durable_fs import (
    fsync_directory,
    fsync_file,
    mkdir_durable,
)
from ..models.analysis_results import (
    ANALYSIS_STORED_RESULT_MODELS,
    ANALYSIS_WORKER_RESULT_MODELS,
    AnnotationRunAllStoredResult,
    AnnotationRunAllWorkerResult,
    PublishedDataBlockMetadata,
    PublishedDataBlockStoredResult,
    PublishedDataBlockWorkerResult,
    PreviewReadyStoredResult,
    DataBlockCreationOutput,
    DataBlockCreationStoredResult,
    DataBlockCreationWorkerResult,
    SequentialStoredResult,
    TopicModelingDataBlockCreationOutput,
    TopicModelingDataBlockCreationStoredResult,
    TopicModelingDataBlockCreationWorkerResult,
    stored_result_payload,
)
from ..shared.errors import ArtifactGoneError
from ..shared.json_data import JsonData
from .analyses import PublishedAnalysisResult
from .artifact_contracts import ANALYSIS_ARTIFACT_PROJECTORS, ArtifactProjection
from .node_projection import canonical_node_info
from .response_snapshots import ResponseSnapshot, ResponseSnapshotService
from .workspace import WorkspaceLease
from ..workers.input_snapshots import clone_worker_input_snapshot


class AnalysisArtifactService:
    """Publish only strictly declared files owned by one Analysis directory."""

    def __init__(
        self,
        *,
        limiter: anyio.CapacityLimiter,
        response_snapshots: ResponseSnapshotService,
        max_node_bytes: int,
        max_snapshot_bytes: int,
    ) -> None:
        self._limiter = limiter
        self._response_snapshots = response_snapshots
        self._max_node_bytes = max_node_bytes
        self._max_snapshot_bytes = max_snapshot_bytes

    async def publish_result(
        self,
        lease: WorkspaceLease,
        record: AnalysisRecord,
        raw_result: object,
    ) -> PublishedAnalysisResult:
        """Validate one kind-specific Result and publish its declared Artifacts."""

        kind = record.request.kind
        worker_model = ANALYSIS_WORKER_RESULT_MODELS.get(kind)
        stored_model = ANALYSIS_STORED_RESULT_MODELS.get(kind)
        if worker_model is None or stored_model is None:
            raise ValueError("Analysis kind has no Result contract")
        result = worker_model.model_validate(raw_result)
        if isinstance(result, PreviewReadyStoredResult):
            query_snapshot = lease.path / "analyses" / str(record.id) / "query-input"
            await run_sync_in_worker_thread(
                partial(
                    clone_worker_input_snapshot,
                    lease.path / "analyses" / str(record.id) / ".execution" / "input",
                    query_snapshot,
                    max_snapshot_bytes=self._max_snapshot_bytes,
                ),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
            lease.rollback_analysis_directories.append(query_snapshot)
            return PublishedAnalysisResult(
                payload={"ready": True},
                artifacts=[],
                output_node_ids=[],
                query_snapshot=AnalysisQuerySnapshotRecord(
                    relative_path=(
                        Path("analyses") / str(record.id) / "query-input"
                    ).as_posix()
                ),
            )
        if isinstance(result, AnnotationRunAllWorkerResult):
            lease.rollback_paths.append(
                lease.path / "data" / f"annotation-{record.id}.parquet"
            )
            stored = await run_sync_in_worker_thread(
                partial(
                    _publish_annotation_run_all,
                    lease.path / "analyses" / str(record.id),
                    lease.workspace,
                    lease.path,
                    record,
                    result,
                    self._max_node_bytes,
                    lease.revision + 1,
                ),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
            return PublishedAnalysisResult(
                payload=cast(dict[str, JsonData], stored.model_dump(mode="json")),
                artifacts=[],
                output_node_ids=[],
            )
        if isinstance(result, TopicModelingDataBlockCreationWorkerResult):
            stored = await run_sync_in_worker_thread(
                partial(
                    _publish_topic_modeling_data_blocks,
                    lease.path / "analyses" / str(record.id),
                    lease.workspace,
                    lease.path,
                    record,
                    result,
                    self._max_node_bytes,
                ),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
            lease.rollback_paths.extend(
                lease.path / "data" / f"{node_id}.parquet"
                for node_id in stored.output_node_ids
            )
            return PublishedAnalysisResult(
                payload=cast(dict[str, JsonData], stored.model_dump(mode="json")),
                artifacts=[],
                output_node_ids=stored.output_node_ids,
            )
        if isinstance(result, DataBlockCreationWorkerResult):
            stored = await run_sync_in_worker_thread(
                partial(
                    _create_result_data_blocks,
                    lease.path / "analyses" / str(record.id),
                    lease.workspace,
                    lease.path,
                    record,
                    result,
                    self._max_node_bytes,
                ),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
            lease.rollback_paths.extend(
                lease.path / "data" / f"{node_id}.parquet"
                for node_id in stored.output_node_ids
            )
            return PublishedAnalysisResult(
                payload=cast(dict[str, JsonData], stored.model_dump(mode="json")),
                artifacts=[],
                output_node_ids=stored.output_node_ids,
            )
        if isinstance(result, PublishedDataBlockWorkerResult):
            stored = await run_sync_in_worker_thread(
                partial(
                    _publish_analysis_data_block,
                    lease.path / "analyses" / str(record.id),
                    lease.workspace,
                    lease.path,
                    record,
                    result,
                    self._max_node_bytes,
                ),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
            lease.rollback_paths.append(
                lease.path / "data" / f"{stored.output_node_ids[0]}.parquet"
            )
            return PublishedAnalysisResult(
                payload=cast(
                    dict[str, JsonData],
                    stored.model_dump(mode="json"),
                ),
                artifacts=[],
                output_node_ids=stored.output_node_ids,
            )

        projector = ANALYSIS_ARTIFACT_PROJECTORS.get(kind)
        if projector is None:
            raise ValueError("Analysis kind has no Artifact contract")
        payload = stored_result_payload(kind, result)
        publication = await run_sync_in_worker_thread(
            partial(
                _publish_result,
                lease.path / "analyses" / str(record.id),
                payload,
                projector(result),
            ),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )
        stored = stored_model.model_validate(publication.payload)
        if publication.published:
            lease.rollback_analysis_directories.append(
                lease.path / "analyses" / str(record.id) / "artifacts"
            )
        return PublishedAnalysisResult(
            payload=cast(dict[str, JsonData], stored.model_dump(mode="json")),
            artifacts=publication.artifacts,
            output_node_ids=[],
            query_snapshot=None,
        )

    async def response_snapshot(
        self,
        lease: WorkspaceLease,
        record: AnalysisRecord,
        artifact_name: str,
    ) -> tuple[ResponseSnapshot, AnalysisArtifactRecord]:
        """Snapshot one declared regular Artifact while its Workspace is gated."""

        reference = next(
            (item for item in record.artifact_references if item.name == artifact_name),
            None,
        )
        if reference is None:
            raise ArtifactGoneError("Analysis Artifact is unavailable")
        try:
            source = await run_sync_in_worker_thread(
                partial(
                    _resolve_published_artifact,
                    lease.path,
                    str(record.id),
                    reference.relative_path,
                ),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
            snapshot = await self._response_snapshots.create(source)
        except (OSError, ValueError) as exc:
            raise ArtifactGoneError("Analysis Artifact is unavailable") from exc
        return snapshot, reference

    async def ensure_available(
        self,
        lease: WorkspaceLease,
        record: AnalysisRecord,
    ) -> None:
        """Verify every declared Artifact while its Analysis is stable."""

        try:
            await run_sync_in_worker_thread(
                partial(
                    _resolve_all_published_artifacts,
                    lease.path,
                    record,
                ),
                abandon_on_cancel=False,
                limiter=self._limiter,
            )
        except (OSError, ValueError) as exc:
            raise ArtifactGoneError("Analysis Artifact is unavailable") from exc


@dataclass(frozen=True, slots=True)
class _FilesystemPublication:
    payload: dict[str, JsonData]
    artifacts: list[AnalysisArtifactRecord]
    published: bool


def _publish_annotation_run_all(
    analysis_dir: Path,
    workspace: Workspace,
    workspace_path: Path,
    record: AnalysisRecord,
    result: AnnotationRunAllWorkerResult,
    max_node_bytes: int,
    committed_workspace_revision: int,
) -> AnnotationRunAllStoredResult:
    request = record.request
    if not isinstance(request, AnnotationRunAllAnalysisRequest):
        raise ValueError("Annotation Run All request is invalid")
    source_request = request.source
    node = workspace.nodes.get(str(source_request.node_id))
    if node is None:
        raise ValueError("Annotation Run All source Data Block is unavailable")

    output_dir = analysis_dir / ".execution" / "output"
    source, _relative = _resolve_output_file(
        output_dir,
        result.result.parquet_path,
    )
    if _owned_regular_files(output_dir) != {source}:
        raise ValueError("Annotation Run All output contains undeclared files")
    if source.stat().st_size > max_node_bytes:
        raise ValueError("Annotation Run All output exceeds its storage budget")

    data_dir = workspace_path / "data"
    mkdir_durable(data_dir)
    destination = data_dir / f"annotation-{record.id}.parquet"
    os.link(source, destination, follow_symlinks=False)
    fsync_directory(data_dir)
    lazyframe = pl.scan_parquet(destination.resolve(strict=True))
    columns = lazyframe.collect_schema().names()
    if columns != result.result.output_columns:
        raise ValueError("Annotation Run All columns do not match its Result")
    count = int(lazyframe.select(pl.len()).collect().item())
    if count != result.result.record_count:
        raise ValueError("Annotation Run All count does not match its Result")
    if source_request.annotation_column not in columns:
        raise ValueError("Annotation Run All output column is unavailable")
    node.data = lazyframe
    annotated_count = int(
        lazyframe.select(pl.col(source_request.annotation_column).is_not_null().sum())
        .collect()
        .item()
    )
    canonical_node_info(node)
    return AnnotationRunAllStoredResult(
        affected_node_id=source_request.node_id,
        annotation_column=source_request.annotation_column,
        committed_workspace_revision=committed_workspace_revision,
        record_count=count,
        attempted_count=result.result.attempted_count,
        failed_batch_count=result.result.failed_batch_count,
        failed_row_count=result.result.failed_row_count,
        annotated_count=annotated_count,
    )


def _publish_analysis_data_block(
    analysis_dir: Path,
    workspace: Workspace,
    workspace_path: Path,
    record: AnalysisRecord,
    result: PublishedDataBlockWorkerResult,
    max_node_bytes: int,
    expected_output_files: set[Path] | None = None,
) -> PublishedDataBlockStoredResult:
    """Validate and transfer one Analysis output into independent graph ownership."""

    metadata = result.result.data_block
    _validate_published_data_block_identity(workspace, record, metadata)
    output_dir = analysis_dir / ".execution" / "output"
    source, _relative = _resolve_output_file(output_dir, result.result.parquet_path)
    if _owned_regular_files(output_dir) != (expected_output_files or {source}):
        raise ValueError("Analysis Data Block output contains undeclared files")
    if source.stat().st_size > max_node_bytes:
        raise ValueError("Analysis Data Block exceeds its storage budget")

    data_dir = workspace_path / "data"
    mkdir_durable(data_dir)
    destination = data_dir / f"{metadata.id}.parquet"
    published = False
    try:
        os.link(source, destination, follow_symlinks=False)
        published = True
        fsync_directory(data_dir)
        lazyframe = pl.scan_parquet(destination.resolve(strict=True))
        columns = lazyframe.collect_schema().names()
        if columns != result.result.output_columns:
            raise ValueError("Analysis output columns do not match its Result")
        count = int(lazyframe.select(pl.len()).collect().item())
        if count != result.result.record_count:
            raise ValueError("Analysis output count does not match its Result")
        parents = [
            workspace.nodes[item] for item in referenced_node_ids(metadata.provenance)
        ]
        node = Node(
            id=str(metadata.id),
            data=lazyframe,
            name=metadata.name,
            provenance=metadata.provenance,
            document=metadata.document,
            color=metadata.color,
            parents=parents,
        )
        workspace.add_node(node)
        workspace.place_node_after_parent(node)
        canonical_node_info(node)
    except BaseException:
        if published:
            destination.unlink(missing_ok=True)
            fsync_directory(data_dir)
        raise
    payload = {
        "output_node_ids": [metadata.id],
        "output_columns": result.result.output_columns,
        "record_count": result.result.record_count,
    }
    return PublishedDataBlockStoredResult(**payload)


def _publish_topic_modeling_data_blocks(
    analysis_dir: Path,
    workspace: Workspace,
    workspace_path: Path,
    record: AnalysisRecord,
    result: TopicModelingDataBlockCreationWorkerResult,
    max_node_bytes: int,
) -> TopicModelingDataBlockCreationStoredResult:
    output_dir = analysis_dir / ".execution" / "output"
    declared_files = {
        _resolve_output_file(output_dir, data.parquet_path)[0]
        for output in result.outputs
        for data in (output.topic_data, output.topic_meanings)
    }
    if len(declared_files) != len(result.outputs) * 2:
        raise ValueError("Topic Modeling output files must be unique")
    created_ids: list[uuid.UUID] = []
    stored_outputs: list[TopicModelingDataBlockCreationOutput] = []
    try:
        for output in result.outputs:
            topic_data = _publish_analysis_data_block(
                analysis_dir,
                workspace,
                workspace_path,
                record,
                PublishedDataBlockWorkerResult(
                    state="successful",
                    result=output.topic_data,
                    message=result.message,
                ),
                max_node_bytes,
                declared_files,
            )
            created_ids.extend(topic_data.output_node_ids)
            topic_meanings = _publish_analysis_data_block(
                analysis_dir,
                workspace,
                workspace_path,
                record,
                PublishedDataBlockWorkerResult(
                    state="successful",
                    result=output.topic_meanings,
                    message=result.message,
                ),
                max_node_bytes,
                declared_files,
            )
            created_ids.extend(topic_meanings.output_node_ids)
            stored_outputs.append(
                TopicModelingDataBlockCreationOutput(
                    source_node_id=output.source_node_id,
                    topic_data_node_id=topic_data.output_node_ids[0],
                    topic_meanings_node_id=topic_meanings.output_node_ids[0],
                    topic_data_columns=topic_data.output_columns,
                    topic_data_record_count=topic_data.record_count,
                    topic_meanings_record_count=topic_meanings.record_count,
                )
            )
    except BaseException:
        data_dir = workspace_path / "data"
        for node_id in reversed(created_ids):
            workspace.remove_node(str(node_id))
            (data_dir / f"{node_id}.parquet").unlink(missing_ok=True)
        if created_ids:
            fsync_directory(data_dir)
        raise
    return TopicModelingDataBlockCreationStoredResult(
        output_node_ids=created_ids,
        outputs=stored_outputs,
    )


def _create_result_data_blocks(
    analysis_dir: Path,
    workspace: Workspace,
    workspace_path: Path,
    record: AnalysisRecord,
    result: DataBlockCreationWorkerResult,
    max_node_bytes: int,
) -> DataBlockCreationStoredResult:
    output_dir = analysis_dir / ".execution" / "output"
    declared_files = {
        _resolve_output_file(output_dir, output.data.parquet_path)[0]
        for output in result.outputs
    }
    if len(declared_files) != len(result.outputs):
        raise ValueError("Data Block Creation output files must be unique")
    created_ids: list[uuid.UUID] = []
    stored_outputs: list[DataBlockCreationOutput] = []
    try:
        for output in result.outputs:
            published = _publish_analysis_data_block(
                analysis_dir,
                workspace,
                workspace_path,
                record,
                PublishedDataBlockWorkerResult(
                    state="successful",
                    result=output.data,
                    message=result.message,
                ),
                max_node_bytes,
                declared_files,
            )
            output_id = published.output_node_ids[0]
            created_ids.append(output_id)
            stored_outputs.append(
                DataBlockCreationOutput(
                    source_node_id=output.source_node_id,
                    output_node_id=output_id,
                    output_columns=published.output_columns,
                    record_count=published.record_count,
                )
            )
    except BaseException:
        data_dir = workspace_path / "data"
        for node_id in reversed(created_ids):
            workspace.remove_node(str(node_id))
            (data_dir / f"{node_id}.parquet").unlink(missing_ok=True)
        if created_ids:
            fsync_directory(data_dir)
        raise
    return DataBlockCreationStoredResult(
        output_node_ids=created_ids,
        outputs=stored_outputs,
    )


def _validate_published_data_block_identity(
    workspace: Workspace,
    record: AnalysisRecord,
    metadata: PublishedDataBlockMetadata,
) -> None:
    """Reject any published Data Block that diverges from its immutable request."""

    request = record.request
    parent = workspace.analyses.get(str(record.parent_analysis_id))
    parent_request = parent.request if parent is not None else None
    if isinstance(
        request,
        (
            ConcordanceMatchDataBlockCreationAnalysisRequest,
            ConcordanceDocumentDataBlockCreationAnalysisRequest,
        ),
    ):
        selection = next(
            (
                item
                for item in request.sources
                if item.source_node_id
                in {
                    uuid.UUID(node_id)
                    for node_id in referenced_node_ids(metadata.provenance)
                }
            ),
            None,
        )
        if selection is None:
            raise ValueError("Concordance Data Block Creation source is invalid")
        source_node_id = selection.source_node_id
        operation = (
            ConcordanceMatchDataBlockCreationDerivation()
            if isinstance(request, ConcordanceMatchDataBlockCreationAnalysisRequest)
            else ConcordanceDocumentDataBlockCreationDerivation()
        )
        document = metadata.document
        requested_name = selection.new_node_name
        selected_columns = (
            [document, "CONC_extraction", *selection.selected_metadata_columns]
            if isinstance(selection, ConcordanceDocumentDataBlockCreationSource)
            else selection.selected_columns
        )
    elif isinstance(request, QuotationResultDataBlockCreationAnalysisRequest):
        source_node_id = request.source.source_node_id
        operation = QuotationResultDataBlockCreationDerivation()
        document = metadata.document
        requested_name = request.source.new_node_name
        selected_columns = request.source.selected_columns
    elif isinstance(request, SequentialDataBlockCreationAnalysisRequest) and isinstance(
        parent_request,
        SequentialAnalysisRequest,
    ):
        if parent is None or parent.result_payload is None:
            raise ValueError("Trends Data Block Creation parent Result is unavailable")
        stored = SequentialStoredResult.model_validate(parent.result_payload)
        selection = request.source
        expected_document = (
            stored.source.document_column
            if stored.source.document_column in selection.selected_columns
            else None
        )
        expected_provenance = DerivationProvenance(
            operation=SequentialDataBlockCreationDerivation(),
            inputs=[
                DerivationInput(
                    role="source",
                    value=node_reference(str(selection.source_node_id)),
                )
            ],
        )
        if (
            parent_request.node_id != stored.source.node_id
            or selection.source_node_id != stored.source.node_id
            or metadata.name != selection.new_node_name
            or metadata.provenance != expected_provenance
            or metadata.document != expected_document
            or metadata.color is not None
            or str(metadata.id) in workspace.nodes
        ):
            raise ValueError("Trends Data Block metadata is invalid")
        return
    elif isinstance(
        request, TopicModelingDataBlockCreationAnalysisRequest
    ) and isinstance(
        parent_request,
        TopicModelingAnalysisRequest,
    ):
        if not isinstance(metadata.provenance, DerivationProvenance):
            raise ValueError("Topic Modeling Data Block Creation provenance is invalid")
        references = referenced_node_ids(metadata.provenance)
        operation_value = metadata.provenance.operation
        if len(references) != 1 or not isinstance(
            operation_value, TopicModelingDataBlockCreationDerivation
        ):
            raise ValueError("Topic Modeling Data Block Creation provenance is invalid")
        if (
            operation_value.cluster_count != request.cluster_count
            or operation_value.top_n_topics != request.top_n_topics
        ):
            raise ValueError("Topic Modeling Data Block Creation provenance is invalid")
        source_id = references[0]
        if operation_value.role == "topic_data":
            source_uuid = uuid.UUID(source_id)
            source = workspace.nodes.get(source_id)
            if source is None or source_uuid not in request.node_ids:
                raise ValueError("Topic Modeling source Data Block is unavailable")
            selected = request.selected_columns[source_uuid]
            if (
                metadata.name != request.new_node_names[source_uuid]
                or metadata.document
                != (source.document if source.document in selected else None)
                or metadata.color is not None
                or str(metadata.id) in workspace.nodes
            ):
                raise ValueError("Topic Modeling Data Block metadata is invalid")
            return
        topic_data = workspace.nodes.get(source_id)
        if (
            topic_data is None
            or metadata.name != f"{topic_data.name} topic meanings"
            or metadata.document is not None
            or metadata.color is not None
            or str(metadata.id) in workspace.nodes
        ):
            raise ValueError("Topic meanings Data Block metadata is invalid")
        return
    else:
        raise ValueError("Child Analysis no longer has a compatible parent")
    expected_provenance = DerivationProvenance(
        operation=operation,
        inputs=[
            DerivationInput(
                role="source",
                value=node_reference(str(source_node_id)),
            )
        ],
    )
    if (
        document is None
        or document not in selected_columns
        or metadata.name != requested_name
        or metadata.provenance != expected_provenance
        or metadata.document != document
        or metadata.color is not None
        or str(metadata.id) in workspace.nodes
    ):
        raise ValueError("Child Analysis Data Block metadata is invalid")


def _publish_result(
    analysis_dir: Path,
    payload: dict[str, JsonData],
    projections: list[ArtifactProjection],
) -> _FilesystemPublication:
    output_dir = analysis_dir / ".execution" / "output"
    artifacts_dir = analysis_dir / "artifacts"
    if not projections:
        if output_dir.exists() and _owned_regular_files(output_dir):
            raise ValueError("Analysis returned undeclared Artifact files")
        return _FilesystemPublication(payload, [], False)
    if artifacts_dir.exists() or artifacts_dir.is_symlink():
        raise FileExistsError("Analysis Artifact directory already exists")

    projected: list[tuple[tuple[str | int, ...], Path, Path]] = []
    for field_path, raw_path in projections:
        resolved, relative = _resolve_output_file(output_dir, raw_path)
        projected.append((field_path, resolved, relative))
    owned_files = _owned_regular_files(output_dir)
    projected_files = {resolved for _field, resolved, _relative in projected}
    if owned_files != projected_files:
        raise ValueError("Analysis output contains undeclared Artifact files")

    by_relative: dict[Path, AnalysisArtifactRecord] = {}
    used_names: set[str] = set()
    for _field_path, _resolved, relative in projected:
        if relative in by_relative:
            continue
        name = _unique_name(relative.name, used_names)
        used_names.add(name)
        by_relative[relative] = AnalysisArtifactRecord(
            name=name,
            relative_path=(Path("artifacts") / relative).as_posix(),
            media_type=_media_type(relative),
        )

    for field_path, _resolved, relative in projected:
        reference = by_relative[relative]
        _replace_projected_value(
            payload,
            field_path,
            {"name": reference.name, "media_type": reference.media_type},
        )

    for path in sorted(owned_files):
        fsync_file(path)
    for directory in sorted(
        {path.parent for path in owned_files},
        key=lambda path: len(path.parts),
        reverse=True,
    ):
        fsync_directory(directory)
    fsync_directory(output_dir)
    os.replace(output_dir, artifacts_dir)
    try:
        fsync_directory(analysis_dir)
    except BaseException:
        shutil.rmtree(artifacts_dir)
        fsync_directory(analysis_dir)
        raise
    return _FilesystemPublication(payload, list(by_relative.values()), True)


def _owned_regular_files(root: Path) -> set[Path]:
    try:
        metadata = root.lstat()
    except FileNotFoundError:
        return set()
    if not stat.S_ISDIR(metadata.st_mode) or root.is_symlink():
        raise ValueError("Analysis output root is invalid")
    files: set[Path] = set()
    for current, directory_names, file_names in os.walk(
        root,
        topdown=True,
        followlinks=False,
    ):
        directory = Path(current)
        for name in directory_names:
            child = directory / name
            child_metadata = child.lstat()
            if not stat.S_ISDIR(child_metadata.st_mode) or child.is_symlink():
                raise ValueError("Analysis output contains an invalid directory")
        for name in file_names:
            child = directory / name
            child_metadata = child.lstat()
            if not stat.S_ISREG(child_metadata.st_mode) or child.is_symlink():
                raise ValueError("Analysis output contains an invalid file")
            files.add(child.resolve(strict=True))
    return files


def _resolve_output_file(root: Path, raw_path: str) -> tuple[Path, Path]:
    resolved_root = root.resolve(strict=True)
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = resolved_root / candidate
    resolved = candidate.resolve(strict=True)
    relative = resolved.relative_to(resolved_root)
    current = resolved_root
    for part in relative.parts:
        current = current / part
        metadata = current.lstat()
        reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
        attributes = int(getattr(metadata, "st_file_attributes", 0))
        if stat.S_ISLNK(metadata.st_mode) or attributes & reparse:
            raise ValueError("Analysis Artifact path contains a link")
    if not stat.S_ISREG(resolved.lstat().st_mode):
        raise ValueError("Analysis Artifact is not a regular file")
    return resolved, relative


def _resolve_published_artifact(
    workspace_root: Path,
    analysis_id: str,
    raw_relative_path: str,
) -> Path:
    resolved_workspace = workspace_root.resolve(strict=True)
    canonical_id = str(uuid.UUID(analysis_id))
    if canonical_id != analysis_id:
        raise ValueError("Analysis Artifact owner is invalid")
    artifacts_root = resolved_workspace / "analyses" / analysis_id / "artifacts"
    current = resolved_workspace
    for part in ("analyses", analysis_id, "artifacts"):
        current /= part
        metadata = current.lstat()
        reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
        attributes = int(getattr(metadata, "st_file_attributes", 0))
        if (
            not stat.S_ISDIR(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or attributes & reparse
        ):
            raise ValueError("Analysis Artifact owner is invalid")
    artifacts_root = artifacts_root.resolve(strict=True)
    relative = Path(raw_relative_path)
    if relative.is_absolute() or not relative.parts or relative.parts[0] != "artifacts":
        raise ValueError("Analysis Artifact identity is invalid")
    candidate = artifacts_root.joinpath(*relative.parts[1:])
    resolved = candidate.resolve(strict=True)
    resolved.relative_to(artifacts_root)
    current = artifacts_root
    for part in resolved.relative_to(artifacts_root).parts:
        current /= part
        metadata = current.lstat()
        reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
        attributes = int(getattr(metadata, "st_file_attributes", 0))
        if stat.S_ISLNK(metadata.st_mode) or attributes & reparse:
            raise ValueError("Analysis Artifact path contains a link")
    if not stat.S_ISREG(resolved.lstat().st_mode):
        raise ValueError("Analysis Artifact is not a regular file")
    return resolved


def _resolve_all_published_artifacts(
    workspace_root: Path,
    record: AnalysisRecord,
) -> None:
    for reference in record.artifact_references:
        _resolve_published_artifact(
            workspace_root,
            str(record.id),
            reference.relative_path,
        )


def _replace_projected_value(
    payload: dict[str, JsonData],
    field_path: tuple[str | int, ...],
    value: dict[str, JsonData],
) -> None:
    current: object = payload
    for component in field_path[:-1]:
        if isinstance(component, str) and isinstance(current, dict):
            current = current[component]
        elif isinstance(component, int) and isinstance(current, list):
            current = current[component]
        else:
            raise ValueError("Artifact projection does not match the Result")
    final = field_path[-1]
    if isinstance(final, str) and isinstance(current, dict):
        current[final] = value
    elif isinstance(final, int) and isinstance(current, list):
        current[final] = value
    else:
        raise ValueError("Artifact projection does not match the Result")


def _unique_name(original: str, used: set[str]) -> str:
    if original not in used:
        return original
    path = Path(original)
    index = 2
    while f"{path.stem}-{index}{path.suffix}" in used:
        index += 1
    return f"{path.stem}-{index}{path.suffix}"


def _media_type(path: Path) -> str:
    return {
        ".arrows": "application/vnd.apache.arrow.stream",
        ".parquet": "application/vnd.apache.parquet",
        ".json": "application/json",
        ".csv": "text/csv",
        ".zip": "application/zip",
    }.get(path.suffix.casefold(), "application/octet-stream")


__all__ = ["AnalysisArtifactService"]
