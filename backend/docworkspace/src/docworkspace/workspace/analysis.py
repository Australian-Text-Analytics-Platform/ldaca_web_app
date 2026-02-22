"""Workspace analysis helpers.

`info_json` returns structured workspace information required by tests and API:
 - total_nodes, root_nodes, leaf_nodes
 - node_types counts, status_counts (lazy/eager)
 - metadata_keys from workspace metadata
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List

if TYPE_CHECKING:  # pragma: no cover
    from .core import Workspace


def info_json(workspace: "Workspace") -> Dict[str, Any]:
    total_nodes = len(workspace.nodes)
    root_nodes = len(workspace.get_root_nodes())
    leaf_nodes = len(workspace.get_leaf_nodes())
    node_types: Dict[str, int] = {}
    for node in workspace.nodes.values():
        t = type(node.data).__name__
        node_types[t] = node_types.get(t, 0) + 1
    status_counts = {"lazy": total_nodes, "eager": 0}
    return {
        "name": workspace.name,
        "id": workspace.id,
        "total_nodes": total_nodes,
        "root_nodes": root_nodes,
        "leaf_nodes": leaf_nodes,
        "node_types": node_types,
        "status_counts": status_counts,
        "metadata_keys": workspace.metadata_keys,
    }


def graph_json(workspace: "Workspace") -> Dict[str, object]:
    nodes_payload: List[Dict[str, object]] = []
    edges_payload: List[Dict[str, str]] = []
    for node in workspace.nodes.values():
        nodes_payload.append({
            "id": node.id,
            "name": node.name,
            "type": type(node.data).__name__,
            "operation": node.operation or "load",
            "parent_count": len(node.parents),
            "child_count": len(node.children),
        })
        for child in node.children:
            edges_payload.append({"source": node.id, "target": child.id})
    return {
        "nodes": nodes_payload,
        "edges": edges_payload,
        "workspace_info": {
            "id": workspace.id,
            "name": workspace.name,
            "total_nodes": len(workspace.nodes),
            "root_nodes": len(workspace.get_root_nodes()),
            "leaf_nodes": len(workspace.get_leaf_nodes()),
        },
    }


__all__ = ["info_json", "graph_json"]
