"""Typed, side-effect-free Result projections for Workspace-owned Analyses."""

from __future__ import annotations

import json
import math
import shutil
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import TypeVar, cast

import anyio
import polars as pl
from anyio.to_thread import run_sync as run_sync_in_worker_thread
from pydantic import BaseModel, ValidationError

from ..analysis.concordance_core import compute_node_concordance_page
from ..analysis.annotation_examples import prepare_annotation_examples
from ..analysis.concordance_projection import filter_concordance_documents
from ..analysis.quotation_core import compute_quotation_page
from ..analysis.token_cache import tokenize_lazyframe, tokens_cache_path
from ..analysis.topic_inclusion import topic_inclusion_descriptor
from ..analysis.generated_columns import (
    CONC_MATCHED_TEXT_COLUMN,
    CONC_START_IDX_COLUMN,
    QUOTE_COLUMN_NAMES,
    QUOTE_ROW_IDX_COLUMN,
    TOPIC_DISTRIBUTION_COLUMN,
)
from ..domain.workspace import (
    AnalysisArtifactRecord,
    AnalysisRecord,
    AnnotationAnalysisRequest,
    ConcordanceAnalysisRequest,
    QuotationAnalysisRequest,
)
from ..infrastructure.providers.quotation_client import QuotationProviderClient
from ..infrastructure.providers.annotation_ai import (
    AnnotationAiError,
    annotate_preview,
)
from ..models.analysis_results import (
    ANALYSIS_STORED_RESULT_MODELS,
    AnalysisResultQuery,
    AnnotationResultQuery,
    AnnotationRunAllStoredResult,
    ConcordanceResultQuery,
    ConcordanceDocumentProjectionQuery,
    ConcordanceStoredResult,
    ConcordanceRunAllStoredResult,
    PublishedDataBlockStoredResult,
    QuotationPreviewQuery,
    QuotationRunAllStoredResult,
    QuotationStoredResult,
    ConcordanceDensityResult,
    PreviewReadyStoredResult,
    RunAllSourceTable,
    DataBlockCreationStoredResult,
    SequentialStoredResult,
    ProjectedTableIdentity,
    StoredArtifactIdentity,
    TokenFrequencyStoredResult,
    TopicModelingResultQuery,
    TopicModelingStoredResult,
)
from ..settings import Settings
from ..shared.errors import (
    AnalysisCorruptError,
    AnalysisKindMismatchError,
    AnalysisResultUnavailableError,
    ArtifactGoneError,
    InvalidInputError,
    InvalidClusterCountError,
    InvalidTopicTopNError,
    AnnotationProviderError,
    NodeNotFoundError,
)
from ..shared.json_data import JsonData
from ..shared.table_transport import (
    IpcTablePage,
    encode_ipc_stream,
    encode_schema_stream,
    topic_distribution_dtype,
)
from ..shared.topic_types import topic_count_from_storage_dtype
from ..workers.input_snapshots import (
    clone_worker_input_snapshot,
    load_snapshot_node,
)
from ..workers.topic_pipeline import _project_rust_topic_projection_basis
from ..workers.topic_result import (
    _build_topic_projection_payload,
    _decode_topic_projection_basis,
    _encode_topic_projection_basis,
)
from .analyses import AnalysisService
from .analysis_artifacts import AnalysisArtifactService
from .analysis_preparation import resolve_analysis_quotation_engine
from .provider_credentials import ProviderCredentialStore
from .response_snapshots import ResponseSnapshot
from .storage_admission import StorageAdmissionService, StorageReservation
from .topic_projection_cache import (
    TopicProjectionBasisCache,
    TopicProjectionCacheKey,
)
from .workspace import WorkspaceLease

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class ResultMaterialization:
    """One strict stored Result plus its requested public projection payload."""

    payload: dict[str, JsonData]
    stored: BaseModel


@dataclass(slots=True)
class _QueryInputSnapshot:
    path: Path
    root: Path
    reservation: StorageReservation


