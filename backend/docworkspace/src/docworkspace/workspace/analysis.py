"""Workspace analysis helpers.

`info_json` returns concise structural workspace metrics.
`graph_json` returns graph-only payloads (nodes + edges).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List

if TYPE_CHECKING:  # pragma: no cover
    from .core import Workspace


def info_json(workspace: "Workspace") -> Dict[str, Any]:
    total_nodes = len(workspace.nodes)
    root_nodes = len(workspace.get_root_nodes())
    leaf_nodes = len(workspace.get_leaf_nodes())

    return {
        "name": workspace.name,
        "id": workspace.id,
        "description": workspace.description or "",
        "created_at": workspace.created_at,
        "modified_at": workspace.modified_at,
        "total_nodes": total_nodes,
        "root_nodes": root_nodes,
        "leaf_nodes": leaf_nodes,
    }


def graph_json(workspace: "Workspace") -> Dict[str, object]:
    nodes_payload: List[Dict[str, object]] = []
    edges_payload: List[Dict[str, str]] = []

    for node in workspace.nodes.values():
        nodes_payload.append(node.info())

        for child in node.children:
            edges_payload.append({"source": node.id, "target": child.id})

    return {
        "nodes": nodes_payload,
        "edges": edges_payload,
    }


__all__ = ["info_json", "graph_json"]
