"""Analysis & summary helpers split from monolithic workspace.py.

`summary` now returns richer information required by existing tests and API:
 - total_nodes, root_nodes, leaf_nodes
 - node_types counts, status_counts (lazy/eager)
 - metadata_keys from workspace metadata
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict

if TYPE_CHECKING:  # pragma: no cover
    from .core import Workspace


def summary(workspace: "Workspace", json: bool = False) -> Dict[str, Any]:
    total_nodes = len(workspace.nodes)
    root_nodes = len(workspace.get_root_nodes())
    leaf_nodes = len(workspace.get_leaf_nodes())
    node_types: Dict[str, int] = {}
    lazy_count = 0
    for node in workspace.nodes.values():
        t = type(node.data).__name__
        node_types[t] = node_types.get(t, 0) + 1
        if node.is_lazy:
            lazy_count += 1
    status_counts = {"lazy": lazy_count, "eager": total_nodes - lazy_count}
    return {
        "workspace": workspace.name,
        "workspace_id": workspace.id,
        "total_nodes": total_nodes,
        "root_nodes": root_nodes,
        "leaf_nodes": leaf_nodes,
        "node_types": node_types,
        "status_counts": status_counts,
        "metadata_keys": list(workspace._metadata.keys()),  # type: ignore[attr-defined]
    }


def info(workspace: "Workspace", json: bool = False) -> Dict[str, Any]:
    return summary(workspace, json=json)


__all__ = ["summary", "info"]
