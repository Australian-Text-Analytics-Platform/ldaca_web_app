"""Runtime node resource service layered on the single workspace mutation gate."""

from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

import anyio
import polars as pl
from anyio.to_thread import run_sync as run_sync_in_worker_thread
from ..domain.workspace import Node, Workspace

from ..infrastructure.storage.data_loading import (
    DataFileLoadError,
    materialize_data_file,
    normalize_dtypes,
)
from ..shared.errors import (
    DataBlockInUseError,
    InvalidInputError,
    NodeNotFoundError,
    ResourceConflictError,
    ResourceTooLargeError,
)
from ..infrastructure.storage.bounded_io import write_parquet_bounded
from ..shared.table_transport import (
    IpcTablePage,
    encode_schema_stream,
    materialize_page,
)
from .user_files import UserFileStore
from ..models.node_resources import (
    FileNodeCreateRequest,
    NodeCreateRequest,
    NodeDerivationRequest,
    NodeEditRequest,
    NodeUpdateRequest,
)
from ..models.workspace import WorkspaceNodeInfo
from .node_operations import (
    build_derived_lazyframe,
    build_derived_node,
    build_edited_lazyframe,
)
from .node_projection import canonical_node_info
from ..infrastructure.storage.layout import (
    NODE_SOURCE_STAGING_PREFIX,
    NODE_SOURCE_STAGING_SUFFIX,
    validate_display_name,
)
from ..infrastructure.storage.durable_fs import fsync_directory as _fsync_directory
from .storage_admission import StorageAdmissionService
from .workspace import WorkspaceService

T = TypeVar("T")


