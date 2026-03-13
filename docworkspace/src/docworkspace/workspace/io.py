"""Workspace file persistence helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Union

if TYPE_CHECKING:  # pragma: no cover
    from .core import Workspace

from ..node.io import from_dict as node_from_dict
from ..node.io import to_dict as node_to_dict


def _resolve_metadata_path(path: Path) -> Path:
    if path.is_dir():
        return path / "metadata.json"
    if path.suffix.lower() == ".json":
        return path
    raise ValueError("Workspace path must be a directory or a .json file")


def write_workspace(workspace: "Workspace", path: Union[str, Path]) -> None:
    target = _resolve_metadata_path(Path(path))
    target.parent.mkdir(parents=True, exist_ok=True)
    workspace.ws_root_dir = target.parent

    description = workspace.description
    created_at = workspace.created_at
    modified_at = workspace.modified_at

    nodes_data: list[dict[str, Any]] = []
    for node in workspace.nodes.values():
        nodes_data.append(node_to_dict(node))

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

    try:
        data_dir = target.parent / "data"
        expected_node_files = {
            Path(str(node_payload["data_path"])).name for node_payload in nodes_data
        }
        if data_dir.exists() and data_dir.is_dir():
            for candidate in data_dir.glob("*.plbin"):
                if candidate.name not in expected_node_files:
                    candidate.unlink(missing_ok=True)
    except Exception:
        pass


def read_workspace_metadata(path: Union[str, Path]) -> Dict[str, Any]:
    """Load and return the workspace metadata dictionary from metadata.json.

    This helper only reads/parses the JSON metadata file and does not attempt
    to load any node data payload files.
    """

    target = _resolve_metadata_path(Path(path))
    with target.open("r", encoding="utf-8") as f:
        return json.load(f)


def read_workspace(path: Union[str, Path]) -> "Workspace":
    from .core import Workspace

    target = _resolve_metadata_path(Path(path))
    data = read_workspace_metadata(path)

    ws_meta = data.get("workspace_metadata", {})
    workspace = Workspace(
        name=ws_meta.get("name", "restored_workspace"),
        ws_root_dir=target.parent,
    )
    workspace.id = ws_meta.get("id", workspace.id)
    workspace.description = ws_meta.get("description", "") or ""
    workspace.created_at = ws_meta.get("created_at")
    workspace.modified_at = ws_meta.get("modified_at")

    for node_entry in data.get("nodes", []):
        workspace.add_node(node_from_dict(node_entry, workspace=workspace))

    return workspace


__all__ = [
    "write_workspace",
    "read_workspace_metadata",
    "read_workspace",
]
