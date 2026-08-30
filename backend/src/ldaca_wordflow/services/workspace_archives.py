"""Bounded, transactional import and export of workspace ZIP archives.

Used by:
- the workspace archive route, which adapts the bounded raw request body to
  the service's small async stream protocol.

Why:
- ZIP parsing and workspace installation are storage concerns. Keeping them
behind an injected ``WorkspaceArchiveStorage`` interface prevents archive
  code from importing FastAPI or bypassing ``WorkspaceService``.

Flow:
- Stream the request into a bounded seekable file under the user's workspace
  filesystem.
- Validate every central-directory member before extraction, including path,
  type, encryption, name-collision, and expansion limits.
- Extract incrementally into an exclusive hidden staging directory using
  no-follow file creation, verify CRCs by consuming each member, normalize
  metadata, then atomically rename the completed directory into place.
- Refresh the injected storage index only after installation; any failure rolls
  back temporary and installed paths.
"""

from __future__ import annotations

import os
import shutil
import stat
import struct
import tempfile
import unicodedata
import zipfile
from collections import deque
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Protocol, TypeVar, cast
import polars as pl
from ..domain.workspace import (
    AnalysisRecord,
    AnalysisState,
    Node,
    Workspace,
    analysis_snapshot_input_ids,
    referenced_node_ids,
)
from ..infrastructure.storage.workspace_store import (
    WorkspaceCapacityError,
    WorkspaceSchemaVersionError,
    WorkspaceSnapshotInvalidError,
    WorkspaceStore,
)
from pydantic import ValidationError
from ..shared.json_data import JsonData
from ..shared.portable_names import portable_relative_path_parts
from ..models.workspace import WorkspaceArchiveManifest

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..shared.errors import (
    InvalidWorkspaceArchiveError,
    UploadTooLargeError,
    WorkspaceNotOpenError,
)
from ..infrastructure.storage.bounded_io import write_parquet_bounded
from ..infrastructure.storage.durable_fs import (
    atomic_write_json as _atomic_json_write,
    fsync_directory as _fsync_directory,
    fsync_file as _fsync_file,
)
from ..infrastructure.storage.layout import (
    SAFE_WORKSPACE_IMPORT_MARKER,
    SAFE_WORKSPACE_IMPORT_MARKER_CONTENT,
    validate_workspace_name,
)
from ..infrastructure.storage.safe_paths import SafePathResolver
from .storage_admission import StorageAdmissionService, StorageReservation
from .user_files import AsyncUploadSource
from .response_snapshots import ResponseSnapshot, ResponseSnapshotService
from ..workers.input_snapshots import (
    create_worker_input_snapshot,
    load_snapshot_node,
)

T = TypeVar("T")


class WorkspaceArchiveStorage(Protocol):
    """The final-install boundary owned by ``WorkspaceService``."""

    def workspace_staging_root(self) -> Path: ...

    def submission_context(
        self,
        user_id: str,
        workspace_id: str,
    ) -> AbstractAsyncContextManager[Any]: ...

    async def resolve_owned_workspace_dir(
        self,
        user_id: str,
        workspace_id: str,
    ) -> Path: ...

    async def install_staged_archive(
        self,
        user_id: str,
        staging: Path,
        workspace_name: str,
        reservation: StorageReservation,
    ) -> dict[str, JsonData]: ...


@dataclass(frozen=True, slots=True)
class _PreparedArchive:
    staging: Path
    workspace_name: str


@dataclass(frozen=True, slots=True)
class WorkspaceArchiveLimits:
    """Hard bounds checked before and while expanding an uploaded archive."""

    max_archive_bytes: int = 512 * 1024 * 1024
    max_members: int = 10_000
    max_compressed_member_bytes: int = 256 * 1024 * 1024
    max_member_bytes: int = 2 * 1024 * 1024 * 1024
    max_expanded_bytes: int = 10 * 1024 * 1024 * 1024
    max_compression_ratio: float = 1_000.0
    max_manifest_bytes: int = 4 * 1024 * 1024
    max_parent_edges: int = 50_000
    max_central_directory_bytes: int = 16 * 1024 * 1024

    def __post_init__(self) -> None:
        values = (
            self.max_archive_bytes,
            self.max_members,
            self.max_compressed_member_bytes,
            self.max_member_bytes,
            self.max_expanded_bytes,
            self.max_manifest_bytes,
            self.max_parent_edges,
            self.max_central_directory_bytes,
        )
        if any(value < 1 for value in values) or self.max_compression_ratio <= 0:
            raise ValueError("Workspace archive limits must be positive")


