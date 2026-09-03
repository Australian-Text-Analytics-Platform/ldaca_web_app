"""Workspace file persistence helpers."""

from __future__ import annotations

import json
import logging
import os
import shutil
import stat
import uuid
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from collections.abc import Iterable

from polars_source_utils import list_source_paths, replace_source_paths
import polars as pl

from ...analysis.result_integrity import validate_analysis_result_integrity
from .durable_fs import (
    AtomicWriteCapacityError,
    atomic_output_path,
    atomic_write_json,
    fsync_directory,
)
from .safe_paths import is_link_or_reparse

if TYPE_CHECKING:  # pragma: no cover
    from ...domain.workspace import Workspace

from .node_store import NODE_DATA_DIR, NodePlanCapacityError
from .node_store import to_dict as node_to_dict
from ...domain.workspace import (
    AnalysisRecord,
    AnalysisExecutionScope,
    AnalysisKind,
    AnalysisState,
    Node,
    NodeProvenance,
    Tab,
    UnavailableChildRecord,
    analysis_kind_for_request,
    analysis_input_ids,
    referenced_node_ids,
    validate_node_provenance,
)

logger = logging.getLogger(__name__)
WORKSPACE_DATA_SCHEMA_VERSION = 1
ANALYSIS_SCHEMA_VERSIONS: dict[AnalysisKind, int] = {
    kind: 1 for kind in AnalysisKind
}
_WORKSPACE_ENVELOPE_FIELDS = {"workspace_metadata", "nodes", "tabs", "analyses"}
_WORKSPACE_METADATA_FIELDS = {
    "id",
    "name",
    "data_schema_version",
    "description",
    "created_at",
    "modified_at",
    "revision",
}
_TAB_RECORD_FIELDS = {"id", "analysis_kind", "schema_version", "payload"}
_ANALYSIS_RECORD_FIELDS = {
    "id",
    "tab_id",
    "analysis_kind",
    "schema_version",
    "payload",
}


class WorkspaceStoreError(ValueError):
    """Base failure for the framework-neutral workspace snapshot boundary."""


class WorkspaceSnapshotInvalidError(WorkspaceStoreError):
    """The persisted workspace snapshot is absent, corrupt, or unsupported."""


