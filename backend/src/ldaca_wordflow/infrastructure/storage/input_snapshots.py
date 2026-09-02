"""Immutable LazyFrame plan snapshots for process-backed analysis.

Analysis preparation uses this module to hand workers immutable references to
the requested Node plans without materializing corpus rows on the FastAPI event
loop. Workers load the snapshot and perform expensive schema, collection,
tokenization, or Artifact work in fresh child processes.
"""

from __future__ import annotations

import os
import shutil
import stat
import tempfile
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import polars as pl
from polars_source_utils import list_source_paths, replace_source_paths
from pydantic import BaseModel, ConfigDict

from ...domain.workspace import Node, Workspace
from .durable_fs import (
    atomic_output_path,
    fsync_directory as _fsync_directory,
    fsync_file,
    mkdir_durable as _mkdir_durable,
)
from .safe_paths import is_link_or_reparse

from ...shared.errors import ResourceTooLargeError
_SNAPSHOT_FILENAME = "snapshot.json"
_SNAPSHOT_DATA_DIR = "data"


class _SnapshotNodeManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: uuid.UUID
    name: str
    document: str | None
    color: str | None
    data_path: str


class _SnapshotManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    workspace_id: uuid.UUID
    nodes: dict[uuid.UUID, _SnapshotNodeManifest]


@dataclass(frozen=True)
class SnapshotNode:
    """Node plan and metadata loaded from an execution input snapshot.

    Worker processes receive this immutable projection instead of a live
    Workspace or large pre-collected Python lists. It mirrors only the subset
    of domain ``Node`` state needed by Analyses.
    """

    id: uuid.UUID
    name: str
    data: pl.LazyFrame
    document: str | None
    color: str | None

    def to_node(self) -> Node:
        """Build a detached domain node for existing worker helpers."""

        return Node(
            data=self.data,
            name=self.name,
            id=self.id,
            document=self.document,
            color=self.color,
        )


def _node_snapshot_payload(node: Node, rel_data_path: Path) -> _SnapshotNodeManifest:
    """Build JSON metadata for one snapshotted node.

    Called by:
    - ``create_worker_input_snapshot`` while serializing selected nodes for a
      worker process.
    """

    return _SnapshotNodeManifest(
        id=node.id,
        name=node.name,
        document=node.document,
        color=node.color,
        data_path=rel_data_path.as_posix(),
    )


@contextmanager
def _snapshot_staging(destination: Path) -> Iterator[Path]:
    staging = Path(
        tempfile.mkdtemp(
            prefix=f".{destination.name}.",
            suffix=".tmp",
            dir=destination.parent,
        )
    )
    try:
        yield staging
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def _publish_snapshot(
    staging: Path,
    destination: Path,
    manifest: _SnapshotManifest,
) -> Path:
    metadata_path = staging / _SNAPSHOT_FILENAME
    with metadata_path.open("w", encoding="utf-8") as handle:
        handle.write(manifest.model_dump_json(indent=2))
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    _fsync_directory(staging / _SNAPSHOT_DATA_DIR)
    _fsync_directory(staging / "sources")
    _fsync_directory(staging)
    os.replace(staging, destination)
    _fsync_directory(destination.parent)
    return destination


def create_worker_input_snapshot(
    *,
    workspace_id: uuid.UUID,
    node_ids: list[uuid.UUID],
    workspace: Workspace,
    workspace_data_dir: str | Path,
    snapshot_dir: str | Path,
    max_snapshot_bytes: int,
) -> Path:
    """Atomically publish selected Data Block plans to one private directory."""

    resolved_data_dir = Path(workspace_data_dir).resolve(strict=True)
    destination = Path(snapshot_dir)
    if max_snapshot_bytes < 1:
        raise ValueError("Execution snapshot byte limit must be positive")
    if workspace.id != workspace_id:
        raise ValueError("Workspace snapshot identity does not match the aggregate")
    if len(node_ids) != len(set(node_ids)):
        raise ValueError("Execution input node identifiers must be unique")

    snapshot_root = destination.parent
    _mkdir_durable(snapshot_root)
    if destination.exists():
        raise FileExistsError("Execution input snapshot already exists")
    with _snapshot_staging(destination) as staging:
        data_dir = staging / _SNAPSHOT_DATA_DIR
        data_dir.mkdir()
        sources_dir = staging / "sources"
        sources_dir.mkdir()
        published_sources_dir = destination / "sources"

        nodes: dict[uuid.UUID, _SnapshotNodeManifest] = {}
        for node_id in node_ids:
            node = workspace.nodes.get(node_id)
            if node is None:
                raise KeyError(f"Node {node_id} not found")
            if node.id != node_id:
                raise ValueError(
                    f"Workspace node key does not match node id: {node_id}"
                )
            rel_data_path = Path(_SNAPSHOT_DATA_DIR) / f"{node_id}.plbin"
            plan_path = staging / rel_data_path
            node.data.serialize(plan_path, format="binary")
            _snapshot_plan_sources(
                plan_path,
                source_root=resolved_data_dir,
                staging_sources=sources_dir,
                published_sources=published_sources_dir,
            )
            _fsync_file(plan_path)
            nodes[node_id] = _node_snapshot_payload(node, rel_data_path)
            if _tree_size(staging) > max_snapshot_bytes:
                raise ResourceTooLargeError(
                    "Execution input snapshot exceeds its storage budget"
                )

        payload = _SnapshotManifest(
            workspace_id=workspace_id,
            nodes=nodes,
        )
        return _publish_snapshot(staging, destination, payload)