class WorkspaceArchiveService:
    """Validate/install imports and build response-lifetime exports."""

    def __init__(
        self,
        storage: WorkspaceArchiveStorage,
        *,
        workspace_store: WorkspaceStore,
        response_snapshots: ResponseSnapshotService,
        storage_admission: StorageAdmissionService,
        max_export_bytes: int,
        limits: WorkspaceArchiveLimits,
        limiter: anyio.CapacityLimiter,
        max_concurrent_imports: int = 2,
        upload_chunk_size: int = 1024 * 1024,
        extraction_chunk_size: int = 1024 * 1024,
    ) -> None:
        if (
            upload_chunk_size < 1
            or extraction_chunk_size < 1
            or max_concurrent_imports < 1
        ):
            raise ValueError("Archive chunk sizes must be positive")
        self._storage = storage
        self._workspace_store = workspace_store
        self._response_snapshots = response_snapshots
        self._storage_admission = storage_admission
        self._max_export_bytes = max_export_bytes
        self._import_slots = anyio.Semaphore(max_concurrent_imports)
        self._limits = limits
        self._upload_chunk_size = upload_chunk_size
        self._extraction_chunk_size = extraction_chunk_size
        self._limiter = limiter

    async def export_archive(
        self,
        user_id: str,
        workspace_id: str,
    ) -> tuple[ResponseSnapshot, str, int | None]:
        """Export one Workspace, falling back to a raw ZIP when its schema is incompatible.

        The returned file is immutable and independent of the live workspace,
        so the HTTP adapter releases the gate before ``FileResponse`` streams
        it and owns deletion through a response background task.
        """

        source_reservation = await self._storage_admission.acquire_transient(
            self._max_export_bytes
        )
        source_snapshot: Path | None = None
        try:
            try:
                async with self._storage.submission_context(
                    user_id,
                    workspace_id,
                ) as lease:
                    workspace_name = lease.workspace.name
                    revision = int(lease.revision)
                    source_snapshot = await self._run_sync(
                        _snapshot_workspace_tree,
                        lease.path,
                        self._max_export_bytes,
                    )
                await self._run_sync(
                    self._workspace_store.rebase_snapshot_sources,
                    source_snapshot,
                )
                loaded = await self._run_sync(self._workspace_store.load, source_snapshot)
                detached = loaded.workspace
                snapshot = await self._response_snapshots.create_generated(
                    suffix=".zip",
                    max_output_bytes=self._max_export_bytes,
                    reservation_bytes=self._max_export_bytes * 2,
                    producer=partial(
                        _create_workspace_export,
                        detached,
                        source_snapshot,
                    ),
                )
                filename = f"{_safe_export_name(workspace_name)}.zip"
                return snapshot, filename, revision
            except WorkspaceNotOpenError as not_open:
                path = await self._storage.resolve_owned_workspace_dir(
                    user_id,
                    workspace_id,
                )
                try:
                    self._workspace_store.inspect(path)
                except WorkspaceSchemaVersionError as incompatible:
                    metadata = incompatible.workspace_metadata or {}
                    workspace_name = metadata.get("name")
                    if not isinstance(workspace_name, str) or not workspace_name:
                        workspace_name = workspace_id
                    source_snapshot = await self._run_sync(
                        _snapshot_workspace_tree,
                        path,
                        self._max_export_bytes,
                    )
                    snapshot = await self._response_snapshots.create_generated(
                        suffix=".zip",
                        max_output_bytes=self._max_export_bytes,
                        reservation_bytes=self._max_export_bytes * 2,
                        producer=partial(
                            _create_raw_workspace_archive,
                            source_snapshot,
                        ),
                    )
                    return snapshot, f"{_safe_export_name(workspace_name)}.zip", None
                except (WorkspaceCapacityError, WorkspaceSnapshotInvalidError):
                    raise not_open
                raise not_open
        finally:
            if source_snapshot is not None:
                await self._run_sync(shutil.rmtree, source_snapshot, True)
            with anyio.CancelScope(shield=True):
                await source_reservation.release()

    async def import_upload(
        self,
        user_id: str,
        filename: str,
        source: AsyncUploadSource,
    ) -> dict[str, Any]:
        """Admit one bounded expansion and serialize it through an import slot."""

        async with self._import_slots:
            reservation = await self._storage_admission.acquire(
                user_id,
                self._limits.max_archive_bytes
                + self._limits.max_expanded_bytes
                + self._workspace_store.max_snapshot_bytes,
                requested_entries=self._limits.max_members,
            )
            try:
                return await self._import_upload_admitted(
                    user_id,
                    filename,
                    source,
                    reservation,
                )
            finally:
                with anyio.CancelScope(shield=True):
                    await reservation.release()

    async def _import_upload_admitted(
        self,
        user_id: str,
        filename: str,
        source: AsyncUploadSource,
        reservation: StorageReservation,
    ) -> dict[str, Any]:
        """Stream, validate, and install one workspace ZIP.

        Validation and extraction happen outside the workspace mutation gate.
        Only the final same-filesystem install is delegated to WorkspaceService,
        which serializes it with every other mutation for that user.
        """

        if not filename.lower().endswith(".zip"):
            raise InvalidWorkspaceArchiveError("Only .zip files are supported")

        staging_root = await self._run_sync(self._storage.workspace_staging_root)
        root_resolver = await self._run_sync(SafePathResolver, staging_root)
        descriptor, temporary = await self._run_sync(
            _create_archive_temp,
            root_resolver.root,
        )
        descriptor_open = True
        prepared: _PreparedArchive | None = None
        total = 0
        try:
            while True:
                chunk = await source.read(self._upload_chunk_size)
                if not chunk:
                    break
                total += len(chunk)
                if total > self._limits.max_archive_bytes:
                    raise UploadTooLargeError(
                        f"Workspace archive exceeds {self._limits.max_archive_bytes} bytes"
                    )
                await self._run_sync(_write_all, descriptor, chunk)
            if total == 0:
                raise InvalidWorkspaceArchiveError("Uploaded file is empty")

            await self._run_sync(os.fsync, descriptor)
            await self._run_sync(os.close, descriptor)
            descriptor_open = False
            prepared = await self._run_sync(
                self._prepare_from_path,
                temporary,
                root_resolver,
            )
            return await self._storage.install_staged_archive(
                user_id,
                prepared.staging,
                prepared.workspace_name,
                reservation,
            )
        finally:
            with anyio.CancelScope(shield=True):
                if descriptor_open:
                    try:
                        await self._run_sync(os.close, descriptor)
                    except OSError:
                        pass
                await self._run_sync(temporary.unlink, missing_ok=True)
                if prepared is not None and prepared.staging.exists():
                    await self._run_sync(shutil.rmtree, prepared.staging, True)

    def _prepare_from_path(
        self,
        archive_path: Path,
        root_resolver: SafePathResolver,
    ) -> _PreparedArchive:
        staging = Path(
            tempfile.mkdtemp(
                prefix=".workspace-import-",
                dir=root_resolver.root,
            )
        )
        try:
            try:
                _preflight_zip_central_directory(
                    archive_path,
                    max_members=self._limits.max_members,
                    max_central_bytes=self._limits.max_central_directory_bytes,
                )
                with zipfile.ZipFile(archive_path, "r") as archive:
                    members = self._validated_members(archive)
                    root_prefix = _workspace_root_prefix(members)
                    manifest_member = next(
                        member
                        for member, safe_path in members
                        if safe_path.parts == (*root_prefix, "workspace.json")
                    )
                    if manifest_member.file_size > self._limits.max_manifest_bytes:
                        raise InvalidWorkspaceArchiveError(
                            "Workspace manifest exceeds the configured limit"
                        )
                    self._extract_members(
                        archive,
                        members,
                        root_prefix=root_prefix,
                        staging=staging,
                    )
            except InvalidWorkspaceArchiveError:
                raise
            except (
                OSError,
                RuntimeError,
                zipfile.BadZipFile,
                zipfile.LargeZipFile,
            ) as exc:
                raise InvalidWorkspaceArchiveError(
                    "Invalid workspace ZIP archive"
                ) from exc

            manifest_path = staging / "workspace.json"
            try:
                if manifest_path.stat().st_size > self._limits.max_manifest_bytes:
                    raise InvalidWorkspaceArchiveError(
                        "Workspace manifest exceeds the configured limit"
                    )
                manifest = WorkspaceArchiveManifest.model_validate_json(
                    manifest_path.read_text(encoding="utf-8")
                )
            except (OSError, UnicodeError, ValidationError) as exc:
                raise InvalidWorkspaceArchiveError(
                    "Workspace workspace.json is missing or invalid"
                ) from exc
            workspace_name = manifest.workspace.name.strip()
            is_valid_name, reason = validate_workspace_name(workspace_name)
            if not is_valid_name:
                raise InvalidWorkspaceArchiveError(f"Invalid workspace name: {reason}")

            _compile_materialized_archive(
                staging,
                manifest,
                max_parent_edges=self._limits.max_parent_edges,
                workspace_store=self._workspace_store,
            )
            return _PreparedArchive(
                staging=staging,
                workspace_name=workspace_name,
            )
        except BaseException:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
            raise

    def _validated_members(
        self,
        archive: zipfile.ZipFile,
    ) -> list[tuple[zipfile.ZipInfo, PurePosixPath]]:
        members = archive.infolist()
        if not members:
            raise InvalidWorkspaceArchiveError("ZIP archive is empty")
        if len(members) > self._limits.max_members:
            raise InvalidWorkspaceArchiveError("ZIP archive has too many members")

        seen: set[str] = set()
        expanded_total = 0
        validated: list[tuple[zipfile.ZipInfo, PurePosixPath]] = []
        for member in members:
            safe_path = _safe_member_path(member.filename)
            collision_key = unicodedata.normalize(
                "NFC", safe_path.as_posix()
            ).casefold()
            if collision_key in seen:
                raise InvalidWorkspaceArchiveError(
                    "ZIP archive contains duplicate or colliding member names"
                )
            seen.add(collision_key)

            if member.flag_bits & 0x1:
                raise InvalidWorkspaceArchiveError(
                    "Encrypted ZIP members are not supported"
                )
            _validate_member_type(member)
            if member.compress_size > self._limits.max_compressed_member_bytes:
                raise InvalidWorkspaceArchiveError(
                    "ZIP member compressed size exceeds the configured limit"
                )
            if member.file_size > self._limits.max_member_bytes:
                raise InvalidWorkspaceArchiveError(
                    "ZIP member expanded size exceeds the configured limit"
                )
            expanded_total += member.file_size
            if expanded_total > self._limits.max_expanded_bytes:
                raise InvalidWorkspaceArchiveError(
                    "ZIP expanded size exceeds the configured limit"
                )
            if member.file_size:
                if member.compress_size == 0:
                    raise InvalidWorkspaceArchiveError(
                        "ZIP member compression ratio exceeds the configured limit"
                    )
                ratio = member.file_size / member.compress_size
                if ratio > self._limits.max_compression_ratio:
                    raise InvalidWorkspaceArchiveError(
                        "ZIP member compression ratio exceeds the configured limit"
                    )
            validated.append((member, safe_path))
        return validated

    def _extract_members(
        self,
        archive: zipfile.ZipFile,
        members: list[tuple[zipfile.ZipInfo, PurePosixPath]],
        *,
        root_prefix: tuple[str, ...],
        staging: Path,
    ) -> None:
        resolver = SafePathResolver(staging)
        extracted_total = 0
        for member, safe_path in members:
            if "__MACOSX" in safe_path.parts:
                continue
            if root_prefix and safe_path.parts[: len(root_prefix)] != root_prefix:
                continue
            relative_parts = safe_path.parts[len(root_prefix) :]
            if not relative_parts:
                continue
            if relative_parts[-1] == ".DS_Store":
                continue
            relative = PurePosixPath(*relative_parts).as_posix()
            destination = resolver.resolve(relative)
            if member.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            descriptor = resolver.open_new_file(destination)
            member_limit = (
                self._limits.max_manifest_bytes
                if relative == "workspace.json"
                else self._limits.max_member_bytes
            )
            try:
                with os.fdopen(descriptor, "wb", closefd=True) as output:
                    with archive.open(member, "r") as source:
                        member_total = 0
                        while True:
                            chunk = source.read(self._extraction_chunk_size)
                            if not chunk:
                                break
                            member_total += len(chunk)
                            extracted_total += len(chunk)
                            if member_total > member_limit:
                                raise InvalidWorkspaceArchiveError(
                                    "ZIP member expanded beyond its configured limit"
                                )
                            if extracted_total > self._limits.max_expanded_bytes:
                                raise InvalidWorkspaceArchiveError(
                                    "ZIP expanded beyond its configured limit"
                                )
                            output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
            except BaseException:
                destination.unlink(missing_ok=True)
                raise

    async def _run_sync(
        self,
        function: Callable[..., T],
        *args: object,
        **kwargs: object,
    ) -> T:
        return await run_sync_in_worker_thread(
            partial(function, *args, **kwargs),
            abandon_on_cancel=False,
            limiter=self._limiter,
        )