class NodeService:
    """Own node reads/mutations while ``WorkspaceService`` owns persistence."""

    def __init__(
        self,
        workspaces: WorkspaceService,
        files: UserFileStore,
        *,
        storage_admission: StorageAdmissionService,
        io_limiter: anyio.CapacityLimiter,
        max_source_bytes: int,
        max_storage_bytes: int,
    ) -> None:
        self._workspaces = workspaces
        self._files = files
        self._storage_admission = storage_admission
        self._io_limiter = io_limiter
        self._max_source_bytes = max_source_bytes
        self._max_storage_bytes = max_storage_bytes

    async def create(
        self,
        user_id: str,
        workspace_id: str,
        request: NodeCreateRequest,
    ) -> tuple[WorkspaceNodeInfo, int]:
        """Create a file source or immutable derived node and commit once."""

        if isinstance(request, FileNodeCreateRequest):
            return await self._create_from_file(
                user_id,
                workspace_id,
                request,
            )
        return await self._create_derived(
            user_id,
            workspace_id,
            request,
        )

    async def _create_from_file(
        self,
        user_id: str,
        workspace_id: str,
        request: FileNodeCreateRequest,
    ) -> tuple[WorkspaceNodeInfo, int]:
        """Snapshot a user file, stage parquet, add a node, and commit once."""

        reservation = await self._storage_admission.acquire(
            user_id,
            self._max_storage_bytes,
            requested_entries=1,
        )
        try:
            return await self._create_from_file_admitted(
                user_id,
                workspace_id,
                request,
            )
        finally:
            with anyio.CancelScope(shield=True):
                await reservation.release()

    async def _create_from_file_admitted(
        self,
        user_id: str,
        workspace_id: str,
        request: FileNodeCreateRequest,
    ) -> tuple[WorkspaceNodeInfo, int]:
        """Create one source node after durable storage has been reserved."""

        async with self._files.read_path(user_id, request.file_path) as source_path:
            metadata = await self._run_io(source_path.stat)
            if metadata.st_size > self._max_source_bytes:
                raise ResourceTooLargeError("File is too large for node ingestion")
            try:
                dataframe, dtype_changes = await self._run_io(
                    _load_dataframe,
                    source_path,
                    request.sheet_name,
                )
            except DataFileLoadError as exc:
                raise InvalidInputError("User file could not be loaded") from exc
        node_name = (request.name or _node_name_from_path(request.file_path)).strip()
        valid, reason = validate_display_name(node_name)
        if not valid:
            raise InvalidInputError(f"Invalid node name: {reason}")

        staged_path: Path | None = None
        node_id = str(uuid.uuid4())
        try:
            async with self._workspaces.mutation_context(
                user_id,
                workspace_id,
            ) as lease:
                lazyframe, staged_path = await self._run_io(
                    _stage_dataframe,
                    dataframe,
                    lease.path,
                    node_id,
                    self._max_storage_bytes,
                )
                node = Node(
                    data=lazyframe,
                    name=node_name,
                    id=node_id,
                )
                lease.workspace.add_node(node)
                info = await self._run_io(canonical_node_info, node)
                if dtype_changes:
                    info["dtype_normalization"] = dtype_changes
            return WorkspaceNodeInfo.model_validate(info), lease.revision
        except BaseException:
            if staged_path is not None:
                with anyio.CancelScope(shield=True):
                    await self._run_io(_unlink, staged_path)
            raise

    async def _create_derived(
        self,
        user_id: str,
        workspace_id: str,
        request: NodeDerivationRequest,
    ) -> tuple[WorkspaceNodeInfo, int]:
        """Build and attach a derived node while the sole mutation gate is held."""

        async with self._workspaces.mutation_context(
            user_id,
            workspace_id,
        ) as lease:
            node = await self._run_io(build_derived_node, lease.workspace, request)
            info = await self._run_io(canonical_node_info, node)
        return WorkspaceNodeInfo.model_validate(info), lease.revision

    async def preview(
        self,
        user_id: str,
        workspace_id: str,
        request: NodeDerivationRequest,
        *,
        page: int,
        page_size: int,
    ) -> tuple[IpcTablePage, int]:
        """Materialize an operation preview without mutating or advancing revision."""

        async with self._workspaces.submission_context(
            user_id,
            workspace_id,
        ) as lease:
            response = await self._run_io(
                _preview_derivation,
                lease.workspace,
                request,
                page,
                page_size,
            )
            return response, lease.revision

    async def list_nodes(
        self,
        user_id: str,
        workspace_id: str,
    ) -> tuple[list[WorkspaceNodeInfo], int]:
        """Return the complete ordered Data Block graph projection."""

        async with self._workspaces.read_context(user_id, workspace_id) as lease:
            records = [
                WorkspaceNodeInfo.model_validate(
                    await self._run_io(canonical_node_info, node)
                )
                for node in lease.workspace.nodes.values()
            ]
            return records, lease.revision

    async def get(
        self,
        user_id: str,
        workspace_id: str,
        node_id: str,
    ) -> tuple[WorkspaceNodeInfo, int]:
        async with self._workspaces.read_context(user_id, workspace_id) as lease:
            node = lease.workspace.nodes.get(node_id)
            if node is None:
                raise NodeNotFoundError("Node not found")
            info = await self._run_io(canonical_node_info, node)
            return WorkspaceNodeInfo.model_validate(info), lease.revision

    async def update(
        self,
        user_id: str,
        workspace_id: str,
        node_id: str,
        request: NodeUpdateRequest,
    ) -> tuple[WorkspaceNodeInfo, int]:
        async with self._workspaces.mutation_context(
            user_id,
            workspace_id,
        ) as lease:
            node = lease.workspace.nodes.get(node_id)
            if node is None:
                raise NodeNotFoundError("Node not found")
            if node_id in lease.workspace.reserved_node_ids():
                raise DataBlockInUseError("Data Block is reserved by an Analysis")
            changed = False
            if "name" in request.model_fields_set:
                assert request.name is not None
                normalized_name = request.name.strip()
                valid, reason = validate_display_name(normalized_name)
                if not valid:
                    raise InvalidInputError(f"Invalid node name: {reason}")
                if node.name != normalized_name:
                    node.name = normalized_name
                    changed = True
            if "document" in request.model_fields_set:
                normalized_document = request.document or None
                if normalized_document:
                    columns = set(await self._run_io(_schema_names, node.data))
                if normalized_document and normalized_document not in columns:
                    raise InvalidInputError(
                        "Document column is not present on the node"
                    )
                if node.document != normalized_document:
                    node.document = normalized_document
                    changed = True
            if "color" in request.model_fields_set:
                normalized_color = request.color or None
                if node.color != normalized_color:
                    node.color = normalized_color
                    changed = True
            if "tokenizer_model" in request.model_fields_set:
                if node.tokenizer_model != request.tokenizer_model:
                    node.tokenizer_model = request.tokenizer_model
                    changed = True
            lease.commit_requested = changed
            info = await self._run_io(canonical_node_info, node)
        return WorkspaceNodeInfo.model_validate(info), lease.revision

    async def edit(
        self,
        user_id: str,
        workspace_id: str,
        node_id: str,
        request: NodeEditRequest,
    ) -> tuple[WorkspaceNodeInfo, int]:
        """Replace one Data Block plan without changing its graph identity."""

        async with self._workspaces.mutation_context(
            user_id,
            workspace_id,
        ) as lease:
            node = _editable_node(lease.workspace, node_id)
            lazyframe, renamed_column = await self._run_io(
                build_edited_lazyframe,
                node,
                request,
            )
            if lazyframe is node.data:
                lease.commit_requested = False
            else:
                await self._run_io(_validate_edit_schema, lazyframe)
                node.data = lazyframe
                if renamed_column is not None:
                    _retarget_column_metadata(node, *renamed_column)
                await self._run_io(_reconcile_node_metadata, node)
            info = await self._run_io(canonical_node_info, node)
        return WorkspaceNodeInfo.model_validate(info), lease.revision

    async def undo(
        self,
        user_id: str,
        workspace_id: str,
        node_id: str,
    ) -> tuple[WorkspaceNodeInfo, int]:
        """Restore one Data Block's previous runtime plan."""

        return await self._move_history(
            user_id,
            workspace_id,
            node_id,
            redo=False,
        )

    async def redo(
        self,
        user_id: str,
        workspace_id: str,
        node_id: str,
    ) -> tuple[WorkspaceNodeInfo, int]:
        """Restore one Data Block's next runtime plan."""

        return await self._move_history(
            user_id,
            workspace_id,
            node_id,
            redo=True,
        )

    async def _move_history(
        self,
        user_id: str,
        workspace_id: str,
        node_id: str,
        *,
        redo: bool,
    ) -> tuple[WorkspaceNodeInfo, int]:
        async with self._workspaces.mutation_context(
            user_id,
            workspace_id,
        ) as lease:
            node = _editable_node(lease.workspace, node_id)
            moved = node.redo_data() if redo else node.undo_data()
            if not moved:
                action = "redo" if redo else "undo"
                raise ResourceConflictError(f"Nothing to {action}")
            await self._run_io(_validate_edit_schema, node.data)
            await self._run_io(_reconcile_node_metadata, node)
            info = await self._run_io(canonical_node_info, node)
        return WorkspaceNodeInfo.model_validate(info), lease.revision

    async def delete(
        self,
        user_id: str,
        workspace_id: str,
        node_id: str,
    ) -> int:
        async with self._workspaces.mutation_context(
            user_id,
            workspace_id,
        ) as lease:
            affected = lease.workspace.node_removal_affected_ids(node_id)
            if not affected:
                raise NodeNotFoundError("Node not found")
            if affected & lease.workspace.reserved_node_ids():
                raise DataBlockInUseError("Data Block is reserved by an Analysis")
            if not lease.workspace.remove_node(node_id):
                raise NodeNotFoundError("Node not found")
        return lease.revision

    async def schema(
        self,
        user_id: str,
        workspace_id: str,
        node_id: str,
    ) -> tuple[bytes, int]:
        """Return one Data Block schema as a zero-row IPC stream."""

        async with self._workspaces.read_context(user_id, workspace_id) as lease:
            node = lease.workspace.nodes.get(node_id)
            if node is None:
                raise NodeNotFoundError("Node not found")
            content = await self._run_io(
                encode_schema_stream,
                node.data.collect_schema(),
            )
            return content, lease.revision

    async def _run_io(
        self,
        function: Callable[..., T],
        *args: Any,
    ) -> T:
        return await run_sync_in_worker_thread(
            function,
            *args,
            abandon_on_cancel=False,
            limiter=self._io_limiter,
        )