class WorkspaceSchemaVersionError(WorkspaceSnapshotInvalidError):
    """The persisted native Workspace schema is not supported by this build."""

    def __init__(
        self,
        stored_version: int,
        supported_version: int,
        workspace_metadata: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(
            "Workspace data schema version "
            f"{stored_version} is incompatible with supported version {supported_version}"
        )
        self.stored_version = stored_version
        self.supported_version = supported_version
        self.workspace_metadata = (
            dict(workspace_metadata) if workspace_metadata is not None else None
        )


class WorkspaceRevisionConflictError(WorkspaceStoreError):
    """The caller attempted to commit against a stale or occupied snapshot."""

    def __init__(self, expected: int | None, actual: int | None) -> None:
        super().__init__(
            f"Workspace revision conflict: expected {expected}, actual {actual}"
        )
        self.expected = expected
        self.actual = actual


class WorkspaceCapacityError(WorkspaceStoreError):
    """A workspace snapshot exceeds its configured node or byte ceiling."""


class WorkspaceSerializationError(WorkspaceStoreError):
    """A valid in-memory graph could not be serialized durably."""


@dataclass(frozen=True, slots=True)
class WorkspaceSnapshotInfo:
    """Validated identity and revision of one committed workspace snapshot."""

    workspace_id: uuid.UUID
    name: str
    description: str
    created_at: datetime
    modified_at: datetime
    revision: int
    node_count: int
    tab_count: int
    analysis_count: int
    root_node_count: int
    leaf_node_count: int
    serialized_bytes: int


@dataclass(frozen=True, slots=True)
class LoadedWorkspace:
    """A reconstructed graph paired with the snapshot it was loaded from."""

    workspace: Workspace
    snapshot: WorkspaceSnapshotInfo


def _resolve_metadata_path(path: Path) -> Path:
    if path.suffix.lower() == ".json":
        return path
    if path.exists() and not path.is_dir():
        raise ValueError("Workspace path must be a directory or a .json file")
    return path / "workspace.json"


def _resolve_regular_under(root: Path, relative: Path) -> Path:
    """Resolve one regular file without following link/reparse components."""

    if relative.is_absolute() or not relative.parts:
        raise ValueError("Workspace file path must be relative")
    current = root.resolve(strict=True)
    resolved_root = current
    for part in relative.parts:
        if part in {"", ".", ".."}:
            raise ValueError("Workspace file path is invalid")
        current = current / part
        metadata = current.lstat()
        if is_link_or_reparse(metadata):
            raise ValueError("Workspace file path contains a link or reparse point")
    if not stat.S_ISREG(current.lstat().st_mode):
        raise ValueError("Workspace file is not regular")
    resolved = current.resolve(strict=True)
    resolved.relative_to(resolved_root)
    return resolved


def _collect_referenced_sources(plbin_paths: Iterable[Path]) -> set[Path]:
    """Return the set of absolute source paths referenced by every plbin plan."""

    referenced: set[Path] = set()
    for plbin in plbin_paths:
        for raw in list_source_paths(plbin):
            referenced.add(Path(raw).resolve())
    return referenced


def _rebase_plan_copy(
    source: Path,
    destination: Path,
    *,
    source_data_dir: Path,
    published_data_dir: Path,
) -> bool:
    """Write a rebased plan generation without touching the committed source."""

    current_sources = list_source_paths(source)
    mapping: dict[str, str] = {}
    for old in current_sources:
        try:
            staged_source = _resolve_regular_under(
                source_data_dir.parent,
                Path(NODE_DATA_DIR) / Path(old).name,
            )
        except (OSError, ValueError) as exc:
            raise ValueError("Workspace plan source cannot be relocated") from exc
        published_source = published_data_dir / staged_source.name
        if old != str(published_source):
            mapping[old] = str(published_source)
    if not mapping:
        return False
    with atomic_output_path(destination) as temporary:
        shutil.copyfile(source, temporary)
        rewritten = replace_source_paths(temporary, mapping)
        if rewritten != len(mapping):
            raise RuntimeError("Workspace plan source rewrite was incomplete")
    return True


def _garbage_collect_workspace_data(
    ws_root_dir: Path,
    nodes_data: list[dict[str, Any]],
    *,
    published_root: Path | None = None,
) -> None:
    """Remove unreferenced parquet and plbin files from the workspace data dir.

    * Parquet files not referenced by any registered node's plan are deleted.
    * Plbin files whose name does not match a registered node's ``data_path``
      are deleted (they belong to nodes no longer in the workspace).
    """

    data_dir = ws_root_dir / NODE_DATA_DIR
    if not data_dir.exists() or not data_dir.is_dir():
        return

    expected_plbin_names = {
        Path(str(node_payload["data_path"])).name for node_payload in nodes_data
    }
    registered_plbins = [
        data_dir / name for name in expected_plbin_names if (data_dir / name).exists()
    ]

    try:
        referenced_sources = _collect_referenced_sources(registered_plbins)
    except Exception:
        # A current-schema corrupt Data Block is isolated at load. Retain the
        # complete logical data tree rather than guessing which bytes it owns.
        return
    if published_root is not None:
        remapped_sources: set[Path] = set()
        for source in referenced_sources:
            try:
                relative = source.relative_to(published_root)
            except ValueError as exc:
                raise ValueError(
                    "Workspace plan source escapes its publication root"
                ) from exc
            remapped_sources.add((ws_root_dir / relative).resolve())
        referenced_sources = remapped_sources

    for candidate in data_dir.iterdir():
        if not candidate.is_file():
            continue
        suffix = candidate.suffix.lower()
        if suffix == ".plbin":
            if candidate.name not in expected_plbin_names:
                candidate.unlink(missing_ok=True)
        elif suffix == ".parquet":
            if candidate.resolve() not in referenced_sources:
                candidate.unlink(missing_ok=True)


def _canonical_uuid_text(raw: object, *, label: str) -> str:
    if not isinstance(raw, str):
        raise ValueError(f"{label} must be a string")
    value = str(uuid.UUID(raw))
    if value != raw:
        raise ValueError(f"{label} must be canonical")
    return value


def _stored_tab_record(tab: Tab) -> dict[str, Any]:
    return {
        "id": str(tab.id),
        "analysis_kind": tab.kind.value,
        "schema_version": ANALYSIS_SCHEMA_VERSIONS[tab.kind],
        "payload": tab.model_dump(mode="json"),
    }


def _stored_analysis_record(record: AnalysisRecord) -> dict[str, Any]:
    analysis_kind = analysis_kind_for_request(record.request)
    return {
        "id": str(record.id),
        "tab_id": str(record.tab_id),
        "analysis_kind": analysis_kind.value,
        "schema_version": ANALYSIS_SCHEMA_VERSIONS[analysis_kind],
        "payload": record.model_dump(mode="json"),
    }


def _record_invalid(
    content: bytes,
    *,
    analysis_kind: AnalysisKind | None = None,
    tab_id: uuid.UUID | None = None,
) -> UnavailableChildRecord:
    return UnavailableChildRecord(
        content=content,
        reason="record_invalid",
        analysis_kind=analysis_kind,
        tab_id=tab_id,
    )


def _incompatible_record(
    content: bytes,
    *,
    analysis_kind: AnalysisKind,
    stored_schema_version: int,
    tab_id: uuid.UUID | None = None,
) -> UnavailableChildRecord:
    return UnavailableChildRecord(
        content=content,
        reason="incompatible_schema",
        analysis_kind=analysis_kind,
        stored_schema_version=stored_schema_version,
        supported_schema_version=ANALYSIS_SCHEMA_VERSIONS[analysis_kind],
        tab_id=tab_id,
    )


def _tab_references(payload: Mapping[str, Any]) -> list[tuple[str, Path]]:
    """Validate the commit-point references to strict Tab generations."""

    raw_references = payload.get("tabs")
    if not isinstance(raw_references, list):
        raise ValueError("Workspace tabs must be a list")
    references: list[tuple[str, Path]] = []
    tab_ids: set[str] = set()
    record_paths: set[Path] = set()
    for raw in raw_references:
        if not isinstance(raw, Mapping) or set(raw) != {"id", "record_path"}:
            raise ValueError("Workspace Tab reference is invalid")
        raw_id = raw["id"]
        raw_path = raw["record_path"]
        if not isinstance(raw_id, str) or not isinstance(raw_path, str):
            raise ValueError("Workspace Tab reference is invalid")
        tab_id = str(uuid.UUID(raw_id))
        relative = Path(raw_path)
        if (
            tab_id != raw_id
            or tab_id in tab_ids
            or relative in record_paths
            or relative.is_absolute()
            or len(relative.parts) != 3
            or relative.parts[:2] != ("tabs", tab_id)
            or relative.suffix != ".json"
            or any(part in {"", ".", ".."} for part in relative.parts)
        ):
            raise ValueError("Workspace Tab reference is invalid")
        tab_ids.add(tab_id)
        record_paths.add(relative)
        references.append((tab_id, relative))
    return references


def _read_tabs(
    root: Path,
    references: list[tuple[str, Path]],
    *,
    max_bytes: int,
) -> tuple[list[Tab], dict[str, UnavailableChildRecord], int]:
    """Read version-compatible Tabs while retaining unavailable bytes."""

    tabs: list[Tab] = []
    unavailable: dict[str, UnavailableChildRecord] = {}
    total_bytes = 0
    analysis_ids: set[uuid.UUID] = set()
    for tab_id, relative in references:
        try:
            record_path = _resolve_regular_under(root, relative)
            content = record_path.read_bytes()
        except OSError, ValueError:
            content = b""
        if total_bytes + len(content) > max_bytes:
            raise WorkspaceCapacityError("Workspace Tab records exceed their byte budget")
        total_bytes += len(content)
        analysis_kind: AnalysisKind | None = None
        try:
            envelope = json.loads(content)
            if not isinstance(envelope, Mapping) or set(envelope) != _TAB_RECORD_FIELDS:
                raise ValueError("Workspace Tab record envelope is invalid")
            if _canonical_uuid_text(envelope["id"], label="Workspace Tab ID") != tab_id:
                raise ValueError("Workspace Tab identity does not match its reference")
            analysis_kind = AnalysisKind(envelope["analysis_kind"])
            schema_version = envelope["schema_version"]
            if type(schema_version) is not int or schema_version < 1:
                raise ValueError("Workspace Tab schema version is invalid")
            payload = envelope["payload"]
            if not isinstance(payload, Mapping):
                raise ValueError("Workspace Tab payload is invalid")
            if schema_version != ANALYSIS_SCHEMA_VERSIONS[analysis_kind]:
                unavailable[tab_id] = _incompatible_record(
                    content,
                    analysis_kind=analysis_kind,
                    stored_schema_version=schema_version,
                )
                continue
            tab = Tab.model_validate(payload)
            if str(tab.id) != tab_id or tab.kind is not analysis_kind:
                raise ValueError("Workspace Tab envelope does not match its payload")
            if len(tab.analysis_ids) != len(set(tab.analysis_ids)):
                raise ValueError("A Tab cannot contain duplicate Analysis IDs")
            if analysis_ids.intersection(tab.analysis_ids):
                raise ValueError("An Analysis cannot belong to multiple Tabs")
            analysis_ids.update(tab.analysis_ids)
        except (TypeError, ValueError, UnicodeError):
            unavailable[tab_id] = _record_invalid(
                content,
                analysis_kind=analysis_kind,
            )
        else:
            tabs.append(tab)
    return tabs, unavailable, total_bytes


def _garbage_collect_workspace_tabs(
    workspace_root: Path,
    references: list[tuple[str, Path]],
) -> None:
    """Remove only unreferenced Tab generations after metadata publication."""

    tabs_root = workspace_root / "tabs"
    if not tabs_root.exists():
        return
    if not tabs_root.is_dir() or tabs_root.is_symlink():
        raise ValueError("Workspace tabs path is invalid")
    expected = {workspace_root / relative for _tab_id, relative in references}
    for tab_directory in tabs_root.iterdir():
        if not tab_directory.is_dir() or tab_directory.is_symlink():
            if tab_directory not in expected:
                tab_directory.unlink(missing_ok=True)
            continue
        for candidate in tab_directory.iterdir():
            if candidate not in expected:
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate, ignore_errors=True)
                else:
                    candidate.unlink(missing_ok=True)
        try:
            tab_directory.rmdir()
        except OSError:
            pass
    try:
        tabs_root.rmdir()
    except OSError:
        pass


def _analysis_references(payload: Mapping[str, Any]) -> list[tuple[str, Path]]:
    """Validate commit-point references to Workspace-owned Analysis records."""

    raw_references = payload.get("analyses")
    if not isinstance(raw_references, list):
        raise ValueError("Workspace analyses must be a list")
    references: list[tuple[str, Path]] = []
    analysis_ids: set[str] = set()
    record_paths: set[Path] = set()
    for raw in raw_references:
        if not isinstance(raw, Mapping) or set(raw) != {"id", "record_path"}:
            raise ValueError("Workspace Analysis reference is invalid")
        raw_id = raw["id"]
        raw_path = raw["record_path"]
        if not isinstance(raw_id, str) or not isinstance(raw_path, str):
            raise ValueError("Workspace Analysis reference is invalid")
        analysis_id = str(uuid.UUID(raw_id))
        relative = Path(raw_path)
        if (
            analysis_id != raw_id
            or analysis_id in analysis_ids
            or relative in record_paths
            or relative.is_absolute()
            or len(relative.parts) != 3
            or relative.parts[:2] != ("analyses", analysis_id)
            or relative.suffix != ".json"
            or any(part in {"", ".", ".."} for part in relative.parts)
        ):
            raise ValueError("Workspace Analysis reference is invalid")
        analysis_ids.add(analysis_id)
        record_paths.add(relative)
        references.append((analysis_id, relative))
    return references