def _safe_member_path(name: str) -> PurePosixPath:
    try:
        return PurePosixPath(*portable_relative_path_parts(name.rstrip("/")))
    except ValueError as exc:
        raise InvalidWorkspaceArchiveError("Invalid ZIP member path") from exc


def _preflight_zip_central_directory(
    archive_path: Path,
    *,
    max_members: int,
    max_central_bytes: int,
) -> None:
    """Bound classic ZIP central metadata before ``zipfile`` allocates it."""

    file_size = archive_path.stat().st_size
    tail_size = min(file_size, 65_557)
    with archive_path.open("rb") as source:
        source.seek(file_size - tail_size)
        tail = source.read(tail_size)
    offset = tail.rfind(b"PK\x05\x06")
    if offset < 0 or offset + 22 > len(tail):
        raise InvalidWorkspaceArchiveError("ZIP end-of-directory record is missing")
    (
        _signature,
        disk_number,
        directory_disk,
        entries_on_disk,
        total_entries,
        central_size,
        central_offset,
        comment_length,
    ) = struct.unpack_from("<4s4H2LH", tail, offset)
    if (
        disk_number != 0
        or directory_disk != 0
        or entries_on_disk != total_entries
        or total_entries == 0xFFFF
        or central_size == 0xFFFFFFFF
        or central_offset == 0xFFFFFFFF
    ):
        raise InvalidWorkspaceArchiveError(
            "Multi-disk and ZIP64 archives are unsupported"
        )
    if total_entries > max_members or central_size > max_central_bytes:
        raise InvalidWorkspaceArchiveError("ZIP central directory exceeds its limit")
    if offset + 22 + comment_length != len(tail):
        raise InvalidWorkspaceArchiveError("ZIP end-of-directory record is invalid")
    if central_offset + central_size > file_size - 22:
        raise InvalidWorkspaceArchiveError("ZIP central directory is out of bounds")