def clone_worker_input_snapshot(
    source_dir: str | Path,
    destination_dir: str | Path,
    *,
    max_snapshot_bytes: int,
) -> Path:
    """Publish a self-contained copy of an existing immutable input snapshot."""

    source = Path(source_dir).resolve(strict=True)
    manifest = _SnapshotManifest.model_validate_json(
        (source / _SNAPSHOT_FILENAME).read_bytes()
    )
    destination = Path(destination_dir)
    if max_snapshot_bytes < 1:
        raise ValueError("Execution snapshot byte limit must be positive")
    if destination.exists():
        raise FileExistsError("Execution input snapshot already exists")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with _snapshot_staging(destination) as staging:
        data_dir = staging / _SNAPSHOT_DATA_DIR
        data_dir.mkdir()
        sources_dir = staging / "sources"
        sources_dir.mkdir()
        published_sources = destination / "sources"
        source_sources = source / "sources"

        for node in manifest.nodes.values():
            source_plan = _snapshot_member(
                source,
                node.data_path,
                required_parent=_SNAPSHOT_DATA_DIR,
            )
            destination_plan = staging / node.data_path
            destination_plan.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_plan, destination_plan)
            _snapshot_plan_sources(
                destination_plan,
                source_root=source_sources,
                staging_sources=sources_dir,
                published_sources=published_sources,
            )
            _fsync_file(destination_plan)
            if _tree_size(staging) > max_snapshot_bytes:
                raise ResourceTooLargeError(
                    "Execution input snapshot exceeds its storage budget"
                )

        return _publish_snapshot(staging, destination, manifest)


def rebase_worker_input_snapshot_sources(
    snapshot_dir: str | Path,
    *,
    workspace_id: uuid.UUID | None = None,
    published_snapshot_dir: Path | None = None,
) -> None:
    """Compile a retained snapshot for its declared publication directory."""

    root = Path(snapshot_dir).resolve(strict=True)
    published_root = (
        published_snapshot_dir.resolve(strict=False)
        if published_snapshot_dir is not None
        else root
    )
    metadata_path = root / _SNAPSHOT_FILENAME
    manifest = _SnapshotManifest.model_validate_json(metadata_path.read_bytes())
    if workspace_id is not None and manifest.workspace_id != workspace_id:
        manifest = manifest.model_copy(update={"workspace_id": workspace_id})
        with atomic_output_path(metadata_path) as temporary:
            temporary.write_text(
                f"{manifest.model_dump_json(indent=2)}\n",
                encoding="utf-8",
            )
    for node in manifest.nodes.values():
        plan_path = _snapshot_member(
            root,
            node.data_path,
            required_parent=_SNAPSHOT_DATA_DIR,
        )
        mapping: dict[str, str] = {}
        for raw_source in list_source_paths(plan_path):
            source_path = Path(raw_source)
            if not source_path.is_absolute() or source_path.parent.name != "sources":
                raise ValueError("Execution snapshot plan source has an invalid owner")
            relocated = _snapshot_member(
                root,
                str(Path("sources") / source_path.name),
                required_parent="sources",
            )
            published_source = published_root / "sources" / relocated.name
            if raw_source != str(published_source):
                mapping[raw_source] = str(published_source)
        if not mapping:
            continue
        with atomic_output_path(plan_path) as temporary:
            shutil.copyfile(plan_path, temporary)
            rewritten = replace_source_paths(temporary, mapping)
            if rewritten != len(mapping):
                raise RuntimeError(
                    "Execution snapshot plan source rewrite was incomplete"
                )
        _fsync_file(plan_path)
    _fsync_directory(root / _SNAPSHOT_DATA_DIR)
    for node in manifest.nodes.values():
        plan_path = _snapshot_member(
            root,
            node.data_path,
            required_parent=_SNAPSHOT_DATA_DIR,
        )
        for raw_source in list_source_paths(plan_path):
            try:
                relative_source = Path(raw_source).relative_to(published_root)
            except ValueError as exc:
                raise ValueError(
                    "Execution snapshot plan source escapes its publication root"
                ) from exc
            _snapshot_member(root, str(relative_source), required_parent="sources")
        pl.LazyFrame.deserialize(plan_path, format="binary")