def _read_analysis_records(
    root: Path,
    references: list[tuple[str, Path]],
    *,
    max_bytes: int,
) -> tuple[
    list[tuple[AnalysisRecord, bytes]],
    dict[str, UnavailableChildRecord],
    int,
]:
    """Read version-compatible records while retaining unavailable bytes."""

    records: list[tuple[AnalysisRecord, bytes]] = []
    unavailable: dict[str, UnavailableChildRecord] = {}
    total_bytes = 0
    for analysis_id, relative in references:
        try:
            record_path = _resolve_regular_under(root, relative)
            content = record_path.read_bytes()
        except OSError, ValueError:
            content = b""
        if total_bytes + len(content) > max_bytes:
            raise WorkspaceCapacityError(
                "Workspace Analysis records exceed their byte budget"
            )
        total_bytes += len(content)
        analysis_kind: AnalysisKind | None = None
        tab_id: uuid.UUID | None = None
        try:
            envelope = json.loads(content)
            if (
                not isinstance(envelope, Mapping)
                or set(envelope) != _ANALYSIS_RECORD_FIELDS
            ):
                raise ValueError("Workspace Analysis record envelope is invalid")
            if (
                _canonical_uuid_text(envelope["id"], label="Workspace Analysis ID")
                != analysis_id
            ):
                raise ValueError("Analysis identity does not match its reference")
            raw_tab_id = _canonical_uuid_text(
                envelope["tab_id"],
                label="Workspace Analysis Tab ID",
            )
            tab_id = uuid.UUID(raw_tab_id)
            analysis_kind = AnalysisKind(envelope["analysis_kind"])
            schema_version = envelope["schema_version"]
            if type(schema_version) is not int or schema_version < 1:
                raise ValueError("Workspace Analysis schema version is invalid")
            payload = envelope["payload"]
            if not isinstance(payload, Mapping):
                raise ValueError("Workspace Analysis payload is invalid")
            if schema_version != ANALYSIS_SCHEMA_VERSIONS[analysis_kind]:
                unavailable[analysis_id] = _incompatible_record(
                    content,
                    analysis_kind=analysis_kind,
                    stored_schema_version=schema_version,
                    tab_id=tab_id,
                )
                continue
            record = AnalysisRecord.model_validate(payload)
            if (
                str(record.id) != analysis_id
                or record.tab_id != tab_id
                or analysis_kind_for_request(record.request) is not analysis_kind
            ):
                raise ValueError("Analysis envelope does not match its payload")
        except (TypeError, ValueError, UnicodeError):
            unavailable[analysis_id] = _record_invalid(
                content,
                analysis_kind=analysis_kind,
                tab_id=tab_id,
            )
        else:
            records.append((record, content))
    return records, unavailable, total_bytes


def _analysis_private_owner_ids(
    root: Path,
    references: list[tuple[str, Path]],
    *,
    max_bytes: int,
) -> tuple[set[str], set[str], set[str]]:
    """Derive which strict records may retain private Analysis storage."""

    records, unavailable, _total_bytes = _read_analysis_records(
        root,
        references,
        max_bytes=max_bytes,
    )
    unavailable_ids = set(unavailable)
    execution_owner_ids = {
        str(record.id)
        for record, _content in records
        if record.state in {AnalysisState.QUEUED, AnalysisState.RUNNING}
        or (
            record.execution_scope is AnalysisExecutionScope.SUPPORTING
            and record.state is AnalysisState.SUCCEEDED
            and record.parent_analysis_id is not None
            and (
                parent := next(
                    (
                        candidate
                        for candidate, _raw in records
                        if candidate.id == record.parent_analysis_id
                    ),
                    None,
                )
            )
            is not None
            and parent.state in {AnalysisState.QUEUED, AnalysisState.RUNNING}
        )
    } | unavailable_ids
    artifact_owner_ids = {
        str(record.id)
        for record, _content in records
        if record.state is AnalysisState.SUCCEEDED
    } | unavailable_ids
    query_snapshot_owner_ids = {
        str(record.id)
        for record, _content in records
        if record.state is AnalysisState.SUCCEEDED and record.query_snapshot is not None
    } | unavailable_ids
    return execution_owner_ids, artifact_owner_ids, query_snapshot_owner_ids


def _add_workspace_analyses(
    workspace: Workspace,
    workspace_root: Path,
    records: list[tuple[AnalysisRecord, bytes]],
    unavailable: dict[str, UnavailableChildRecord],
) -> None:
    """Hydrate valid ownership while isolating unavailable records.

    Valid detached roots and children stay in the aggregate until cancellation
    and cleanup finish. Public visibility is derived separately from current
    Tab reachability.
    """

    tab_analysis_ids = {
        analysis_id
        for tab in workspace.tabs.values()
        for analysis_id in tab.analysis_ids
    }

    def unavailable_dependency_record(
        record: AnalysisRecord,
        content: bytes,
        dependency: UnavailableChildRecord,
    ) -> UnavailableChildRecord:
        analysis_kind = analysis_kind_for_request(record.request)
        if dependency.reason == "incompatible_schema":
            if dependency.stored_schema_version is None:
                raise ValueError("Incompatible dependency is missing its schema version")
            return _incompatible_record(
                content,
                analysis_kind=analysis_kind,
                stored_schema_version=dependency.stored_schema_version,
                tab_id=record.tab_id,
            )
        return _record_invalid(
            content,
            analysis_kind=analysis_kind,
            tab_id=record.tab_id,
        )

    pending = list(records)
    while pending:
        next_pending: list[tuple[AnalysisRecord, bytes]] = []
        progressed = False
        for record, content in pending:
            analysis_id = record.id
            if record.tab_id in workspace.unavailable_tab_ids:
                unavailable[str(analysis_id)] = unavailable_dependency_record(
                    record,
                    content,
                    workspace.unavailable_tab_record(record.tab_id),
                )
                progressed = True
                continue
            try:
                validate_analysis_result_integrity(
                    workspace_root,
                    record,
                    set(workspace.nodes),
                )
            except (OSError, ValueError):
                unavailable[str(analysis_id)] = _record_invalid(
                    content,
                    analysis_kind=analysis_kind_for_request(record.request),
                    tab_id=record.tab_id,
                )
                progressed = True
                continue
            if set(analysis_input_ids(record.request)) & workspace.unavailable_node_ids:
                unavailable[str(analysis_id)] = _record_invalid(
                    content,
                    analysis_kind=analysis_kind_for_request(record.request),
                    tab_id=record.tab_id,
                )
                progressed = True
                continue
            parent_id = (
                record.parent_analysis_id
                if record.parent_analysis_id is not None
                else None
            )
            if parent_id is not None and str(parent_id) in unavailable:
                unavailable[str(analysis_id)] = unavailable_dependency_record(
                    record,
                    content,
                    unavailable[str(parent_id)],
                )
                progressed = True
                continue
            if parent_id is not None and parent_id not in workspace.analyses:
                next_pending.append((record, content))
                continue
            tab = workspace.tabs.get(record.tab_id)
            linked = analysis_id in tab_analysis_ids
            if linked and (tab is None or record.id not in tab.analysis_ids):
                unavailable[str(analysis_id)] = _record_invalid(
                    content,
                    analysis_kind=analysis_kind_for_request(record.request),
                    tab_id=record.tab_id,
                )
                progressed = True
                continue
            try:
                workspace.add_analysis(record, link_to_tab=linked)
            except ValueError:
                unavailable[str(analysis_id)] = _record_invalid(
                    content,
                    analysis_kind=analysis_kind_for_request(record.request),
                    tab_id=record.tab_id,
                )
            progressed = True
        if not progressed:
            for record, content in next_pending:
                unavailable[str(record.id)] = _record_invalid(
                    content,
                    analysis_kind=analysis_kind_for_request(record.request),
                    tab_id=record.tab_id,
                )
            break
        pending = next_pending

    for analysis_id in sorted(tab_analysis_ids):
        if analysis_id in workspace.analyses:
            continue
        unavailable.setdefault(
            str(analysis_id),
            _record_invalid(
                b"",
                tab_id=workspace.analysis_tab_id(analysis_id),
            ),
        )
    for raw_analysis_id, record in unavailable.items():
        analysis_id = uuid.UUID(raw_analysis_id)
        if analysis_id not in workspace.analyses:
            workspace.add_unavailable_analysis(analysis_id, record)