def _validate_member_type(member: zipfile.ZipInfo) -> None:
    unix_mode = (member.external_attr >> 16) & 0xFFFF
    kind = stat.S_IFMT(unix_mode)
    allowed = {0, stat.S_IFDIR} if member.is_dir() else {0, stat.S_IFREG}
    if kind not in allowed:
        raise InvalidWorkspaceArchiveError(
            "ZIP archive contains a link or special file"
        )


def _workspace_root_prefix(
    members: list[tuple[zipfile.ZipInfo, PurePosixPath]],
) -> tuple[str, ...]:
    candidates = [
        path
        for member, path in members
        if not member.is_dir()
        and path.name == "workspace.json"
        and "__MACOSX" not in path.parts
    ]
    if not candidates:
        raise InvalidWorkspaceArchiveError("ZIP must contain workspace workspace.json")
    shallowest = min(len(path.parts) for path in candidates)
    shallow_candidates = [path for path in candidates if len(path.parts) == shallowest]
    if len(shallow_candidates) != 1:
        raise InvalidWorkspaceArchiveError(
            "ZIP contains ambiguous workspace metadata roots"
        )
    return shallow_candidates[0].parts[:-1]


def _write_all(descriptor: int, content: bytes) -> None:
    view = memoryview(content)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:  # pragma: no cover - OS contract guard
            raise OSError("Archive upload write made no progress")
        view = view[written:]