def _load_dataframe(
    path: Path, sheet_name: str | None
) -> tuple[pl.DataFrame, list[dict[str, str]]]:
    """Fully infer and materialize one source before canonical normalization.

    Called by ``NodeService._create_from_file_admitted`` at its worker-thread
    I/O boundary. Inference establishes the source schema; only subsequent
    canonical casts belong in the returned normalization change log.
    """
    data = materialize_data_file(path, sheet_name=sheet_name)
    frame, changes = normalize_dtypes(data)
    return frame, changes


def _node_name_from_path(relative_path: str) -> str:
    path = Path(relative_path)
    return path.stem or path.name


def _stage_dataframe(
    dataframe: pl.DataFrame,
    workspace_path: Path,
    node_id: str,
    max_storage_bytes: int,
) -> tuple[pl.LazyFrame, Path]:
    data_root = workspace_path / "data"
    data_root.mkdir(parents=True, exist_ok=True)
    path = data_root / f"{node_id}.parquet"
    if path.exists():
        raise ResourceConflictError("Node storage identity already exists")
    descriptor, raw_temporary_path = tempfile.mkstemp(
        prefix=NODE_SOURCE_STAGING_PREFIX,
        suffix=NODE_SOURCE_STAGING_SUFFIX,
        dir=data_root,
    )
    os.close(descriptor)
    temporary_path = Path(raw_temporary_path)
    try:
        with temporary_path.open("wb") as handle:
            write_parquet_bounded(
                dataframe,
                handle,
                max_storage_bytes,
                label="Node data",
            )
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        _fsync_directory(data_root)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise
    return pl.scan_parquet(path.resolve()), path