def _garbage_collect_workspace_analyses(
    workspace_root: Path,
    references: list[tuple[str, Path]],
    *,
    execution_owner_ids: set[str],
    artifact_owner_ids: set[str],
    query_snapshot_owner_ids: set[str],
) -> None:
    """Remove unreferenced Analysis generations after metadata publication."""

    analyses_root = workspace_root / "analyses"
    if not analyses_root.exists():
        return
    if not analyses_root.is_dir() or analyses_root.is_symlink():
        raise ValueError("Workspace analyses path is invalid")
    expected = {workspace_root / relative for _analysis_id, relative in references}
    expected_directories = {path.parent for path in expected}
    for analysis_directory in analyses_root.iterdir():
        if not analysis_directory.is_dir() or analysis_directory.is_symlink():
            if analysis_directory not in expected:
                analysis_directory.unlink(missing_ok=True)
            continue
        if analysis_directory not in expected_directories:
            shutil.rmtree(analysis_directory, ignore_errors=True)
            continue
        for candidate in analysis_directory.iterdir():
            if candidate in expected:
                continue
            if candidate.name == ".execution":
                if (
                    analysis_directory.name in execution_owner_ids
                    and candidate.is_dir()
                    and not candidate.is_symlink()
                ):
                    continue
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate, ignore_errors=True)
                else:
                    candidate.unlink(missing_ok=True)
                continue
            if candidate.name == "staged-output":
                if (
                    analysis_directory.name in execution_owner_ids
                    and candidate.is_dir()
                    and not candidate.is_symlink()
                ):
                    continue
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate, ignore_errors=True)
                else:
                    candidate.unlink(missing_ok=True)
                continue
            if candidate.name == "artifacts":
                if (
                    analysis_directory.name in artifact_owner_ids
                    and candidate.is_dir()
                    and not candidate.is_symlink()
                ):
                    continue
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate, ignore_errors=True)
                else:
                    candidate.unlink(missing_ok=True)
                continue
            if candidate.name == "query-input":
                if (
                    analysis_directory.name in query_snapshot_owner_ids
                    and candidate.is_dir()
                    and not candidate.is_symlink()
                ):
                    continue
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate, ignore_errors=True)
                else:
                    candidate.unlink(missing_ok=True)
                continue
            if candidate.is_dir() and not candidate.is_symlink():
                shutil.rmtree(candidate, ignore_errors=True)
            else:
                candidate.unlink(missing_ok=True)
        try:
            analysis_directory.rmdir()
        except OSError:
            pass
    try:
        analyses_root.rmdir()
    except OSError:
        pass


def _discard_uncommitted_files(paths: Iterable[Path], workspace_root: Path) -> None:
    """Remove failed generation files and any newly emptied directories."""

    parents: set[Path] = set()
    for path in paths:
        path.unlink(missing_ok=True)
        parents.add(path.parent)
    for parent in sorted(parents, key=lambda path: len(path.parts), reverse=True):
        current = parent
        while current != workspace_root:
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent


def _write_workspace(
    workspace: Workspace,
    path: str | Path,
    *,
    revision: int,
    max_snapshot_bytes: int,
    max_nodes: int,
) -> None:
    """Persist plans first, then atomically publish their metadata snapshot.

    ``WorkspaceService`` supplies the optimistic revision. Publishing it in the
    same metadata replacement as the graph makes that file the sole commit
    point for a workspace mutation.
    """

    target = _resolve_metadata_path(Path(path))
    description = workspace.description
    created_at = workspace.created_at.isoformat()
    modified_at = workspace.modified_at.isoformat()

    if len(workspace.node_ids) > max_nodes:
        raise WorkspaceCapacityError("Workspace exceeds its node-count limit")
    if workspace.unavailable_node_ids:
        raise ValueError("A Workspace with unavailable Data Blocks is read-only")

    generation = f"r{revision}-{uuid.uuid4().hex}"
    nodes_data: list[dict[str, Any]] = []
    tabs_data: list[dict[str, str]] = []
    analyses_data: list[dict[str, str]] = []
    created_plans: list[Path] = []
    created_tab_records: list[Path] = []
    created_analysis_records: list[Path] = []
    remaining = max_snapshot_bytes
    try:
        for node in workspace.nodes.values():
            if remaining < 1:
                raise WorkspaceCapacityError(
                    "Workspace snapshot exceeds its byte limit"
                )
            payload = node_to_dict(
                node,
                base_dir=target.parent,
                data_path=Path(NODE_DATA_DIR) / f"{node.id}.{generation}.plbin",
                max_data_bytes=remaining,
            )
            plan_path = target.parent / str(payload["data_path"])
            created_plans.append(plan_path)
            nodes_data.append(payload)
            remaining -= plan_path.stat().st_size

        for tab_id, tab in workspace.tabs.items():
            if tab_id != tab.id:
                raise ValueError("Workspace Tab key does not match its identity")
            tab_id_text = str(tab_id)
            relative = Path("tabs") / tab_id_text / f"{generation}.json"
            record_path = target.parent / relative
            record_bytes = atomic_write_json(
                record_path,
                _stored_tab_record(tab),
                max_bytes=remaining,
            )
            created_tab_records.append(record_path)
            tabs_data.append({"id": tab_id_text, "record_path": relative.as_posix()})
            remaining -= record_bytes

        for tab_id in sorted(workspace.unavailable_tab_ids):
            content = workspace.unavailable_tab_record(tab_id).content
            if len(content) > remaining:
                raise AtomicWriteCapacityError(
                    "Unavailable Tab record exceeds its storage budget"
                )
            tab_id_text = str(tab_id)
            relative = Path("tabs") / tab_id_text / f"{generation}.json"
            record_path = target.parent / relative
            with atomic_output_path(record_path) as temporary:
                temporary.write_bytes(content)
            created_tab_records.append(record_path)
            tabs_data.append({"id": tab_id_text, "record_path": relative.as_posix()})
            remaining -= len(content)

        for analysis_id, analysis in workspace.analyses.items():
            if analysis_id != analysis.id:
                raise ValueError("Workspace Analysis key does not match its identity")
            analysis_id_text = str(analysis_id)
            relative = (
                Path("analyses") / analysis_id_text / f"{generation}.json"
            )
            record_path = target.parent / relative
            record_bytes = atomic_write_json(
                record_path,
                _stored_analysis_record(analysis),
                max_bytes=remaining,
            )
            created_analysis_records.append(record_path)
            analyses_data.append(
                {"id": analysis_id_text, "record_path": relative.as_posix()}
            )
            remaining -= record_bytes

        for analysis_id in sorted(workspace.unavailable_analysis_ids):
            content = workspace.unavailable_analysis_record(analysis_id).content
            if len(content) > remaining:
                raise AtomicWriteCapacityError(
                    "Unavailable Analysis record exceeds its storage budget"
                )
            analysis_id_text = str(analysis_id)
            relative = (
                Path("analyses") / analysis_id_text / f"{generation}.json"
            )
            record_path = target.parent / relative
            with atomic_output_path(record_path) as temporary:
                temporary.write_bytes(content)
            created_analysis_records.append(record_path)
            analyses_data.append(
                {"id": analysis_id_text, "record_path": relative.as_posix()}
            )
            remaining -= len(content)

        workspace_metadata: dict[str, Any] = {
            "id": str(workspace.id),
            "name": workspace.name,
            "data_schema_version": WORKSPACE_DATA_SCHEMA_VERSION,
            "description": description,
            "created_at": created_at,
            "modified_at": modified_at,
        }
        workspace_metadata["revision"] = revision

        data = {
            "workspace_metadata": workspace_metadata,
            "nodes": nodes_data,
            "tabs": tabs_data,
            "analyses": analyses_data,
        }
        atomic_write_json(target, data, max_bytes=remaining)
    except NodePlanCapacityError as exc:
        _discard_uncommitted_files(
            [*created_plans, *created_tab_records, *created_analysis_records],
            target.parent,
        )
        raise WorkspaceCapacityError(
            "Workspace snapshot exceeds its byte limit"
        ) from exc
    except AtomicWriteCapacityError as exc:
        _discard_uncommitted_files(
            [*created_plans, *created_tab_records, *created_analysis_records],
            target.parent,
        )
        raise WorkspaceCapacityError(
            "Workspace snapshot exceeds its byte limit"
        ) from exc
    except BaseException:
        _discard_uncommitted_files(
            [*created_plans, *created_tab_records, *created_analysis_records],
            target.parent,
        )
        raise

    try:
        _garbage_collect_workspace_data(target.parent, nodes_data)
        _garbage_collect_workspace_tabs(
            target.parent,
            [(entry["id"], Path(entry["record_path"])) for entry in tabs_data],
        )
        _garbage_collect_workspace_analyses(
            target.parent,
            [(entry["id"], Path(entry["record_path"])) for entry in analyses_data],
            execution_owner_ids={
                str(analysis_id)
                for analysis_id, analysis in workspace.analyses.items()
                if analysis.state in {AnalysisState.QUEUED, AnalysisState.RUNNING}
                or (
                    analysis.execution_scope is AnalysisExecutionScope.SUPPORTING
                    and analysis.state is AnalysisState.SUCCEEDED
                    and analysis.parent_analysis_id is not None
                    and (
                        parent := workspace.analyses.get(analysis.parent_analysis_id)
                    )
                    is not None
                    and parent.state in {AnalysisState.QUEUED, AnalysisState.RUNNING}
                )
            }
            | {str(value) for value in workspace.unavailable_analysis_ids},
            artifact_owner_ids={
                str(analysis_id)
                for analysis_id, analysis in workspace.analyses.items()
                if analysis.state is AnalysisState.SUCCEEDED
            }
            | {str(value) for value in workspace.unavailable_analysis_ids},
            query_snapshot_owner_ids={
                str(analysis_id)
                for analysis_id, analysis in workspace.analyses.items()
                if analysis.state is AnalysisState.SUCCEEDED
                and analysis.query_snapshot is not None
            }
            | {str(value) for value in workspace.unavailable_analysis_ids},
        )
    except Exception:
        logger.warning(
            "Workspace data cleanup failed after metadata commit path=%s",
            target,
            exc_info=True,
        )