def _create_archive_temp(root: Path) -> tuple[int, Path]:
    descriptor, raw_path = tempfile.mkstemp(
        prefix=".workspace-upload-",
        suffix=".zip",
        dir=root,
    )
    return descriptor, Path(raw_path)


def _archive_artifact_path(record: AnalysisRecord, relative_path: str) -> Path:
    """Return the canonical portable archive path for one declared Artifact."""

    try:
        parts = portable_relative_path_parts(relative_path)
    except ValueError as exc:
        raise InvalidWorkspaceArchiveError(
            "Workspace Analysis Artifact path is invalid"
        ) from exc
    if len(parts) < 2 or parts[0] != "artifacts":
        raise InvalidWorkspaceArchiveError(
            "Workspace Analysis Artifact path is invalid"
        )
    return Path("analyses") / str(record.id) / Path(*parts)


def _compile_materialized_archive(
    staging: Path,
    manifest: WorkspaceArchiveManifest,
    *,
    max_parent_edges: int,
    workspace_store: WorkspaceStore,
) -> None:
    """Compile safe materialized Parquet entries into server-owned lazy plans."""

    node_ids = [str(node.id) for node in manifest.nodes]
    if len(node_ids) != len(set(node_ids)):
        raise InvalidWorkspaceArchiveError("Workspace archive has duplicate node IDs")
    known_ids = set(node_ids)
    allowed_files = {"workspace.json"}
    parent_map: dict[str, list[str]] = {}
    children: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    edge_count = 0
    for node in manifest.nodes:
        node_id = str(node.id)
        expected_file = f"data/{node_id}.parquet"
        if node.data_file != expected_file:
            raise InvalidWorkspaceArchiveError(
                "Workspace node data_file must match its canonical node ID"
            )
        parent_ids = referenced_node_ids(node.provenance)
        if len(parent_ids) != len(set(parent_ids)) or node_id in parent_ids:
            raise InvalidWorkspaceArchiveError("Workspace node parents are invalid")
        if any(parent_id not in known_ids for parent_id in parent_ids):
            raise InvalidWorkspaceArchiveError("Workspace node parent is missing")
        edge_count += len(parent_ids)
        if edge_count > max_parent_edges:
            raise InvalidWorkspaceArchiveError(
                "Workspace archive graph has too many parent edges"
            )
        parent_map[node_id] = parent_ids
        for parent_id in parent_ids:
            children[parent_id].append(node_id)
        allowed_files.add(expected_file)

    for archived in manifest.analyses:
        record = archived.record
        for reference in record.artifact_references:
            allowed_files.add(
                _archive_artifact_path(record, reference.relative_path).as_posix()
            )
        allowed_files.update(item.data_file for item in archived.query_inputs)

    actual_files = {
        path.relative_to(staging).as_posix()
        for path in staging.rglob("*")
        if path.is_file() and not path.is_symlink()
    }
    if actual_files != allowed_files:
        raise InvalidWorkspaceArchiveError(
            "Workspace archive contains undeclared or missing files"
        )

    workspace = Workspace(
        name=manifest.workspace.name.strip(),
    )
    workspace.id = str(manifest.workspace.id)
    workspace.description = manifest.workspace.description
    compiled_at = datetime.now(UTC).isoformat()
    workspace.created_at = compiled_at
    workspace.modified_at = compiled_at

    nodes_by_id = {str(node.id): node for node in manifest.nodes}
    indegree = {node_id: len(parent_map[node_id]) for node_id in node_ids}
    ready = deque(node_id for node_id in node_ids if indegree[node_id] == 0)
    processed = 0
    try:
        for tab in manifest.tabs:
            workspace.add_tab(tab.model_copy(deep=True))
        # The validated portable manifest and the strict internal snapshot share
        # the canonical filename but never the same schema.
        (staging / "workspace.json").unlink()
        while ready:
            node_id = ready.popleft()
            node = nodes_by_id[node_id]
            parent_ids = parent_map[node_id]
            data_path = staging / node.data_file
            metadata = data_path.lstat()
            if not stat.S_ISREG(metadata.st_mode) or data_path.is_symlink():
                raise InvalidWorkspaceArchiveError(
                    "Workspace node data is not a regular file"
                )
            lazyframe = pl.scan_parquet(data_path.resolve())
            schema_names = set(lazyframe.collect_schema().names())
            if node.document is not None and node.document not in schema_names:
                raise InvalidWorkspaceArchiveError(
                    "Workspace document column is absent from node data"
                )
            materialized = Node(
                id=node_id,
                data=lazyframe,
                name=node.name,
                provenance=node.provenance,
                document=node.document,
                color=node.color,
                tokenizer_model=node.tokenizer_model,
                parents=[workspace.nodes[parent_id] for parent_id in parent_ids],
            )
            workspace.add_node(materialized)
            processed += 1
            for child_id in children[node_id]:
                indegree[child_id] -= 1
                if indegree[child_id] == 0:
                    ready.append(child_id)
        if processed != len(node_ids):
            raise InvalidWorkspaceArchiveError(
                "Workspace archive node graph contains a cycle"
            )
        for archived in manifest.analyses:
            if not archived.query_inputs:
                continue
            record = archived.record
            if record.query_snapshot is None:
                raise InvalidWorkspaceArchiveError(
                    "Workspace Analysis query inputs are invalid"
                )
            query_workspace = Workspace(
                name=f"Analysis {record.id} query inputs",
                workspace_id=workspace.id,
            )
            query_data_root = staging / "analyses" / str(record.id) / "query-data"
            for item in archived.query_inputs:
                data_path = staging / item.data_file
                lazyframe = pl.scan_parquet(data_path.resolve(strict=True))
                schema_names = set(lazyframe.collect_schema().names())
                if item.document is not None and item.document not in schema_names:
                    raise InvalidWorkspaceArchiveError(
                        "Workspace Analysis document column is absent from query data"
                    )
                query_workspace.add_node(
                    Node(
                        id=str(item.id),
                        data=lazyframe,
                        name=item.name,
                        document=item.document,
                        color=item.color,
                    )
                )
            create_worker_input_snapshot(
                workspace_id=workspace.id,
                node_ids=[str(item.id) for item in archived.query_inputs],
                workspace=query_workspace,
                workspace_data_dir=query_data_root,
                snapshot_dir=staging / record.query_snapshot.relative_path,
                max_snapshot_bytes=workspace_store.max_snapshot_bytes,
            )
            shutil.rmtree(query_data_root)
        pending = [archived.record.model_copy(deep=True) for archived in manifest.analyses]
        while pending:
            next_pending = []
            for record in pending:
                if (
                    record.parent_analysis_id is not None
                    and str(record.parent_analysis_id) not in workspace.analyses
                ):
                    next_pending.append(record)
                    continue
                workspace.add_analysis(record)
            if len(next_pending) == len(pending):
                raise InvalidWorkspaceArchiveError(
                    "Workspace Analysis forest is invalid"
                )
            pending = next_pending
        workspace_store.commit(staging, workspace, expected_revision=None)
    except InvalidWorkspaceArchiveError:
        raise
    except Exception as exc:
        raise InvalidWorkspaceArchiveError(
            "Workspace materialized data is invalid"
        ) from exc

    marker = staging / SAFE_WORKSPACE_IMPORT_MARKER
    with marker.open("x", encoding="ascii") as output:
        output.write(SAFE_WORKSPACE_IMPORT_MARKER_CONTENT)
        output.flush()
        os.fsync(output.fileno())
    _fsync_directory(staging)