def _fsync_file(path: Path) -> None:
    fsync_file(path)


def _tree_size(root: Path) -> int:
    return sum(
        candidate.stat().st_size
        for candidate in root.rglob("*")
        if candidate.is_file() and not candidate.is_symlink()
    )


def _snapshot_plan_sources(
    plan_path: Path,
    *,
    source_root: Path,
    staging_sources: Path,
    published_sources: Path,
) -> None:
    """Pin every scan source and rewrite the plan to private immutable files."""

    raw_sources = list_source_paths(plan_path)
    mapping: dict[str, str] = {}
    for raw_source in raw_sources:
        source = _require_contained_regular(source_root, raw_source)
        digest = sha256(str(source).encode("utf-8")).hexdigest()
        suffix = source.suffix if len(source.suffix) <= 16 else ""
        filename = f"{digest}{suffix}"
        staging_destination = staging_sources / filename
        if not staging_destination.exists():
            try:
                os.link(source, staging_destination, follow_symlinks=False)
            except OSError, TypeError:
                with (
                    source.open("rb") as input_file,
                    staging_destination.open("xb") as output_file,
                ):
                    shutil.copyfileobj(input_file, output_file)
            _fsync_file(staging_destination)
        mapping[raw_source] = str((published_sources / filename).resolve(strict=False))
    if mapping:
        rewritten = replace_source_paths(plan_path, mapping)
        if rewritten != len(raw_sources):
            raise RuntimeError(
                "Execution snapshot plan source rewrite was incomplete"
            )


def _require_contained_regular(root: Path, raw_source: str) -> Path:
    """Resolve one plan source below an owned root without following links."""

    candidate = Path(raw_source)
    if not candidate.is_absolute():
        raise RuntimeError("Execution snapshot plan contains a relative source")
    resolved_root = root.resolve(strict=True)
    try:
        relative = candidate.resolve(strict=True).relative_to(resolved_root)
    except (OSError, ValueError) as exc:
        raise RuntimeError("Execution snapshot plan source escapes workspace data") from exc
    current = resolved_root
    for part in relative.parts:
        current = current / part
        metadata = current.lstat()
        if is_link_or_reparse(metadata):
            raise RuntimeError("Execution snapshot plan source contains a link")
    if not stat.S_ISREG(current.stat().st_mode):
        raise RuntimeError("Execution snapshot plan source is not a regular file")
    return current


def load_snapshot_node(
    snapshot_dir: str | Path, node_id: uuid.UUID
) -> SnapshotNode:
    """Load one snapshotted node plan for worker-side analysis preparation.

    Used by:
    - fresh Analysis child processes so expensive Polars operations happen
      outside the API event loop.
    """

    root = Path(snapshot_dir)
    payload = _SnapshotManifest.model_validate_json(
        (root / _SNAPSHOT_FILENAME).read_bytes()
    )
    raw_node = payload.nodes.get(node_id)
    if raw_node is None:
        raise KeyError(f"Node {node_id} is missing from execution input snapshot")
    if raw_node.id != node_id:
        raise ValueError("Execution input snapshot node key does not match its id")

    plan_path = _snapshot_member(root, raw_node.data_path, required_parent="data")
    for raw_source in list_source_paths(plan_path):
        _snapshot_member(root, raw_source, required_parent="sources")
    data = pl.LazyFrame.deserialize(plan_path, format="binary")
    return SnapshotNode(
        id=raw_node.id,
        name=raw_node.name,
        data=data,
        document=raw_node.document,
        color=raw_node.color,
    )


def _snapshot_member(root: Path, raw_path: str, *, required_parent: str) -> Path:
    """Resolve one regular snapshot member inside its exact owned subtree."""

    root = root.resolve(strict=True)
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        relative = candidate.resolve(strict=True).relative_to(root)
    except (OSError, ValueError) as exc:
        raise ValueError("Execution input snapshot member escapes its root") from exc
    if not relative.parts or relative.parts[0] != required_parent:
        raise ValueError("Execution input snapshot member has an invalid owner")
    return _require_contained_regular(root, str(candidate))


__all__ = [
    "SnapshotNode",
    "clone_worker_input_snapshot",
    "create_worker_input_snapshot",
    "load_snapshot_node",
    "rebase_worker_input_snapshot_sources",
]