def _read_workspace_metadata(path: str | Path) -> dict[str, Any]:
    """Load and return the workspace metadata dictionary from workspace.json.

    This helper only reads/parses the JSON metadata file and does not attempt
    to load any node data payload files.
    """

    target = _resolve_metadata_path(Path(path))
    with target.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    if not isinstance(payload, dict):
        raise ValueError("Workspace metadata must be an object")
    workspace_metadata = payload.get("workspace_metadata")
    if not isinstance(workspace_metadata, dict):
        raise ValueError("Workspace metadata envelope is invalid")
    stored_version = workspace_metadata.get("data_schema_version")
    if (
        type(stored_version) is int
        and stored_version != WORKSPACE_DATA_SCHEMA_VERSION
    ):
        raise WorkspaceSchemaVersionError(
            stored_version,
            WORKSPACE_DATA_SCHEMA_VERSION,
            workspace_metadata,
        )
    if set(payload) != _WORKSPACE_ENVELOPE_FIELDS:
        raise ValueError("Workspace metadata envelope fields are invalid")
    nodes = payload.get("nodes")
    tabs = payload.get("tabs")
    analyses = payload.get("analyses")
    if (
        not isinstance(nodes, list)
        or not isinstance(tabs, list)
        or not isinstance(analyses, list)
    ):
        raise ValueError("Workspace metadata envelope is invalid")
    if set(workspace_metadata) != _WORKSPACE_METADATA_FIELDS:
        raise ValueError("Workspace metadata fields are invalid")
    if stored_version != WORKSPACE_DATA_SCHEMA_VERSION:
        raise ValueError("Workspace data schema version is invalid")
    if not isinstance(workspace_metadata.get("id"), str) or not isinstance(
        workspace_metadata.get("name"), str
    ):
        raise ValueError("Workspace identity metadata is invalid")
    _tab_references(payload)
    _analysis_references(payload)
    return payload


def _stored_schema_signature(raw_schema: object) -> tuple[tuple[str, str], ...]:
    if not isinstance(raw_schema, list):
        raise ValueError("Workspace Data Block schema is invalid")
    signature: list[tuple[str, str]] = []
    names: set[str] = set()
    for raw_field in raw_schema:
        if not isinstance(raw_field, Mapping) or set(raw_field) != {"name", "dtype"}:
            raise ValueError("Workspace Data Block schema field is invalid")
        name = raw_field["name"]
        dtype = raw_field["dtype"]
        if (
            not isinstance(name, str)
            or not name
            or name in names
            or not isinstance(dtype, str)
            or not dtype
        ):
            raise ValueError("Workspace Data Block schema field is invalid")
        names.add(name)
        signature.append((name, dtype))
    return tuple(signature)