class AnalysisResultService:
    """Materialize successful Results without retaining execution input copies."""

    def __init__(
        self,
        analyses: AnalysisService,
        artifacts: AnalysisArtifactService,
        storage_admission: StorageAdmissionService,
        settings: Settings,
        quotation_client: QuotationProviderClient,
        credentials: ProviderCredentialStore,
        *,
        query_root: Path,
        cache_root: Callable[[str], Path],
        limiter: anyio.CapacityLimiter,
    ) -> None:
        self._analyses = analyses
        self._artifacts = artifacts
        self._storage_admission = storage_admission
        self._settings = settings
        self._quotation_client = quotation_client
        self._credentials = credentials
        self._query_root = query_root
        self._cache_root = cache_root
        self._limiter = limiter
        self._topic_projection_cache = TopicProjectionBasisCache(
            max_entries=settings.max_topic_projection_cache_entries,
            max_bytes=settings.max_topic_projection_cache_bytes,
        )

    async def reconcile(self) -> None:
        """Remove query snapshots abandoned by this deployment's prior process."""

        await self._run_sync(_remove_query_root, self._query_root)

    async def artifact_response_snapshot(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        artifact_name: str,
    ) -> tuple[ResponseSnapshot, AnalysisArtifactRecord]:
        """Create a download snapshot without retaining the Workspace gate."""

        async with self._analyses.successful_record_context(
            user_id,
            workspace_id,
            analysis_id,
            allow_closing=True,
        ) as (lease, record):
            return await self._artifacts.response_snapshot(
                lease,
                record,
                artifact_name,
            )

    async def table_response_snapshot(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        table_id: str,
    ) -> ResponseSnapshot:
        """Snapshot one declared complete Result table by semantic identity."""

        async with self._analyses.successful_record_context(
            user_id,
            workspace_id,
            analysis_id,
            allow_closing=True,
        ) as (lease, record):
            stored_model = ANALYSIS_STORED_RESULT_MODELS.get(record.request.kind)
            if stored_model is None or record.result_payload is None:
                raise AnalysisCorruptError("Analysis data is corrupt")
            try:
                stored = stored_model.model_validate(record.result_payload)
            except ValidationError as exc:
                raise AnalysisCorruptError("Analysis data is corrupt") from exc
            artifact = None
            if isinstance(stored, TokenFrequencyStoredResult):
                candidates = [item.table for item in stored.tables.nodes]
                if stored.tables.statistics is not None:
                    candidates.append(stored.tables.statistics)
                artifact = next(
                    (item.artifact for item in candidates if item.table_id == table_id),
                    None,
                )
            elif isinstance(stored, SequentialStoredResult):
                if stored.table.table_id == table_id:
                    artifact = stored.table.artifact
            if artifact is None:
                raise ArtifactGoneError("Analysis Result table is unavailable")
            snapshot, _reference = await self._artifacts.response_snapshot(
                lease,
                record,
                artifact.name,
            )
            return snapshot

    async def paged_table_page(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        table_id: str,
        *,
        page: int,
        page_size: int,
        sort_by: str | None,
        descending: bool,
    ) -> IpcTablePage:
        """Materialize one independent Arrow page from a declared Result table."""

        snapshot = await self._paged_table_snapshot(
            user_id, workspace_id, analysis_id, table_id
        )
        try:
            return await self._run_sync(
                _paged_artifact_page,
                snapshot.path,
                page,
                page_size,
                sort_by,
                descending,
            )
        finally:
            with anyio.CancelScope(shield=True):
                await snapshot.cleanup()

    async def paged_table_schema(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        table_id: str,
    ) -> bytes:
        """Return a zero-row Arrow stream for a declared paged Result table."""

        snapshot = await self._paged_table_snapshot(
            user_id, workspace_id, analysis_id, table_id
        )
        try:
            return await self._run_sync(_paged_artifact_schema, snapshot.path)
        finally:
            with anyio.CancelScope(shield=True):
                await snapshot.cleanup()

    async def projected_table_page(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        table_id: str,
        *,
        row_unit: str,
        page: int,
        page_size: int,
        sort_by: str | None,
        descending: bool,
    ) -> IpcTablePage:
        snapshot, source, kind = await self._projected_table_snapshot(
            user_id, workspace_id, analysis_id, table_id
        )
        try:
            return await self._run_sync(
                _projected_artifact_page,
                snapshot.path,
                kind,
                row_unit,
                source.document_column,
                source.metadata_columns,
                source.analysis_columns,
                page,
                page_size,
                sort_by,
                descending,
            )
        finally:
            with anyio.CancelScope(shield=True):
                await snapshot.cleanup()

    async def projected_table_schema(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        table_id: str,
        *,
        row_unit: str,
    ) -> bytes:
        snapshot, _source, kind = await self._projected_table_snapshot(
            user_id, workspace_id, analysis_id, table_id
        )
        try:
            return await self._run_sync(
                _projected_artifact_schema,
                snapshot.path,
                kind,
                row_unit,
            )
        finally:
            with anyio.CancelScope(shield=True):
                await snapshot.cleanup()

    async def concordance_density(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        table_id: str,
    ) -> ConcordanceDensityResult:
        snapshot, source, kind = await self._projected_table_snapshot(
            user_id, workspace_id, analysis_id, table_id
        )
        try:
            if kind != "concordance_run_all":
                raise AnalysisKindMismatchError(
                    "Density is available only for Concordance Results"
                )
            return await self._run_sync(
                _concordance_density,
                snapshot.path,
                source.document_column,
            )
        finally:
            with anyio.CancelScope(shield=True):
                await snapshot.cleanup()

    async def concordance_document_projection_page(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        table_id: str,
        query: ConcordanceDocumentProjectionQuery,
    ) -> IpcTablePage:
        snapshot, source, kind = await self._projected_table_snapshot(
            user_id, workspace_id, analysis_id, table_id
        )
        try:
            if kind != "concordance_run_all":
                raise AnalysisKindMismatchError(
                    "Document filtering is available only for Concordance Results"
                )
            return await self._run_sync(
                _concordance_document_projection_page,
                snapshot.path,
                source.document_column,
                source.metadata_columns,
                query,
            )
        finally:
            with anyio.CancelScope(shield=True):
                await snapshot.cleanup()

    async def _paged_table_snapshot(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        table_id: str,
    ) -> ResponseSnapshot:
        async with self._analyses.successful_record_context(
            user_id,
            workspace_id,
            analysis_id,
            allow_closing=True,
        ) as (lease, record):
            stored_model = ANALYSIS_STORED_RESULT_MODELS.get(record.request.kind)
            if stored_model is None or record.result_payload is None:
                raise AnalysisCorruptError("Analysis data is corrupt")
            try:
                stored = stored_model.model_validate(record.result_payload)
            except ValidationError as exc:
                raise AnalysisCorruptError("Analysis data is corrupt") from exc
            artifact = _paged_table_artifact(stored, table_id)
            snapshot, _reference = await self._artifacts.response_snapshot(
                lease,
                record,
                artifact.name,
            )
            return snapshot

    async def _projected_table_snapshot(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        table_id: str,
    ) -> tuple[
        ResponseSnapshot,
        RunAllSourceTable[StoredArtifactIdentity],
        str,
    ]:
        async with self._analyses.successful_record_context(
            user_id,
            workspace_id,
            analysis_id,
            allow_closing=True,
        ) as (lease, record):
            stored_model = ANALYSIS_STORED_RESULT_MODELS.get(record.request.kind)
            if stored_model is None or record.result_payload is None:
                raise AnalysisCorruptError("Analysis data is corrupt")
            try:
                stored = stored_model.model_validate(record.result_payload)
            except ValidationError as exc:
                raise AnalysisCorruptError("Analysis data is corrupt") from exc
            source = _projected_table_source(stored, table_id)
            snapshot, _reference = await self._artifacts.response_snapshot(
                lease,
                record,
                source.table.artifact.name,
            )
            return snapshot, source, record.request.kind

    async def quotation_preview_page(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        query: QuotationPreviewQuery,
    ) -> IpcTablePage:
        """Compute one Quotation Preview page as native Arrow IPC."""

        input_snapshot: _QueryInputSnapshot | None = None
        try:
            async with self._analyses.successful_record_context(
                user_id,
                workspace_id,
                analysis_id,
                allow_closing=False,
            ) as (lease, record):
                if not isinstance(record.request, QuotationAnalysisRequest):
                    raise AnalysisKindMismatchError(
                        "Quotation Preview requires a Quotation Analysis"
                    )
                if record.result_payload is None:
                    raise AnalysisCorruptError("Analysis data is corrupt")
                try:
                    QuotationStoredResult.model_validate(record.result_payload)
                except ValidationError as exc:
                    raise AnalysisCorruptError("Analysis data is corrupt") from exc
                input_snapshot = await self._create_query_snapshot(lease, record)
                request = record.request.model_copy(deep=True)
                await self._artifacts.ensure_available(lease, record)

            snapshot_node = await self._run_sync(
                load_snapshot_node,
                input_snapshot.path,
                str(request.node_id),
            )
            page = await compute_quotation_page(
                snapshot_node.to_node(),
                request.column,
                resolve_analysis_quotation_engine(request, self._settings),
                page=query.page,
                page_size=query.page_size,
                sort_by=query.sort_by,
                descending=query.descending,
                quotation_service_max_batch_size=(
                    self._settings.quotation_service_max_batch_size
                ),
                quotation_service_timeout=self._settings.quotation_service_timeout,
                extract_remote_fn=self._quotation_client.extract,
                run_blocking=self._run_sync,
            )
            return IpcTablePage(
                content=encode_ipc_stream(page.frame),
                has_next=page.has_next,
                total_rows=page.total_source_rows,
            )
        finally:
            with anyio.CancelScope(shield=True):
                if input_snapshot is not None:
                    await self._cleanup_query_snapshot(input_snapshot)

    async def query(
        self,
        user_id: str,
        workspace_id: str,
        analysis_id: str,
        query: AnalysisResultQuery | None,
        *,
        allow_closing: bool,
    ) -> ResultMaterialization:
        """Return one typed projection after releasing the Workspace gate."""

        input_snapshot: _QueryInputSnapshot | None = None
        try:
            async with self._analyses.successful_record_context(
                user_id,
                workspace_id,
                analysis_id,
                allow_closing=allow_closing,
            ) as (lease, record):
                kind = record.request.kind
                stored_model = ANALYSIS_STORED_RESULT_MODELS.get(kind)
                if stored_model is None or record.result_payload is None:
                    raise AnalysisCorruptError("Analysis data is corrupt")
                try:
                    stored = stored_model.model_validate(record.result_payload)
                except ValidationError as exc:
                    raise AnalysisCorruptError("Analysis data is corrupt") from exc
                if isinstance(stored, PublishedDataBlockStoredResult):
                    if query is not None:
                        raise AnalysisKindMismatchError(
                            "Child Analysis Results do not accept queries"
                        )
                    await self._artifacts.ensure_available(lease, record)
                    payload = cast(
                        dict[str, JsonData],
                        stored.model_dump(mode="json"),
                    )
                    payload["kind"] = kind
                    return ResultMaterialization(payload=payload, stored=stored)
                if isinstance(
                    stored,
                    TokenFrequencyStoredResult
                    | SequentialStoredResult
                    | AnnotationRunAllStoredResult,
                ):
                    if query is not None:
                        raise AnalysisKindMismatchError(
                            "Complete Analysis Results do not accept queries"
                        )
                    await self._artifacts.ensure_available(lease, record)
                    payload = cast(
                        dict[str, JsonData],
                        stored.model_dump(mode="json"),
                    )
                    payload["kind"] = kind
                    return ResultMaterialization(payload=payload, stored=stored)
                if isinstance(
                    stored,
                    ConcordanceRunAllStoredResult
                    | QuotationRunAllStoredResult
                    | DataBlockCreationStoredResult,
                ):
                    if query is not None:
                        raise AnalysisKindMismatchError(
                            "Run All Results do not accept Preview queries"
                        )
                    await self._artifacts.ensure_available(lease, record)
                    payload = cast(
                        dict[str, JsonData],
                        stored.model_dump(mode="json"),
                    )
                    payload["kind"] = kind
                    return ResultMaterialization(payload=payload, stored=stored)
                if query is None and isinstance(stored, PreviewReadyStoredResult):
                    payload = cast(
                        dict[str, JsonData],
                        stored.model_dump(mode="json"),
                    )
                    payload["kind"] = kind
                    return ResultMaterialization(
                        payload=payload,
                        stored=stored,
                    )
                effective_query = query or _default_query(kind)
                if effective_query.kind != kind:
                    raise AnalysisKindMismatchError(
                        "Result query kind does not match the Analysis"
                    )
                request = record.request.model_copy(deep=True)
                await self._artifacts.ensure_available(lease, record)

                if isinstance(
                    effective_query,
                    ConcordanceResultQuery | AnnotationResultQuery,
                ):
                    input_snapshot = await self._create_query_snapshot(lease, record)

            if isinstance(effective_query, TopicModelingResultQuery):
                topic_stored = TopicModelingStoredResult.model_validate(stored)
                context_path: Path | None = None
                context_identity = topic_stored.clustering_context.artifact
                if context_identity is not None:
                    reference = next(
                        (
                            item
                            for item in record.artifact_references
                            if item.name == context_identity.name
                        ),
                        None,
                    )
                    if reference is not None:
                        context_path = (
                            lease.path
                            / "analyses"
                            / str(record.id)
                            / reference.relative_path
                        )
                return ResultMaterialization(
                    payload=await self._run_sync(
                        _query_topics,
                        topic_stored,
                        effective_query,
                        context_path,
                        self._topic_projection_cache,
                        user_id,
                        workspace_id,
                        analysis_id,
                    ),
                    stored=stored,
                )
            if isinstance(effective_query, ConcordanceResultQuery) and isinstance(
                request,
                ConcordanceAnalysisRequest,
            ):
                if input_snapshot is None:
                    raise RuntimeError("Concordance query input was not prepared")
                return ResultMaterialization(
                    payload=await self._run_sync(
                        _query_concordance_snapshot,
                        input_snapshot.path,
                        request,
                        effective_query,
                        str(tokens_cache_path(self._cache_root(user_id))),
                        ConcordanceStoredResult.model_validate(stored),
                    ),
                    stored=stored,
                )
            if isinstance(effective_query, AnnotationResultQuery) and isinstance(
                request,
                AnnotationAnalysisRequest,
            ):
                if input_snapshot is None:
                    raise RuntimeError("Annotation query input was not prepared")
                credential = await self._credentials.resolve_annotation_provider(
                    request,
                    supplied=effective_query.api_key,
                )
                payload = await _query_annotation_snapshot(
                    input_snapshot.path,
                    request,
                    effective_query,
                    credential,
                )
                return ResultMaterialization(payload=payload, stored=stored)
            raise AnalysisKindMismatchError(
                "Result query kind does not match the Analysis"
            )
        finally:
            with anyio.CancelScope(shield=True):
                if input_snapshot is not None:
                    await self._cleanup_query_snapshot(input_snapshot)

    async def _create_query_snapshot(
        self,
        lease: WorkspaceLease,
        record: AnalysisRecord,
    ) -> _QueryInputSnapshot:
        if record.query_snapshot is None:
            raise AnalysisResultUnavailableError(
                "Analysis Result query input is unavailable"
            )
        reservation = await self._storage_admission.acquire_transient(
            self._settings.max_analysis_storage_bytes
        )
        root = self._query_root / f"query-{uuid.uuid4()}"
        snapshot = root / "input"
        try:
            await self._run_sync(
                partial(
                    clone_worker_input_snapshot,
                    lease.path / record.query_snapshot.relative_path,
                    snapshot,
                    max_snapshot_bytes=self._settings.max_analysis_storage_bytes,
                )
            )
            return _QueryInputSnapshot(snapshot, root, reservation)
        except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
            with anyio.CancelScope(shield=True):
                await self._run_sync(_remove_query_root, root)
                await reservation.release()
            raise AnalysisResultUnavailableError(
                "Analysis Result query input is unavailable"
            ) from exc
        except BaseException:
            with anyio.CancelScope(shield=True):
                await self._run_sync(_remove_query_root, root)
                await reservation.release()
            raise

    async def _cleanup_query_snapshot(self, snapshot: _QueryInputSnapshot) -> None:
        try:
            await self._run_sync(_remove_query_root, snapshot.root)
        finally:
            await snapshot.reservation.release()

    async def _run_sync(
        self,
        function: Callable[..., T],
        *args: object,
    ) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _default_query(kind: str) -> AnalysisResultQuery:
    if kind == "topic_modeling":
        return TopicModelingResultQuery()
    if kind == "concordance":
        return ConcordanceResultQuery()
    if kind == "annotation":
        return AnnotationResultQuery()
    raise AnalysisCorruptError("Analysis data is corrupt")



