"""Graph view & visualization helpers split from monolithic workspace.py.

Provides a structured graph() returning nodes/edges/workspace_info matching
legacy expectations plus a human-readable visualize_graph() that includes
"Graph Info:" marker required by tests.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Dict, List

if TYPE_CHECKING:  # pragma: no cover
    from .core import Workspace


def graph(workspace: "Workspace") -> Dict[str, object]:
    nodes_payload: List[Dict[str, object]] = []
    edges_payload: List[Dict[str, str]] = []
    for node in workspace.nodes.values():
        nodes_payload.append(
            {
                "id": node.id,
                "name": node.name,
                "type": type(node.data).__name__,
                "lazy": node.is_lazy,
                "operation": node.operation or "load",
                "parent_count": len(node.parents),
                "child_count": len(node.children),
            }
        )
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


def visualize_graph(workspace: "Workspace") -> str:
    lines = [f"Workspace: {workspace.name}", "Graph Info:"]
    lines.append(
        f" Total Nodes: {len(workspace.nodes)} | Roots: {len(workspace.get_root_nodes())} | Leafs: {len(workspace.get_leaf_nodes())}"
    )
    for node in workspace.nodes.values():
        children = ", ".join(c.name for c in node.children) or "<none>"
        lines.append(f" - {node.name} ({type(node.data).__name__}) -> {children}")
    return "\n".join(lines)


__all__ = ["graph", "visualize_graph"]