def _read_workspace(
    path: str | Path,
    tabs: list[Tab],
    unavailable_tabs: dict[str, UnavailableChildRecord],
    analyses: list[tuple[AnalysisRecord, bytes]],
    unavailable_analyses: dict[str, UnavailableChildRecord],
    *,
    published_root: Path | None = None,
) -> Workspace:
    """Strictly reconstruct a committed graph without unresolved live parents.

    Metadata is validated in full before any node is published into the
    aggregate. Nodes are then constructed unattached, parent IDs are resolved
    against the complete node map, cycles are rejected, and registration
    follows the persisted display order.
    """
    from ...domain.workspace import Workspace

    target = _resolve_metadata_path(Path(path))
    data = _read_workspace_metadata(path)

    ws_meta = data["workspace_metadata"]
    workspace = Workspace(
        name=ws_meta["name"],
        workspace_id=uuid.UUID(ws_meta["id"]),
        created_at=datetime.fromisoformat(ws_meta["created_at"]),
        modified_at=datetime.fromisoformat(ws_meta["modified_at"]),
    )
    workspace.description = ws_meta["description"]

    ordered_ids: list[uuid.UUID] = []
    parent_ids_by_node: dict[uuid.UUID, list[uuid.UUID]] = {}
    node_specs_by_id: dict[
        uuid.UUID,
        tuple[
            pl.LazyFrame,
            str,
            NodeProvenance,
            str | None,
            str | None,
            str | None,
        ],
    ] = {}
    unavailable_node_ids: set[uuid.UUID] = set()
    all_node_ids: set[uuid.UUID] = set()
    data_paths: set[Path] = set()
    root = target.parent.resolve()
    declared_root = (
        published_root.resolve(strict=False) if published_root is not None else root
    )

    for raw_entry in data["nodes"]:
        if not isinstance(raw_entry, Mapping):
            raise ValueError("Workspace node entry must be an object")
        raw_metadata = raw_entry.get("node_metadata")
        if not isinstance(raw_metadata, Mapping):
            raise ValueError("Workspace node metadata must be an object")
        metadata = dict(raw_metadata)
        raw_id = metadata.get("id")
        if not isinstance(raw_id, str):
            raise ValueError("Workspace node ID must be a string")
        node_id = uuid.UUID(raw_id)
        if str(node_id) != raw_id:
            raise ValueError("Workspace node ID must be canonical")
        if node_id in all_node_ids:
            raise ValueError("Workspace contains duplicate node IDs")
        all_node_ids.add(node_id)

        provenance = validate_node_provenance(metadata.get("provenance"))
        parent_ids = referenced_node_ids(provenance)
        if node_id in parent_ids or len(parent_ids) != len(set(parent_ids)):
            raise ValueError("Workspace node provenance references are invalid")

        raw_data_path = raw_entry.get("data_path")
        if not isinstance(raw_data_path, str):
            raise ValueError("Workspace node data path must be a string")
        relative_data_path = Path(raw_data_path)
        if (
            relative_data_path.is_absolute()
            or ".." in relative_data_path.parts
            or relative_data_path.parts[:1] != (NODE_DATA_DIR,)
            or relative_data_path.suffix != ".plbin"
        ):
            raise ValueError("Workspace node data path is invalid")
        ordered_ids.append(node_id)
        parent_ids_by_node[node_id] = parent_ids
        try:
            if set(metadata) != {
                "id",
                "name",
                "provenance",
                "document",
                "color",
                "tokenizer_model",
                "schema",
            }:
                raise ValueError("Workspace node metadata fields are invalid")
            absolute_data_path = _resolve_regular_under(root, relative_data_path)
            if absolute_data_path.parent != (root / NODE_DATA_DIR).resolve(strict=True):
                raise ValueError("Workspace node data path escapes the data directory")
            if absolute_data_path in data_paths:
                raise ValueError("Workspace nodes cannot share a data path")
            validation_mapping: dict[str, str] = {}
            for raw_source in list_source_paths(absolute_data_path):
                source_path = Path(raw_source)
                if not source_path.is_absolute():
                    raise ValueError("Workspace plan source must be absolute")
                try:
                    relative_source = source_path.relative_to(declared_root)
                except ValueError as exc:
                    raise ValueError(
                        "Workspace plan source escapes its workspace"
                    ) from exc
                staged_source = _resolve_regular_under(root, relative_source)
                if raw_source != str(staged_source):
                    validation_mapping[raw_source] = str(staged_source)
            data_paths.add(absolute_data_path)

            name = metadata.get("name")
            if not isinstance(name, str) or not name:
                raise ValueError("Workspace node name is invalid")
            for optional_key in ("document", "color", "tokenizer_model"):
                if metadata.get(optional_key) is not None and not isinstance(
                    metadata.get(optional_key), str
                ):
                    raise ValueError(f"Workspace node {optional_key} is invalid")
            raw_tokenizer_model = metadata["tokenizer_model"]
            tokenizer_model = (
                raw_tokenizer_model.strip()
                if isinstance(raw_tokenizer_model, str)
                else None
            )
            if raw_tokenizer_model is not None and (
                not tokenizer_model or len(tokenizer_model) > 500
            ):
                raise ValueError("Workspace node tokenizer model is invalid")

            stored_schema = _stored_schema_signature(metadata["schema"])
            lazyframe = pl.LazyFrame.deserialize(absolute_data_path, format="binary")
            validation_plan = absolute_data_path
            temporary_validation_plan: Path | None = None
            try:
                if validation_mapping:
                    temporary_validation_plan = absolute_data_path.with_name(
                        f".{absolute_data_path.name}.validate-{uuid.uuid4().hex}"
                    )
                    shutil.copyfile(absolute_data_path, temporary_validation_plan)
                    rewritten = replace_source_paths(
                        temporary_validation_plan,
                        validation_mapping,
                    )
                    if rewritten != len(validation_mapping):
                        raise ValueError(
                            "Workspace validation plan rewrite was incomplete"
                        )
                    validation_plan = temporary_validation_plan
                loaded_schema = tuple(
                    (column, str(dtype))
                    for column, dtype in pl.LazyFrame.deserialize(
                        validation_plan,
                        format="binary",
                    )
                    .collect_schema()
                    .items()
                )
            finally:
                if temporary_validation_plan is not None:
                    temporary_validation_plan.unlink(missing_ok=True)
            if loaded_schema != stored_schema:
                raise ValueError("Workspace Data Block schema does not match metadata")
            document = metadata["document"]
            if document is not None and document not in dict(stored_schema):
                raise ValueError(
                    "Document Column Preference is absent from Data Block schema"
                )

            node_specs_by_id[node_id] = (
                lazyframe,
                name,
                provenance,
                document,
                metadata["color"],
                tokenizer_model,
            )
        except Exception:
            unavailable_node_ids.add(node_id)

    known_ids = set(parent_ids_by_node)
    if any(
        parent_id not in known_ids
        for parent_ids in parent_ids_by_node.values()
        for parent_id in parent_ids
    ):
        raise ValueError("Workspace node parent is missing")

    children: dict[uuid.UUID, list[uuid.UUID]] = {
        node_id: [] for node_id in ordered_ids
    }
    indegree = {node_id: len(parent_ids_by_node[node_id]) for node_id in ordered_ids}
    for child_id, parent_ids in parent_ids_by_node.items():
        for parent_id in parent_ids:
            children[parent_id].append(child_id)
    ready = deque(node_id for node_id in ordered_ids if indegree[node_id] == 0)
    visited = 0
    topological_ids: list[uuid.UUID] = []
    while ready:
        parent_id = ready.popleft()
        visited += 1
        topological_ids.append(parent_id)
        for child_id in children[parent_id]:
            indegree[child_id] -= 1
            if indegree[child_id] == 0:
                ready.append(child_id)
    if visited != len(ordered_ids):
        raise ValueError("Workspace node graph contains a cycle")

    nodes_by_id: dict[uuid.UUID, Node] = {}
    for node_id in topological_ids:
        parent_ids = parent_ids_by_node[node_id]
        if node_id in unavailable_node_ids or any(
            parent_id in workspace.unavailable_node_ids for parent_id in parent_ids
        ):
            workspace.add_unavailable_node(node_id, parent_ids)
            continue
        lazyframe, name, provenance, document, color, tokenizer_model = (
            node_specs_by_id[node_id]
        )
        node = Node(
            id=node_id,
            data=lazyframe,
            name=name,
            provenance=provenance,
            document=document,
            color=color,
            tokenizer_model=tokenizer_model,
            parents=[
                nodes_by_id[parent_id] for parent_id in parent_ids
            ],
        )
        nodes_by_id[node_id] = node
        workspace.add_node(node)
    workspace.reorder_nodes(ordered_ids)

    for tab in tabs:
        workspace.add_tab(tab)
    for tab_id, record in unavailable_tabs.items():
        workspace.add_unavailable_tab(uuid.UUID(tab_id), record)
    _add_workspace_analyses(
        workspace,
        target.parent,
        analyses,
        unavailable_analyses,
    )

    return workspace


def _rebase_workspace_sources(
    path: str | Path,
    *,
    published_root: Path | None = None,
) -> None:
    """Copy plans and compile their sources for the declared location."""

    target = _resolve_metadata_path(Path(path))
    data = _read_workspace_metadata(path)
    source_data_dir = (target.parent / NODE_DATA_DIR).resolve()
    final_root = (
        published_root.resolve(strict=False)
        if published_root is not None
        else target.parent.resolve()
    )
    published_data_dir = final_root / NODE_DATA_DIR

    changed = False
    generation = uuid.uuid4().hex
    for node_entry in data["nodes"]:
        source = (target.parent / Path(str(node_entry["data_path"]))).resolve()
        if not source.exists():
            continue
        node_metadata = node_entry.get("node_metadata")
        if not isinstance(node_metadata, dict) or not isinstance(
            node_metadata.get("id"), str
        ):
            raise ValueError("Workspace node metadata is invalid")
        relative = Path(NODE_DATA_DIR) / (
            f"{node_metadata['id']}.rebase-{generation}.plbin"
        )
        destination = target.parent / relative
        if _rebase_plan_copy(
            source,
            destination,
            source_data_dir=source_data_dir,
            published_data_dir=published_data_dir,
        ):
            node_entry["data_path"] = relative.as_posix()
            changed = True

    if not changed:
        return
    atomic_write_json(target, data)
    try:
        _garbage_collect_workspace_data(
            target.parent,
            data["nodes"],
            published_root=final_root,
        )
    except Exception:
        logger.warning(
            "Workspace data cleanup failed after rebase commit path=%s",
            target,
            exc_info=True,
        )