def _paged_table_artifact(
    stored: BaseModel,
    table_id: str,
) -> StoredArtifactIdentity:
    raise ArtifactGoneError("Analysis Result table is unavailable")


def _projected_table_source(
    stored: BaseModel,
    table_id: str,
) -> RunAllSourceTable[StoredArtifactIdentity]:
    source = None
    if isinstance(stored, ConcordanceRunAllStoredResult):
        source = stored.source
    elif isinstance(stored, QuotationRunAllStoredResult):
        source = stored.source
    if (
        source is None
        or not isinstance(source.table, ProjectedTableIdentity)
        or source.table.table_id != table_id
    ):
        raise ArtifactGoneError("Analysis Result table is unavailable")
    return source


def _paged_artifact_lazyframe(path: Path) -> pl.LazyFrame:
    return pl.scan_parquet(path)


def _paged_artifact_page(
    path: Path,
    page: int,
    page_size: int,
    sort_by: str | None,
    descending: bool,
) -> IpcTablePage:
    if page < 1 or page_size < 1:
        raise InvalidInputError("Page and page size must be positive")
    lazyframe = _paged_artifact_lazyframe(path)
    schema = lazyframe.collect_schema()
    topic_count = _topic_distribution_topic_count(schema)
    if sort_by is not None:
        if sort_by not in schema:
            raise InvalidInputError("Table sort column not found")
        lazyframe = lazyframe.sort(sort_by, descending=descending)
    frame = lazyframe.slice((page - 1) * page_size, page_size + 1).collect()
    has_next = len(frame) > page_size
    frame = _apply_topic_extension(frame.head(page_size), topic_count)
    return IpcTablePage(content=encode_ipc_stream(frame), has_next=has_next)