def _snapshot_workspace_tree(source: Path, max_bytes: int) -> Path:
    """Hard-link one bounded committed workspace generation for lock-free export."""

    root = source.parent / ".staging" / ".archive-export-sources"
    root.mkdir(mode=0o700, exist_ok=True)
    destination = Path(tempfile.mkdtemp(prefix="workspace-", dir=root))
    copied = 0
    try:
        for current_root, directory_names, file_names in os.walk(
            source,
            topdown=True,
            followlinks=False,
        ):
            current = Path(current_root)
            directory_names[:] = [
                name for name in directory_names if not (current / name).is_symlink()
            ]
            relative = current.relative_to(source)
            target_dir = destination / relative
            target_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            for name in file_names:
                candidate = current / name
                metadata = candidate.lstat()
                if not stat.S_ISREG(metadata.st_mode):
                    raise InvalidWorkspaceArchiveError(
                        "Workspace export source is unsafe"
                    )
                copied += metadata.st_size
                if copied > max_bytes:
                    raise UploadTooLargeError(
                        "Workspace export exceeds the configured limit"
                    )
                os.link(candidate, target_dir / name, follow_symlinks=False)
        return destination
    except BaseException:
        shutil.rmtree(destination, ignore_errors=True)
        raise


def _create_raw_workspace_archive(
    source: Path,
    target: Path,
    max_output_bytes: int,
) -> None:
    """Zip an incompatible Workspace tree without reading its schema payload."""

    try:
        with target.open("xb") as output:
            bounded = cast(BinaryIO, _BoundedSeekableWriter(output, max_output_bytes))
            with zipfile.ZipFile(
                bounded,
                mode="w",
                compression=zipfile.ZIP_DEFLATED,
                compresslevel=6,
            ) as archive:
                for current_root, directory_names, file_names in os.walk(
                    source,
                    topdown=True,
                    followlinks=False,
                ):
                    current = Path(current_root)
                    directory_names[:] = [
                        name
                        for name in directory_names
                        if not (current / name).is_symlink()
                    ]
                    for name in sorted(file_names):
                        candidate = current / name
                        if candidate == source / "access.json":
                            continue
                        metadata = candidate.lstat()
                        if not stat.S_ISREG(metadata.st_mode) or candidate.is_symlink():
                            raise InvalidWorkspaceArchiveError(
                                "Workspace export source is unsafe"
                            )
                        relative = candidate.relative_to(source)
                        archive.write(
                            candidate,
                            (Path("workspace") / relative).as_posix(),
                        )
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def _terminal_archive_analyses(workspace: Workspace) -> list[AnalysisRecord]:
    """Return terminal Analyses reachable from current Tabs in parent-first order."""

    terminal_states = {
        AnalysisState.SUCCEEDED,
        AnalysisState.FAILED,
        AnalysisState.CANCELLED,
    }
    live_ids = workspace.live_analysis_ids()
    terminal = {
        analysis_id: record
        for analysis_id, record in workspace.analyses.items()
        if analysis_id in live_ids and record.state in terminal_states
    }
    ordered: list[AnalysisRecord] = []
    pending = list(terminal.values())
    while pending:
        next_pending = []
        for record in pending:
            if (
                record.parent_analysis_id is not None
                and str(record.parent_analysis_id) not in {
                    str(item.id) for item in ordered
                }
            ):
                next_pending.append(record)
                continue
            ordered.append(record)
        if len(next_pending) == len(pending):
            break
        pending = next_pending
    return ordered