class WorkspaceStore:
    """Own the complete schema-9 workspace snapshot persistence contract.

    Used by ``WorkspaceService`` for live user workspaces and by archive/worker
    adapters only for private staging copies. Revision comparison, capacity
    bounds, plan generations, and metadata publication therefore have one
    implementation independent of FastAPI.
    """

    def __init__(self, *, max_nodes: int, max_snapshot_bytes: int) -> None:
        if max_nodes < 1 or max_snapshot_bytes < 1:
            raise ValueError("Workspace store limits must be positive")
        self.max_nodes = max_nodes
        self.max_snapshot_bytes = max_snapshot_bytes

    @staticmethod
    def _snapshot_info(payload: dict[str, Any]) -> WorkspaceSnapshotInfo:
        try:
            metadata = payload["workspace_metadata"]
            nodes = payload["nodes"]
            raw_workspace_id = metadata["id"]
            if not isinstance(raw_workspace_id, str):
                raise ValueError("Workspace ID must be a string")
            workspace_id = uuid.UUID(raw_workspace_id)
            if str(workspace_id) != raw_workspace_id:
                raise ValueError("Workspace ID is not canonical")
            name = metadata["name"]
            if not isinstance(name, str) or not name:
                raise ValueError("Workspace name is invalid")
            description = metadata["description"]
            created_at = metadata["created_at"]
            modified_at = metadata["modified_at"]
            if (
                not isinstance(description, str)
                or not isinstance(created_at, str)
                or not isinstance(modified_at, str)
            ):
                raise ValueError("Workspace descriptive metadata is invalid")
            created_timestamp = datetime.fromisoformat(created_at)
            modified_timestamp = datetime.fromisoformat(modified_at)
            if (
                created_timestamp.utcoffset() is None
                or modified_timestamp.utcoffset() is None
                or modified_timestamp < created_timestamp
            ):
                raise ValueError("Workspace timestamps are invalid")
            revision = metadata["revision"]
            if type(revision) is not int or revision < 1:
                raise ValueError("Workspace revision must be positive")
            if not isinstance(nodes, list):
                raise ValueError("Workspace nodes must be a list")
            tab_references = _tab_references(payload)
            analysis_references = _analysis_references(payload)
            node_ids: set[uuid.UUID] = set()
            parent_ids: set[uuid.UUID] = set()
            parents_by_node: dict[uuid.UUID, list[uuid.UUID]] = {}
            root_node_count = 0
            for entry in nodes:
                if not isinstance(entry, Mapping):
                    raise ValueError("Workspace node entry is invalid")
                node_metadata = entry.get("node_metadata")
                if not isinstance(node_metadata, Mapping):
                    raise ValueError("Workspace node metadata is invalid")
                raw_node_id = node_metadata["id"]
                if not isinstance(raw_node_id, str):
                    raise ValueError("Workspace node ID must be a string")
                node_id = uuid.UUID(raw_node_id)
                if str(node_id) != raw_node_id or node_id in node_ids:
                    raise ValueError("Workspace node ID is invalid")
                canonical_parents = referenced_node_ids(
                    validate_node_provenance(node_metadata.get("provenance"))
                )
                if node_id in canonical_parents:
                    raise ValueError("Workspace node provenance is invalid")
                node_ids.add(node_id)
                parents_by_node[node_id] = canonical_parents
                parent_ids.update(canonical_parents)
                root_node_count += not canonical_parents
            if not parent_ids <= node_ids:
                raise ValueError("Workspace node parent is missing")

            children: dict[uuid.UUID, list[uuid.UUID]] = {
                node_id: [] for node_id in node_ids
            }
            indegree = {node_id: len(parents_by_node[node_id]) for node_id in node_ids}
            for child_id, parents in parents_by_node.items():
                for parent_id in parents:
                    children[parent_id].append(child_id)
            ready = deque(node_id for node_id in node_ids if indegree[node_id] == 0)
            visited = 0
            while ready:
                parent_id = ready.popleft()
                visited += 1
                for child_id in children[parent_id]:
                    indegree[child_id] -= 1
                    if indegree[child_id] == 0:
                        ready.append(child_id)
            if visited != len(node_ids):
                raise ValueError("Workspace node graph contains a cycle")
        except (KeyError, TypeError, ValueError) as exc:
            raise WorkspaceSnapshotInvalidError(
                "Workspace snapshot identity or revision is invalid"
            ) from exc
        return WorkspaceSnapshotInfo(
            workspace_id=workspace_id,
            name=name,
            description=description,
            created_at=created_timestamp,
            modified_at=modified_timestamp,
            revision=revision,
            node_count=len(nodes),
            tab_count=len(tab_references),
            analysis_count=len(analysis_references),
            root_node_count=root_node_count,
            leaf_node_count=len(node_ids - parent_ids),
            serialized_bytes=0,
        )

    def prepare_import_identity(
        self,
        path: str | Path,
        *,
        workspace_id: uuid.UUID,
        name: str,
        revision: int,
        timestamp: datetime,
    ) -> WorkspaceSnapshotInfo:
        """Atomically publish validated installation identity metadata."""

        if not name or revision < 1 or timestamp.utcoffset() is None:
            raise WorkspaceSnapshotInvalidError("Workspace identity is invalid")
        try:
            target = _resolve_metadata_path(Path(path))
            payload = _read_workspace_metadata(target)
            metadata = payload["workspace_metadata"]
            metadata["id"] = str(workspace_id)
            metadata["name"] = name
            metadata["revision"] = revision
            metadata["created_at"] = timestamp.isoformat()
            metadata["modified_at"] = timestamp.isoformat()
            atomic_write_json(target, payload, max_bytes=self.max_snapshot_bytes)
            return self._inspect_complete(target)
        except WorkspaceStoreError:
            raise
        except (OSError, TypeError, ValueError) as exc:
            raise WorkspaceSnapshotInvalidError(
                "Workspace identity could not be published"
            ) from exc

    def inspect(self, path: str | Path) -> WorkspaceSnapshotInfo:
        """Validate lightweight Workspace state without opening child records."""

        return self._inspect(path, validate_tabs=False)

    def _inspect_complete(self, path: str | Path) -> WorkspaceSnapshotInfo:
        """Validate the complete serialized aggregate, including every Tab."""

        return self._inspect(path, validate_tabs=True)

    def _inspect(
        self,
        path: str | Path,
        *,
        validate_tabs: bool,
    ) -> WorkspaceSnapshotInfo:
        """Inspect either closed metadata or the complete openable snapshot."""

        try:
            target = _resolve_metadata_path(Path(path))
            payload = _read_workspace_metadata(target)
            info = self._snapshot_info(payload)
        except WorkspaceStoreError:
            raise
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise WorkspaceSnapshotInvalidError(
                "Workspace snapshot is invalid"
            ) from exc
        if info.node_count > self.max_nodes:
            raise WorkspaceCapacityError("Workspace node count exceeds its limit")
        total_bytes = target.stat().st_size
        seen_paths: set[Path] = set()
        root = target.parent.resolve()
        try:
            for entry in payload["nodes"]:
                try:
                    relative = Path(entry["data_path"])
                    if relative.is_absolute() or ".." in relative.parts:
                        raise ValueError("Workspace plan path is invalid")
                    plan = _resolve_regular_under(root, relative)
                    if plan in seen_paths:
                        raise ValueError("Workspace nodes cannot share a plan")
                    seen_paths.add(plan)
                    total_bytes += plan.stat().st_size
                except (KeyError, OSError, TypeError, ValueError):
                    continue
        except (KeyError, OSError, TypeError, ValueError) as exc:
            raise WorkspaceSnapshotInvalidError(
                "Workspace snapshot plan references are invalid"
            ) from exc
        if validate_tabs:
            if total_bytes > self.max_snapshot_bytes:
                raise WorkspaceCapacityError(
                    "Workspace snapshot exceeds its byte limit"
                )
            references = _tab_references(payload)
            _tabs, _unavailable_tabs, tab_bytes = _read_tabs(
                root,
                references,
                max_bytes=self.max_snapshot_bytes - total_bytes,
            )
            total_bytes += tab_bytes
            _records, _unavailable_analyses, analysis_bytes = _read_analysis_records(
                root,
                _analysis_references(payload),
                max_bytes=self.max_snapshot_bytes - total_bytes,
            )
            total_bytes += analysis_bytes
        if total_bytes > self.max_snapshot_bytes:
            raise WorkspaceCapacityError("Workspace snapshot exceeds its byte limit")
        return replace(info, serialized_bytes=total_bytes)

    def reconcile(self, path: str | Path) -> WorkspaceSnapshotInfo:
        """Remove crash-orphaned generations after validating the commit point.

        Called under ``WorkspaceService``'s process lock only after explicit
        open has loaded the Workspace successfully. Unreferenced generations
        and private Analysis storage are removed according to the committed
        lifecycle records.
        """

        info = self._inspect_complete(path)
        try:
            target = _resolve_metadata_path(Path(path))
            payload = _read_workspace_metadata(target)
            _garbage_collect_workspace_data(target.parent, payload["nodes"])
            _garbage_collect_workspace_tabs(
                target.parent,
                _tab_references(payload),
            )
            analysis_references = _analysis_references(payload)
            (
                execution_owner_ids,
                artifact_owner_ids,
                query_snapshot_owner_ids,
            ) = _analysis_private_owner_ids(
                target.parent,
                analysis_references,
                max_bytes=self.max_snapshot_bytes,
            )
            _garbage_collect_workspace_analyses(
                target.parent,
                analysis_references,
                execution_owner_ids=execution_owner_ids,
                artifact_owner_ids=artifact_owner_ids,
                query_snapshot_owner_ids=query_snapshot_owner_ids,
            )
        except (OSError, TypeError, ValueError) as exc:
            raise WorkspaceSnapshotInvalidError(
                "Workspace orphan generations could not be reconciled"
            ) from exc
        return info

    def rebase_snapshot_sources(
        self,
        path: str | Path,
        *,
        published_root: Path | None = None,
    ) -> WorkspaceSnapshotInfo:
        """Compile plan sources for their declared publication root."""

        self._inspect_complete(path)
        try:
            _rebase_workspace_sources(path, published_root=published_root)
        except WorkspaceStoreError:
            raise
        except (OSError, RuntimeError, ValueError) as exc:
            raise WorkspaceSnapshotInvalidError(
                "Workspace plan sources cannot be relocated"
            ) from exc
        return self._inspect_complete(path)

    def load(
        self,
        path: str | Path,
        *,
        published_root: Path | None = None,
    ) -> LoadedWorkspace:
        """Reconstruct a graph without mutating its committed snapshot."""

        snapshot = self._inspect_complete(path)
        try:
            target = _resolve_metadata_path(Path(path))
            payload = _read_workspace_metadata(target)
            tabs, unavailable_tabs, _tab_bytes = _read_tabs(
                target.parent.resolve(),
                _tab_references(payload),
                max_bytes=self.max_snapshot_bytes,
            )
            analyses, unavailable_analyses, _analysis_bytes = _read_analysis_records(
                target.parent.resolve(),
                _analysis_references(payload),
                max_bytes=self.max_snapshot_bytes,
            )
            workspace = _read_workspace(
                path,
                tabs,
                unavailable_tabs,
                analyses,
                unavailable_analyses,
                published_root=published_root,
            )
        except WorkspaceStoreError:
            raise
        except (OSError, ValueError) as exc:
            raise WorkspaceSnapshotInvalidError(
                "Workspace graph cannot be loaded"
            ) from exc
        return LoadedWorkspace(workspace=workspace, snapshot=snapshot)

    def stage_snapshot(
        self,
        path: str | Path,
        workspace: Workspace,
        *,
        revision: int,
    ) -> WorkspaceSnapshotInfo:
        """Serialize one uncommitted snapshot for exact capacity admission.

        ``path`` must be a fresh private staging directory. The caller removes
        it after inspecting the resulting byte size; this method never changes
        a live Workspace or chooses a Revision.
        """

        if revision < 1:
            raise ValueError("Workspace revision must be positive")
        target = _resolve_metadata_path(Path(path))
        if target.exists():
            raise WorkspaceRevisionConflictError(None, self.inspect(path).revision)
        try:
            _write_workspace(
                workspace,
                path,
                revision=revision,
                max_snapshot_bytes=self.max_snapshot_bytes,
                max_nodes=self.max_nodes,
            )
        except WorkspaceCapacityError:
            raise
        except (OSError, TypeError, ValueError) as exc:
            raise WorkspaceSerializationError(
                "Workspace snapshot could not be staged"
            ) from exc
        return self._inspect_complete(path)

    def commit_staged(
        self,
        path: str | Path,
        staging: str | Path,
        *,
        expected_revision: int,
    ) -> WorkspaceSnapshotInfo:
        """Publish one validated staged generation with metadata as commit point."""

        destination = _resolve_metadata_path(Path(path))
        staged_metadata = _resolve_metadata_path(Path(staging))
        actual = self._inspect_complete(path)
        staged = self._inspect_complete(staging)
        if actual.revision != expected_revision:
            raise WorkspaceRevisionConflictError(expected_revision, actual.revision)
        if (
            staged.workspace_id != actual.workspace_id
            or staged.revision != expected_revision + 1
        ):
            raise WorkspaceSnapshotInvalidError(
                "Staged Workspace identity or revision is invalid"
            )

        payload = _read_workspace_metadata(staged_metadata)
        analysis_references = _analysis_references(payload)
        (
            execution_owner_ids,
            artifact_owner_ids,
            query_snapshot_owner_ids,
        ) = _analysis_private_owner_ids(
            staged_metadata.parent,
            analysis_references,
            max_bytes=self.max_snapshot_bytes,
        )
        moved_directories: set[Path] = set()
        try:
            for entry in payload["nodes"]:
                relative = Path(entry["data_path"])
                source = _resolve_regular_under(staged_metadata.parent, relative)
                target = destination.parent / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, target)
                moved_directories.add(target.parent)
            for _tab_id, relative in _tab_references(payload):
                source = _resolve_regular_under(staged_metadata.parent, relative)
                target = destination.parent / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, target)
                moved_directories.add(target.parent)
            for _analysis_id, relative in analysis_references:
                source = _resolve_regular_under(staged_metadata.parent, relative)
                target = destination.parent / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, target)
                moved_directories.add(target.parent)
            for directory in moved_directories:
                fsync_directory(directory)
            os.replace(staged_metadata, destination)
            fsync_directory(destination.parent)
        except WorkspaceStoreError:
            raise
        except (KeyError, OSError, TypeError, ValueError) as exc:
            raise WorkspaceSerializationError(
                "Staged Workspace snapshot could not be published"
            ) from exc

        try:
            _garbage_collect_workspace_data(destination.parent, payload["nodes"])
            _garbage_collect_workspace_tabs(
                destination.parent,
                _tab_references(payload),
            )
            _garbage_collect_workspace_analyses(
                destination.parent,
                analysis_references,
                execution_owner_ids=execution_owner_ids,
                artifact_owner_ids=artifact_owner_ids,
                query_snapshot_owner_ids=query_snapshot_owner_ids,
            )
        except Exception:
            logger.warning(
                "Workspace data cleanup failed after staged commit path=%s",
                destination,
                exc_info=True,
            )
        return staged

    def commit(
        self,
        path: str | Path,
        workspace: Workspace,
        *,
        expected_revision: int | None,
    ) -> WorkspaceSnapshotInfo:
        """Create revision 1 or atomically advance one matching snapshot."""

        target = _resolve_metadata_path(Path(path))
        actual: int | None = None
        if target.exists():
            actual = self.inspect(path).revision
        if expected_revision is None:
            if actual is not None:
                raise WorkspaceRevisionConflictError(None, actual)
            next_revision = 1
        else:
            if expected_revision < 1:
                raise ValueError("Expected revision must be positive")
            if actual != expected_revision:
                raise WorkspaceRevisionConflictError(expected_revision, actual)
            next_revision = expected_revision + 1
        try:
            _write_workspace(
                workspace,
                path,
                revision=next_revision,
                max_snapshot_bytes=self.max_snapshot_bytes,
                max_nodes=self.max_nodes,
            )
        except WorkspaceCapacityError:
            raise
        except (OSError, TypeError, ValueError) as exc:
            raise WorkspaceSerializationError(
                "Workspace snapshot could not be serialized"
            ) from exc
        return self._inspect_complete(path)


__all__ = [
    "ANALYSIS_SCHEMA_VERSIONS",
    "LoadedWorkspace",
    "WORKSPACE_DATA_SCHEMA_VERSION",
    "WorkspaceCapacityError",
    "WorkspaceRevisionConflictError",
    "WorkspaceSerializationError",
    "WorkspaceSnapshotInfo",
    "WorkspaceSnapshotInvalidError",
    "WorkspaceStore",
    "WorkspaceStoreError",
]
