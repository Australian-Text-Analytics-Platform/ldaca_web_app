"""Project the Workspace aggregate's physical node state into API model input."""

from __future__ import annotations

from typing import Any

from ..domain.workspace import Node
from ..domain.workspace.provenance import describe_provenance


def canonical_node_info(node: Node) -> dict[str, Any]:
    """Map one registered domain node into strict `WorkspaceNodeInfo` input."""
    column_count = len(node.data.collect_schema())

    return {
        "id": node.id,
        "name": node.name,
        "provenance": node.provenance,
        "derivation_description": describe_provenance(
            node.provenance,
            resolve_name=lambda node_id: (
                node.workspace.nodes[node_id].name
                if node.workspace is not None and node_id in node.workspace.nodes
                else None
            ),
        ),
        "parent_ids": [parent.id for parent in node.parents],
        "child_ids": [child.id for child in node.children],
        "document": node.document,
        "color": node.color,
        "shape": (node.shape[0], column_count),
        "tokenizer_model": node.tokenizer_model,
        "can_undo": node.can_undo,
        "can_redo": node.can_redo,
    }


__all__ = ["canonical_node_info"]