def _write_export_parquet(
    lazyframe: pl.LazyFrame,
    destination: Path,
    remaining_bytes: int,
) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    frame = lazyframe.collect(engine="streaming")
    with destination.open("xb") as output:
        write_parquet_bounded(
            frame,
            output,
            remaining_bytes,
            label="Workspace export",
        )
        output.flush()
        os.fsync(output.fileno())
    return destination.stat().st_size


def _copy_export_artifact(
    source_root: Path,
    staging: Path,
    record: AnalysisRecord,
    relative_path: str,
    remaining_bytes: int,
) -> int:
    archive_path = _archive_artifact_path(record, relative_path)
    source = (source_root / archive_path).resolve(strict=True)
    source.relative_to(source_root.resolve(strict=True))
    metadata = source.lstat()
    if source.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        raise InvalidWorkspaceArchiveError("Workspace Analysis Artifact is unsafe")
    if metadata.st_size > remaining_bytes:
        raise UploadTooLargeError("Workspace export exceeds the configured limit")
    destination = staging / archive_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination, follow_symlinks=False)
    _fsync_file(destination)
    return metadata.st_size


def _create_workspace_export(
    workspace: Workspace,
    source_root: Path,
    target: Path,
    max_output_bytes: int,
) -> None:
    """Materialize a safe, executable-code-free portable workspace archive."""

    staging = Path(
        tempfile.mkdtemp(prefix=".workspace-export-stage-", dir=target.parent)
    )
    try:
        data_root = staging / "data"
        data_root.mkdir()
        nodes: list[dict[str, JsonData]] = []
        expanded_bytes = 0
        for node in workspace.nodes.values():
            data_file = f"data/{node.id}.parquet"
            destination = staging / data_file
            expanded_bytes += _write_export_parquet(
                node.data,
                destination,
                max_output_bytes - expanded_bytes,
            )
            if expanded_bytes > max_output_bytes:
                raise UploadTooLargeError(
                    "Workspace export exceeds the configured limit"
                )
            nodes.append(
                {
                    "id": node.id,
                    "name": node.name,
                    "provenance": node.provenance.model_dump(mode="json"),
                    "document": node.document,
                    "color": node.color,
                    "tokenizer_model": node.tokenizer_model,
                    "data_file": data_file,
                }
            )
        _fsync_directory(data_root)
        analysis_records = _terminal_archive_analyses(workspace)
        archived_analysis_ids = {str(record.id) for record in analysis_records}
        analyses: list[dict[str, JsonData]] = []
        for record in analysis_records:
            for reference in record.artifact_references:
                expanded_bytes += _copy_export_artifact(
                    source_root,
                    staging,
                    record,
                    reference.relative_path,
                    max_output_bytes - expanded_bytes,
                )
            query_inputs: list[dict[str, JsonData]] = []
            if record.query_snapshot is not None:
                query_snapshot = source_root / record.query_snapshot.relative_path
                for node_id in analysis_snapshot_input_ids(record.request):
                    snapshot_node = load_snapshot_node(query_snapshot, str(node_id))
                    data_file = (
                        Path("analyses")
                        / str(record.id)
                        / "query-data"
                        / f"{node_id}.parquet"
                    )
                    expanded_bytes += _write_export_parquet(
                        snapshot_node.data,
                        staging / data_file,
                        max_output_bytes - expanded_bytes,
                    )
                    query_inputs.append(
                        {
                            "id": snapshot_node.id,
                            "name": snapshot_node.name,
                            "document": snapshot_node.document,
                            "color": snapshot_node.color,
                            "data_file": data_file.as_posix(),
                        }
                    )
            analyses.append(
                {
                    "record": cast(
                        JsonData,
                        record.model_dump(mode="json"),
                    ),
                    "query_inputs": cast(JsonData, query_inputs),
                }
            )
        manifest = WorkspaceArchiveManifest.model_validate(
            {
                "format": "wordflow-materialized-workspace",
                "version": 20,
                "workspace": {
                    "id": workspace.id,
                    "name": workspace.name,
                    "description": workspace.description,
                    "created_at": workspace.created_at,
                    "modified_at": workspace.modified_at,
                },
                "nodes": nodes,
                "tabs": [
                    tab.model_copy(
                        update={
                            "analysis_ids": [
                                analysis_id
                                for analysis_id in tab.analysis_ids
                                if str(analysis_id) in archived_analysis_ids
                            ]
                        }
                    ).model_dump(mode="json")
                    for tab in workspace.tabs.values()
                ],
                "analyses": analyses,
            }
        )
        _atomic_json_write(
            staging / "workspace.json",
            manifest.model_dump(mode="json"),
        )
        expanded_bytes += (staging / "workspace.json").stat().st_size
        if expanded_bytes > max_output_bytes:
            raise UploadTooLargeError("Workspace export exceeds the configured limit")
        with target.open("xb") as output:
            bounded = cast(BinaryIO, _BoundedSeekableWriter(output, max_output_bytes))
            with zipfile.ZipFile(
                bounded,
                mode="w",
                compression=zipfile.ZIP_DEFLATED,
                compresslevel=6,
            ) as archive:
                for current_root, _directory_names, file_names in os.walk(
                    staging,
                    topdown=True,
                    followlinks=False,
                ):
                    current = Path(current_root)
                    for name in sorted(file_names):
                        source = current / name
                        relative = source.relative_to(staging)
                        archive.write(source, (Path("workspace") / relative).as_posix())
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)


class _BoundedSeekableWriter:
    """File adapter that prevents ZIP output from crossing its reservation."""

    def __init__(self, output: Any, limit: int) -> None:
        self._output = output
        self._limit = limit

    def write(self, content: bytes) -> int:
        if self._output.tell() + len(content) > self._limit:
            raise UploadTooLargeError("Workspace export exceeds the configured limit")
        return self._output.write(content)

    def seek(self, offset: int, whence: int = os.SEEK_SET) -> int:
        return self._output.seek(offset, whence)

    def tell(self) -> int:
        return self._output.tell()

    def flush(self) -> None:
        self._output.flush()

    def seekable(self) -> bool:
        return True

    def writable(self) -> bool:
        return True


def _safe_export_name(name: str) -> str:
    normalized = "".join(
        character if character.isalnum() or character in {"-", "_"} else "_"
        for character in name.strip()
    ).strip("_")
    return normalized or "workspace"
