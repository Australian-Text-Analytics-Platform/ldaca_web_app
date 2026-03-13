"""Node persistence helpers.

This module owns the serialized representation of a single :class:`Node`.
Node metadata is stored in JSON, while the underlying Polars ``LazyFrame`` is
persisted as a binary payload under a workspace-relative ``data/`` directory.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, Mapping

import polars as pl

from .core import Node

if TYPE_CHECKING:  # pragma: no cover
    from ..workspace.core import Workspace


NODE_DATA_DIR = "data"


def to_dict(node: Node, *, base_dir: str | Path | None = None) -> dict[str, Any]:
    """Serialize a node into the workspace JSON envelope."""

    if node.workspace is not None:
        root_dir = Path(node.workspace.ws_root_dir)
    elif base_dir is not None:
        root_dir = Path(base_dir)
    else:
        raise ValueError(
            "Unattached nodes require an explicit base_dir for serialization"
        )

    data_dir = root_dir / NODE_DATA_DIR
    data_dir.mkdir(parents=True, exist_ok=True)
    rel_data_path = Path(NODE_DATA_DIR) / f"{node.id}.plbin"
    abs_data_path = root_dir / rel_data_path

    node.data.serialize(abs_data_path, format="binary")

    return {
        "node_metadata": {
            "id": node.id,
            "name": node.name,
            "operation": node.operation,
            "document": node.document,
            "parents": [node._parent_id(parent) for parent in node.parents],
        },
        "data_path": rel_data_path.as_posix(),
    }


def from_dict(
    payload: Mapping[str, Any],
    *,
    workspace: "Workspace | None" = None,
    base_dir: str | Path | None = None,
) -> Node:
    """Reconstruct a node from its serialized dictionary representation."""

    node_metadata = dict(payload["node_metadata"])
    data_path = Path(str(payload["data_path"]))
    parent_ids = node_metadata.pop("parents", [])

    if workspace is not None:
        root_dir = Path(workspace.ws_root_dir)
    elif base_dir is not None:
        root_dir = Path(base_dir)
    else:
        raise ValueError(
            "Unattached nodes require an explicit base_dir for deserialization"
        )

    lf = pl.LazyFrame.deserialize(root_dir / data_path, format="binary")

    if workspace is None:
        return Node(data=lf, workspace=None, parents=list(parent_ids), **node_metadata)

    parents = [
        workspace.nodes[parent_id]
        for parent_id in parent_ids
        if parent_id in workspace.nodes
    ]
    return Node(data=lf, workspace=workspace, parents=parents, **node_metadata)


def dumps(
    node: Node,
    *,
    base_dir: str | Path | None = None,
    **json_kwargs: Any,
) -> str:
    """Serialize a node to a JSON string after persisting its LazyFrame."""

    return json.dumps(to_dict(node, base_dir=base_dir), **json_kwargs)


def loads(
    payload: str,
    *,
    workspace: "Workspace | None" = None,
    base_dir: str | Path | None = None,
) -> Node:
    """Deserialize a node from a JSON string payload."""

    return from_dict(json.loads(payload), workspace=workspace, base_dir=base_dir)


__all__ = ["NODE_DATA_DIR", "to_dict", "from_dict", "dumps", "loads"]