def _paged_artifact_schema(path: Path) -> bytes:
    schema = _paged_artifact_lazyframe(path).collect_schema()
    if TOPIC_DISTRIBUTION_COLUMN in schema:
        schema[TOPIC_DISTRIBUTION_COLUMN] = topic_distribution_dtype(
            _topic_distribution_topic_count(schema)
        )
    return encode_schema_stream(schema)


def _projected_artifact_lazyframe(
    path: Path,
    kind: str,
    row_unit: str,
) -> pl.LazyFrame:
    if row_unit not in {"documents", "matches"}:
        raise InvalidInputError("Result row unit is invalid")
    frame = pl.scan_parquet(path)
    if row_unit == "documents":
        return frame
    if kind == "concordance_run_all":
        return frame.explode("concordance").unnest("concordance")
    if kind == "quotation_run_all":
        return frame.explode("quotation").unnest("quotation").rename(
            {column.removeprefix("QUOTE_"): column for column in QUOTE_COLUMN_NAMES},
            strict=False,
        )
    raise AnalysisKindMismatchError("Analysis Result table is not projected")


def _projected_artifact_page(
    path: Path,
    kind: str,
    row_unit: str,
    document_column: str,
    metadata_columns: list[str],
    analysis_columns: list[str],
    page: int,
    page_size: int,
    sort_by: str | None,
    descending: bool,
) -> IpcTablePage:
    """Return one document or match page from a materialized Result artifact.

    Used by: ``AnalysisResultService.projected_table_page`` for Concordance and
    Quotation Review tables. Concordance match rows may sort by any public scalar
    artifact field because Run All has already materialized the complete Result;
    the other projections retain their narrower source-column contract.

    Flow: validate the requested public sort field, apply either that direct sort
    or the projection's deterministic default order, then collect one Arrow page.
    """

    if page < 1 or page_size < 1:
        raise InvalidInputError("Page and page size must be positive")
    frame = _projected_artifact_lazyframe(path, kind, row_unit)
    schema = frame.collect_schema()
    concordance_match_projection = (
        kind == "concordance_run_all" and row_unit == "matches"
    )
    sortable_columns = (
        {
            column
            for column in {document_column, *metadata_columns, *analysis_columns}
            if column in schema
            and not schema[column].is_nested()
            and schema[column] != pl.Object
        }
        if concordance_match_projection
        else {document_column, *metadata_columns}
    )
    if sort_by is not None and sort_by not in sortable_columns:
        raise InvalidInputError("Result sort column not found")

    stable_columns = ["__wordflow_source_row_id"]
    if row_unit == "matches":
        stable_columns.append(
            CONC_START_IDX_COLUMN
            if kind == "concordance_run_all"
            else QUOTE_ROW_IDX_COLUMN
        )
    if sort_by is not None and concordance_match_projection:
        # Review deliberately exposes Polars' direct, case-sensitive scalar
        # ordering. Equal-key order is unspecified; no hidden secondary keys are
        # added to the user's requested sort.
        frame = frame.sort(sort_by, descending=descending)
    else:
        order = [sort_by, *stable_columns] if sort_by is not None else stable_columns
        order = [column for column in order if column in schema]
        frame = frame.sort(
            order,
            descending=[descending, *([False] * (len(order) - 1))]
            if sort_by is not None
            else False,
        )
    page_frame = frame.slice((page - 1) * page_size, page_size + 1).collect()
    has_next = page_frame.height > page_size
    return IpcTablePage(
        content=encode_ipc_stream(page_frame.head(page_size)),
        has_next=has_next,
    )


