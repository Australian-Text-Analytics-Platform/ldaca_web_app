"""Workspace file persistence helpers.

Provides file-based helpers (`write_workspace` / `read_workspace`) for the
current metadata.json + binary node-payload persistence format.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Union

import polars as pl

if TYPE_CHECKING:  # pragma: no cover
    from .core import Workspace

from ..node import Node


def _resolve_metadata_path(path: Path) -> Path:
    if path.is_dir():
        return path / "metadata.json"
    if path.suffix.lower() == ".json":
        return path
    raise ValueError("Workspace path must be a directory or a .json file")


def _serialize_node_data_to_file(node: Node, root_dir: Path) -> str:
    """Serialize a node's data into a binary file under root_dir/data.

    Returns a POSIX-style relative path (e.g. "data/<node_id>.plbin").
    """

    data_dir = root_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    # Always serialize the underlying Polars LazyFrame. The document metadata
    # is reconstructed from `node.document` on load.
    lf = node.data
    if not isinstance(lf, pl.LazyFrame):
        # Defensive: Node inputs are normalized to LazyFrame,
        # but keep a clear error if something unexpected slips through.
        raise TypeError(
            f"Unsupported node.data type for binary persistence: {type(node.data).__name__}"
        )

    rel_path = Path("data") / f"{node.id}.plbin"
    abs_path = (root_dir / rel_path).resolve()

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        payload = lf.serialize(format="binary")

    abs_path.write_bytes(payload)
    return rel_path.as_posix()


def write_workspace(workspace: "Workspace", path: Union[str, Path]) -> None:
    target = _resolve_metadata_path(Path(path))
    target.parent.mkdir(parents=True, exist_ok=True)

    # Persist node data as separate binary files under ./data and keep metadata.json
    # small by storing only relative file paths.
    description = workspace.description
    created_at = workspace.created_at
    modified_at = workspace.modified_at

    nodes_data: list[dict[str, Any]] = []
    expected_node_files: set[str] = set()
    for node in workspace.nodes.values():
        rel_data_path = _serialize_node_data_to_file(node, target.parent)
        expected_node_files.add(Path(rel_data_path).name)
        node_metadata: Dict[str, Any] = {
            "id": node.id,
            "name": node.name,
            "operation": node.operation,
            "data_type": "LazyFrame",
            "document": node.document,
            "parents": [p.id for p in node.parents],
        }
        nodes_data.append({
            "node_metadata": node_metadata,
            "data_path": rel_data_path,
            "data_format": "polars-binary-v1",
        })

    workspace_metadata: Dict[str, Any] = {
        "id": workspace.id,
        "name": workspace.name,
        "version": 2,
        "description": description,
        "created_at": created_at,
        "modified_at": modified_at,
    }

    data = {"workspace_metadata": workspace_metadata, "nodes": nodes_data}
    with target.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Cleanup orphaned node payloads. Only touches *.plbin files (the workspace
    # persistence format), and leaves other files (e.g., parquet uploads) alone.
    try:
        data_dir = target.parent / "data"
        if data_dir.exists() and data_dir.is_dir():
            for candidate in data_dir.glob("*.plbin"):
                if candidate.name not in expected_node_files:
                    try:
                        candidate.unlink()
                    except Exception:
                        pass
    except Exception:
        pass


def read_workspace(path: Union[str, Path]) -> "Workspace":
    from .core import Workspace

    target = _resolve_metadata_path(Path(path))
    with target.open("r", encoding="utf-8") as f:
        data = json.load(f)

    ws_meta = data.get("workspace_metadata", {})
    workspace = Workspace(name=ws_meta.get("name", "restored_workspace"))
    workspace.id = ws_meta.get("id", workspace.id)
    workspace.description = ws_meta.get("description", "") or ""
    workspace.created_at = ws_meta.get("created_at")
    workspace.modified_at = ws_meta.get("modified_at")

    node_map: dict[str, Node] = {}
    for node_entry in data.get("nodes", []):
        node_meta = node_entry.get("node_metadata", {})
        data_path = node_entry.get("data_path")
        if not data_path:
            raise ValueError("Missing node data_path in workspace metadata")

        file_path = (target.parent / str(data_path)).resolve()
        if not file_path.exists():
            raise FileNotFoundError(f"Missing node data file: {file_path}")

        with file_path.open("rb") as fh:
            lf = pl.LazyFrame.deserialize(fh, format="binary")

        node = Node.__new__(Node)
        node.id = node_meta["id"]
        node.name = node_meta["name"]
        node.data = lf
        node._document_column = node_meta.get("document")
        node.parents = []
        node.children = []
        node.workspace = workspace
        node.operation = node_meta.get("operation")

        workspace.nodes[node.id] = node
        node_map[node.id] = node

    for node_entry in data.get("nodes", []):
        node_meta = node_entry.get("node_metadata", {})
        node_id = node_meta.get("id")
        if node_id is None or node_id not in node_map:
            continue
        node = node_map[node_id]
        for parent_id in node_meta.get("parents", []):
            parent = node_map.get(parent_id)
            if parent is None:
                continue
            if node not in parent.children:
                parent.children.append(node)
            if parent not in node.parents:
                node.parents.append(parent)

    return workspace


__all__ = [
    "write_workspace",
    "read_workspace",
]
