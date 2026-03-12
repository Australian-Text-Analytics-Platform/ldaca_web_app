"""Node persistence helpers.

This module owns the serialized representation of a single :class:`Node`.
Node metadata is stored in JSON, while the underlying Polars ``LazyFrame`` is
persisted as a binary payload under a workspace-relative ``data/`` directory.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path
from typing import TYPE_CHECKING, Any, Mapping

import polars as pl

from .core import Node

if TYPE_CHECKING:  # pragma: no cover
    from ..workspace.core import Workspace


NODE_DATA_DIR = "data"


def to_dict(node: Node) -> dict[str, Any]:
    """Serialize a node into the workspace JSON envelope.

    The returned dictionary is JSON-safe and includes a relative ``data_path``
    pointing at the binary ``LazyFrame`` payload persisted under ``data/``.
    """

    Path(NODE_DATA_DIR).mkdir(parents=True, exist_ok=True)
    rel_data_path = Path(NODE_DATA_DIR) / f"{node.id}.plbin"

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        node.data.serialize(rel_data_path, format="binary")

    return {
        "node_metadata": {
            "id": node.id,
            "name": node.name,
            "operation": node.operation,
            "document": node.document,
            "parents": [parent.id for parent in node.parents],
        },
        "data_path": rel_data_path.as_posix(),
    }


def from_dict(
    payload: Mapping[str, Any],
    *,
    workspace: "Workspace",
) -> Node:
    """Reconstruct a node from its serialized dictionary representation."""

    node_metadata = dict(payload["node_metadata"])
    data_path = payload["data_path"]
    parent_ids = node_metadata.pop("parents", [])
    parents = [
        workspace.nodes[parent_id]
        for parent_id in parent_ids
        if parent_id in workspace.nodes
    ]
    lf = pl.LazyFrame.deserialize(source=data_path, format="binary")

    return Node(data=lf, workspace=workspace, parents=parents, **node_metadata)


def dumps(node: Node, **json_kwargs: Any) -> str:
    """Serialize a node to a JSON string after persisting its LazyFrame."""

    return json.dumps(to_dict(node), **json_kwargs)


def loads(payload: str, *, workspace: "Workspace") -> Node:
    """Deserialize a node from a JSON string payload."""

    return from_dict(json.loads(payload), workspace=workspace)


__all__ = [
    "NODE_DATA_DIR",
    "to_dict",
    "from_dict",
    "dumps",
    "loads",
]