def _projected_artifact_schema(path: Path, kind: str, row_unit: str) -> bytes:
    schema = _projected_artifact_lazyframe(path, kind, row_unit).collect_schema()
    return encode_schema_stream(schema)


def _concordance_document_projection_page(
    path: Path,
    document_column: str,
    metadata_columns: list[str],
    query: ConcordanceDocumentProjectionQuery,
) -> IpcTablePage:
    frame = filter_concordance_documents(
        pl.scan_parquet(path),
        document_column=document_column,
        excluded_matched_texts=query.excluded_matched_texts,
        bin_count=query.bin_count,
        selected_bins=query.selected_bins,
    )
    schema = frame.collect_schema()
    sortable_columns = {document_column, *metadata_columns}
    if query.sort_by is not None and query.sort_by not in sortable_columns:
        raise InvalidInputError("Result sort column not found")
    order = (
        [query.sort_by, "__wordflow_source_row_id"]
        if query.sort_by is not None
        else ["__wordflow_source_row_id"]
    )
    order = [column for column in order if column in schema]
    frame = frame.sort(
        order,
        descending=[query.descending, False]
        if query.sort_by is not None
        else False,
    )
    total_rows = frame.select(pl.len()).collect().item()
    page_frame = frame.slice(
        (query.page - 1) * query.page_size, query.page_size + 1
    ).collect()
    return IpcTablePage(
        content=encode_ipc_stream(page_frame.head(query.page_size)),
        has_next=page_frame.height > query.page_size,
        total_rows=total_rows,
    )


