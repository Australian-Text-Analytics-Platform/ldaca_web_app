"""Serialization & deserialization utilities split from monolithic workspace.py.

Extended to provide file-based helpers (`write_workspace` / `read_workspace`) for
backward compatibility with previous serialize/deserialize workflows.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Union

if TYPE_CHECKING:  # pragma: no cover
    from .core import Workspace

from ..node import Node


def serialize_workspace(workspace: "Workspace", format: str = "json") -> Dict[str, Any]:
    if format != "json":
        raise ValueError(f"Unsupported format: {format}")

    description = workspace.description
    created_at = workspace.created_at
    modified_at = workspace.modified_at
    nodes_data = []
    for node in workspace.nodes.values():
        node_serialized = node.serialize(format=format)
        node_serialized["node_metadata"]["parents"] = [p.id for p in node.parents]
        nodes_data.append(node_serialized)

    workspace_metadata: Dict[str, Any] = {
        "id": workspace.id,
        "name": workspace.name,
        "version": 1,
        "description": description,
        "created_at": created_at,
        "modified_at": modified_at,
    }

    return {
        "workspace_metadata": workspace_metadata,
        "nodes": nodes_data,
    }


def deserialize_workspace(data: Dict[str, Any], format: str = "json") -> "Workspace":
    if format != "json":
        raise ValueError(f"Unsupported format: {format}")
    from .core import Workspace

    ws_meta = data.get("workspace_metadata", {})
    workspace = Workspace(name=ws_meta.get("name", "restored_workspace"))
    workspace.id = ws_meta.get("id", workspace.id)

    workspace.description = ws_meta.get("description", "") or ""
    workspace.created_at = ws_meta.get("created_at")
    workspace.modified_at = ws_meta.get("modified_at")

    node_map: Dict[str, Node] = {}
    for serialized_node in data.get("nodes", []):
        node = Node.deserialize(serialized_node, workspace=workspace, format=format)
        node_map[node.id] = node
    for serialized_node in data.get("nodes", []):
        meta = serialized_node["node_metadata"]
        node_id = meta["id"]
        parent_ids = meta.get("parents", [])
        node = node_map[node_id]
        for pid in parent_ids:
            parent = node_map.get(pid)
            if parent and node not in parent.children:
                parent.children.append(node)
            if parent and parent not in node.parents:
                node.parents.append(parent)
    return workspace


def _resolve_metadata_path(path: Path) -> Path:
    if path.is_dir():
        return path / "metadata.json"
    if path.suffix.lower() == ".json":
        return path
    raise ValueError("Workspace path must be a directory or a .json file")


def write_workspace(workspace: "Workspace", path: Union[str, Path]) -> None:
    target = _resolve_metadata_path(Path(path))
    target.parent.mkdir(parents=True, exist_ok=True)
    data = serialize_workspace(workspace)
    with target.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def read_workspace(path: Union[str, Path]) -> "Workspace":
    target = _resolve_metadata_path(Path(path))
    with target.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return deserialize_workspace(data)


__all__ = [
    "serialize_workspace",
    "deserialize_workspace",
    "write_workspace",
    "read_workspace",
]