def _materialize_rows(
    lazyframe: pl.LazyFrame,
    page: int,
    page_size: int,
    sort_by: str | None,
    descending: bool,
) -> IpcTablePage:
    return materialize_page(
        lazyframe,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        descending=descending,
    )


def _preview_derivation(
    workspace: Workspace,
    request: NodeDerivationRequest,
    page: int,
    page_size: int,
) -> IpcTablePage:
    try:
        lazyframe, _name, _operation, _parents = build_derived_lazyframe(
            workspace,
            request,
        )
        return _materialize_rows(lazyframe, page, page_size, None, False)
    except (
        pl.exceptions.ColumnNotFoundError,
        pl.exceptions.InvalidOperationError,
        pl.exceptions.SchemaError,
        pl.exceptions.ShapeError,
    ) as exc:
        raise InvalidInputError(
            "The Data Block operation could not be applied to the selected data"
        ) from exc


def _schema_names(lazyframe: pl.LazyFrame) -> list[str]:
    return lazyframe.collect_schema().names()


def _editable_node(workspace: Workspace, node_id: str) -> Node:
    node = workspace.nodes.get(node_id)
    if node is None:
        raise NodeNotFoundError("Node not found")
    if node_id in workspace.reserved_node_ids():
        raise DataBlockInUseError("Data Block is reserved by an Analysis")
    return node


def _validate_edit_schema(lazyframe: pl.LazyFrame) -> None:
    try:
        lazyframe.collect_schema()
    except Exception as exc:
        raise InvalidInputError(
            "The Data Block Edit does not produce a valid schema"
        ) from exc


def _retarget_column_metadata(node: Node, old_name: str, new_name: str) -> None:
    if node.document == old_name:
        node.document = new_name


def _reconcile_node_metadata(node: Node) -> None:
    columns = set(node.data.collect_schema().names())
    if node.document not in columns:
        node.document = None


def _unlink(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        return
    _fsync_directory(path.parent)