def _concordance_density(
    path: Path,
    document_column: str,
) -> ConcordanceDensityResult:
    rows = (
        pl.scan_parquet(path)
        .select(document_column, "concordance")
        .collect()
        .to_dicts()
    )
    series: dict[str, list[int]] = {}
    match_count = 0
    for row in rows:
        document = str(row.get(document_column) or "")
        document_length = max(len(document), 1)
        for match in row.get("concordance") or []:
            if not isinstance(match, dict):
                continue
            label = str(match.get(CONC_MATCHED_TEXT_COLUMN) or "")
            start_index = int(match.get(CONC_START_IDX_COLUMN) or 0)
            bin_index = min(99, max(0, start_index * 100 // document_length))
            counts = series.setdefault(label, [0] * 100)
            counts[bin_index] += 1
            match_count += 1
    return ConcordanceDensityResult(
        document_count=len(rows),
        match_count=match_count,
        series=[
            {"label": label, "counts": counts}
            for label, counts in sorted(series.items())
        ],
    )


def _topic_distribution_topic_count(schema: pl.Schema) -> int:
    if TOPIC_DISTRIBUTION_COLUMN not in schema:
        return 0
    try:
        return topic_count_from_storage_dtype(schema[TOPIC_DISTRIBUTION_COLUMN])
    except ValueError as exc:
        raise AnalysisCorruptError(
            "Analysis Topic Distribution artifact has an invalid schema"
        ) from exc


def _apply_topic_extension(frame: pl.DataFrame, topic_count: int) -> pl.DataFrame:
    if TOPIC_DISTRIBUTION_COLUMN not in frame:
        return frame
    return frame.with_columns(
        pl.Series(
            TOPIC_DISTRIBUTION_COLUMN,
            frame[TOPIC_DISTRIBUTION_COLUMN].to_list(),
            dtype=topic_distribution_dtype(topic_count),
        )
    )


def _sort_and_page(
    rows: list[dict[str, JsonData]],
    *,
    page: int,
    page_size: int,
    sort_by: str | None,
    descending: bool,
    columns: set[str],
) -> tuple[list[dict[str, JsonData]], dict[str, JsonData]]:
    rows = _sort_rows(rows, sort_by=sort_by, descending=descending, columns=columns)
    total = len(rows)
    start = (page - 1) * page_size
    return rows[start : start + page_size], {
        "page": page,
        "page_size": page_size,
        "total_rows": total,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


def _sort_rows(
    rows: list[dict[str, JsonData]],
    *,
    sort_by: str | None,
    descending: bool,
    columns: set[str],
) -> list[dict[str, JsonData]]:
    """Sort a complete JSON result while keeping nulls last."""

    if sort_by is not None:
        if sort_by not in columns:
            raise InvalidInputError("Result sort column not found")
        present = [row for row in rows if row.get(sort_by) is not None]
        missing = [row for row in rows if row.get(sort_by) is None]
        present.sort(
            key=lambda row: _json_sort_key(row[sort_by]),
            reverse=descending,
        )
        rows = [*present, *missing]
    return rows


def _json_sort_key(value: JsonData) -> tuple[int, int | float | str]:
    """Order one non-null JSON scalar without stringifying numeric values."""

    if isinstance(value, bool):
        return 0, int(value)
    if isinstance(value, int | float):
        return 1, value
    if isinstance(value, str):
        return 2, value
    return 3, json.dumps(value, sort_keys=True, separators=(",", ":"))


def _query_topics(
    stored: TopicModelingStoredResult,
    query: TopicModelingResultQuery,
    context_path: Path | None,
    projection_cache: TopicProjectionBasisCache | None = None,
    user_id: str = "test-user",
    workspace_id: str = "test-workspace",
    analysis_id: str = "test-analysis",
) -> dict[str, JsonData]:
    requested_count = query.cluster_count
    natural_count = stored.clustering.default_cluster_count
    applied_count = natural_count if requested_count is None else requested_count
    minimum = stored.clustering.min_cluster_count
    maximum = stored.clustering.max_cluster_count
    if applied_count < minimum or applied_count > maximum:
        raise InvalidClusterCountError(
            "Number of clusters is outside the supported range",
            details={
                "min_cluster_count": minimum,
                "max_cluster_count": maximum,
                "default_cluster_count": natural_count,
            },
        )
    requested_top_n = query.top_n_topics
    try:
        inclusion = topic_inclusion_descriptor(applied_count, requested_top_n)
    except ValueError as exc:
        bounds = topic_inclusion_descriptor(applied_count)
        raise InvalidTopicTopNError(
            "Top topics per row is outside the supported range",
            details={
                "min_top_n_topics": bounds["min_top_n_topics"],
                "max_top_n_topics": bounds["max_top_n_topics"],
                "default_top_n_topics": bounds["default_top_n_topics"],
                "cluster_count": applied_count,
            },
        ) from exc
    applied_top_n = int(inclusion["top_n_topics"])
    effective = stored
    if requested_count is not None or requested_top_n is not None:
        if context_path is None or not context_path.is_file():
            raise ArtifactGoneError("Topic clustering context is unavailable")
        try:
            metadata = context_path.stat()
        except OSError as exc:
            raise ArtifactGoneError(
                "Topic clustering context is unavailable"
            ) from exc
        try:
            cache_key = TopicProjectionCacheKey(
                user_id=user_id,
                workspace_id=workspace_id,
                analysis_id=analysis_id,
                context_path=str(context_path.resolve()),
                context_inode=metadata.st_ino,
                context_size=metadata.st_size,
                context_mtime_ns=metadata.st_mtime_ns,
                cluster_count=applied_count,
            )

            def build_basis() -> bytes:
                try:
                    context_bytes = context_path.read_bytes()
                except OSError as exc:
                    raise ArtifactGoneError(
                        "Topic clustering context is unavailable"
                    ) from exc
                basis = _project_rust_topic_projection_basis(
                    clustering_context=context_bytes,
                    cluster_count=applied_count,
                    corpus_sizes=stored.corpus_sizes,
                )
                return _encode_topic_projection_basis(basis)

            basis_bytes = (
                projection_cache.get_or_build(cache_key, build_basis)
                if projection_cache is not None
                else build_basis()
            )
            projection = _build_topic_projection_payload(
                basis=_decode_topic_projection_basis(basis_bytes),
                node_infos=[
                    source.model_dump(mode="json") for source in stored.sources
                ],
                corpus_sizes=stored.corpus_sizes,
                top_n_topics=applied_top_n,
            )
            effective = TopicModelingStoredResult.model_validate(
                {
                    **stored.model_dump(mode="json"),
                    "topics": projection["topics"],
                    "per_corpus_topic_counts": projection["per_corpus_topic_counts"],
                    "topic_inclusion": projection["topic_inclusion"],
                    "meta": {
                        **stored.meta.model_dump(mode="json"),
                        **projection["meta"],
                    },
                    "clustering": {
                        **stored.clustering.model_dump(mode="json"),
                        "cluster_count": applied_count,
                    },
                }
            )
        except ArtifactGoneError:
            raise
        except Exception as exc:
            raise AnalysisCorruptError("Topic clustering context is corrupt") from exc
    payload = cast(
        dict[str, JsonData],
        effective.model_dump(mode="json", exclude={"clustering_context"}),
    )
    rows = [
        cast(dict[str, JsonData], topic.model_dump(mode="json"))
        for topic in effective.topics
    ]
    if query.topic_ids is not None:
        selected = set(query.topic_ids)
        rows = [row for row in rows if row.get("id") in selected]
    columns = (
        set(rows[0])
        if rows
        else set(type(effective.topics[0]).model_fields)
        if effective.topics
        else set()
    )
    rows = _sort_rows(
        rows,
        sort_by=query.sort_by,
        descending=query.descending,
        columns=columns,
    )
    payload["kind"] = "topic_modeling"
    payload["topics"] = cast(JsonData, rows)
    payload["query"] = cast(JsonData, query.model_dump(mode="json"))
    return payload


def _query_concordance_snapshot(
    snapshot_dir: Path,
    request: ConcordanceAnalysisRequest,
    query: ConcordanceResultQuery,
    token_cache: str,
    stored: ConcordanceStoredResult,
) -> dict[str, JsonData]:
    node_ids = [query.node_id] if query.node_id is not None else request.node_ids
    if any(node_id not in request.node_ids for node_id in node_ids):
        raise NodeNotFoundError("Analysis Result Data Block not found")
    request_payload = request.model_dump(mode="json", exclude={"kind"})
    sources: list[JsonData] = []
    for node_id in node_ids:
        snapshot = load_snapshot_node(snapshot_dir, str(node_id))
        column = request.node_columns[node_id]
        node_data = snapshot.data
        tokenization_column: str | None = None
        if request.search_mode == "tokens":
            node_data, tokenization_column = tokenize_lazyframe(
                data=node_data,
                source_column=column,
                model=request.node_tokenizer_models[node_id],
                cache_path=token_cache,
            )
        sources.append(
            cast(
                JsonData,
                {
                    "node_id": str(node_id),
                    "node_name": snapshot.name,
                    "result": compute_node_concordance_page(
                        {
                            "lf": node_data,
                            "column": column,
                            "label": snapshot.name,
                            "tokenization_column": tokenization_column,
                        },
                        request_payload,
                        page=query.page,
                        page_size=query.page_size,
                        sort_by=query.sort_by,
                        descending=query.descending,
                    ),
                },
            )
        )
    payload = cast(dict[str, JsonData], stored.model_dump(mode="json"))
    payload["kind"] = "concordance"
    payload["sources"] = sources
    payload["query"] = cast(JsonData, query.model_dump(mode="json"))
    return payload


async def _query_annotation_snapshot(
    snapshot_dir: Path,
    request: AnnotationAnalysisRequest,
    query: AnnotationResultQuery,
    credential: str | None,
) -> dict[str, JsonData]:
    source = load_snapshot_node(snapshot_dir, str(request.node_id))
    schema = source.data.collect_schema()
    columns = [request.text_column, request.annotation_column]
    if request.correction_column is not None:
        columns.append(request.correction_column)
    for column in columns:
        if column not in schema:
            raise InvalidInputError("Annotation Preview column does not exist")
    start = (query.page - 1) * query.page_size
    total_rows = int(source.data.select(pl.len()).collect().item())
    page = (
        source.data.select(request.text_column, request.annotation_column)
        .slice(start, query.page_size)
        .collect()
    )
    texts = [
        str(value) if value is not None else ""
        for value in page.get_column(request.text_column).to_list()
    ]
    examples = []
    if request.example_node_id is not None:
        assert request.example_text_column is not None
        assert request.example_annotation_column is not None
        example = load_snapshot_node(snapshot_dir, str(request.example_node_id))
        example_frame = example.data.select(
            request.example_text_column,
            request.example_annotation_column,
        ).collect()
        examples = prepare_annotation_examples(
            example_frame.iter_rows(),
            max_examples_per_class=request.max_examples_per_class,
            sampling_method=request.example_sampling_method,
            random_seed=request.example_random_seed,
        )
    try:
        labels = await annotate_preview(
            request,
            credential,
            texts,
            examples,
        )
    except AnnotationAiError as exc:
        raise AnnotationProviderError(exc.code, exc.safe_message) from exc
    rows = cast(list[dict[str, JsonData]], page.to_dicts())
    return cast(
        dict[str, JsonData],
        {
            "kind": "annotation",
            "ready": True,
            "node_id": str(request.node_id),
            "page": query.page,
            "page_size": query.page_size,
            "total_rows": total_rows,
            "rows": rows,
            "labels": [
                {"row_index": start + offset, "label": label}
                for offset, label in enumerate(labels)
            ],
            "query": query.model_dump(mode="json", exclude={"api_key"}),
        },
    )


def _remove_query_root(root: Path) -> None:
    try:
        if root.is_dir() and not root.is_symlink():
            shutil.rmtree(root)
        elif root.exists() or root.is_symlink():
            root.unlink()
    except FileNotFoundError:
        return


__all__ = ["AnalysisResultService", "ResultMaterialization"]
