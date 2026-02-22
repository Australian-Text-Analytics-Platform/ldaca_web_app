"""Workspace core module: node management & graph structure.

Split from the former monolithic workspace.py. This module is intentionally
focused only on core graph/data responsibilities. Complementary concerns:

 - serialization: workspace/io.py
 - analysis & graph JSON views: workspace/analysis.py

Import path backwards compatibility is preserved via the original
`docworkspace.workspace` shim that re-exports Workspace.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

import polars_text  # noqa: F401  (register text namespace side-effects)

from ..node import Node


class Workspace:
    """Core workspace managing a collection of Nodes and their relationships."""

    def __init__(
        self,
        name: Optional[str] = None,
        workspace_id: Optional[str] = None,
        created_at: Optional[str] = None,
        modified_at: Optional[str] = None,
    ) -> None:
        now = datetime.now().isoformat()

        self.id = workspace_id or str(uuid.uuid4())
        self.name = name or f"workspace_{self.id[:8]}"
        self.nodes: Dict[str, Node] = {}
        self.description: str = ""
        self.created_at: Optional[str] = created_at or now
        self.modified_at: Optional[str] = modified_at or now
        self.analysis: Any = None  # Placeholder for analysis storage/manager

    # Node management -------------------------------------------------

    def add_node(self, node: Node) -> Node:
        if node.id in self.nodes:
            return node
        if getattr(node, "workspace", None) is not None and node.workspace is not self:
            if node.id in node.workspace.nodes:
                del node.workspace.nodes[node.id]
        self.nodes[node.id] = node
        node.workspace = self

        def move_children_recursive(current: Node) -> None:
            for child in current.children:
                if child.id not in self.nodes:
                    if child.workspace is not None and child.workspace is not self:
                        if child.id in child.workspace.nodes:
                            del child.workspace.nodes[child.id]
                    self.nodes[child.id] = child
                    child.workspace = self
                    move_children_recursive(child)

        move_children_recursive(node)
        return node

    def remove_node(self, node_id: str) -> bool:
        if node_id not in self.nodes:
            return False
        node = self.nodes[node_id]
        parent_nodes = node.parents.copy()
        child_nodes = node.children.copy()

        # Rewire graph so children inherit the removed node's parents.
        for child in child_nodes:
            if node in child.parents:
                child.parents.remove(node)
            for parent in parent_nodes:
                if parent is child:
                    continue
                if child not in parent.children:
                    parent.children.append(child)
                if parent not in child.parents:
                    child.parents.append(parent)

        for parent in parent_nodes:
            if node in parent.children:
                parent.children.remove(node)

        node.parents = []
        node.children = []
        del self.nodes[node_id]

        # Best-effort cleanup for on-disk persisted node payloads.
        # The core library remains usable without any persistence context; the
        # backend attaches `_workspace_dir` when a workspace is loaded/saved.
        try:
            ws_dir = getattr(self, "_workspace_dir", None)
            if ws_dir is not None:
                data_file = Path(ws_dir) / "data" / f"{node_id}.plbin"
                if data_file.exists():
                    data_file.unlink()
        except Exception:
            pass
        return True

    # Lookup helpers -------------------------------------------------
    def get_node(self, node_id: str) -> Optional[Node]:
        return self.nodes.get(node_id)

    def get_node_by_name(self, name: str) -> Optional[Node]:
        for node in self.nodes.values():
            if node.name == name:
                return node
        return None

    def get_node_by_uuid(self, uuid: str) -> Optional[Node]:  # Backward compat
        return self.nodes.get(uuid)

    def list_nodes(self) -> List[Node]:
        return list(self.nodes.values())

    def get_root_nodes(self) -> List[Node]:
        return [n for n in self.nodes.values() if not n.parents]

    def get_leaf_nodes(self) -> List[Node]:
        return [n for n in self.nodes.values() if not n.children]

    # NOTE: Advanced graph algorithms (descendants, ancestors, shortest path,
    # cycle detection, connectivity, topological order) removed to keep the
    # core minimal. Reintroduce only with strong use cases and dedicated tests.

    # Metadata --------------------------------------------------------
    def get_metadata(self, key: str) -> Any:
        if key == "description":
            return self.description
        if key == "created_at":
            return self.created_at
        if key == "modified_at":
            return self.modified_at
        return None

    def set_metadata(self, key: str, value: Any) -> None:
        if key == "description":
            self.description = value if value is not None else ""
            return
        if key == "created_at":
            self.created_at = value
            return
        if key == "modified_at":
            self.modified_at = value
            return
        raise ValueError(f"Unsupported metadata key: {key}")

    @property
    def metadata_keys(self) -> list[str]:
        keys: list[str] = []
        if self.description:
            keys.append("description")
        if self.created_at:
            keys.append("created_at")
        if self.modified_at:
            keys.append("modified_at")
        return keys

    # Dunder ----------------------------------------------------------
    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"Workspace(id={self.id[:8]}, name='{self.name}', nodes={len(self.nodes)})"
        )

    def __iter__(self) -> Iterator[Node]:
        return iter(self.nodes.values())

    def __len__(self) -> int:
        return len(self.nodes)

    def __bool__(self) -> bool:
        return True

    # Persistence helpers ------------------------------------------------
    def save(self, path: str | Path) -> str | Path:  # pragma: no cover
        """Persist workspace to disk."""
        from .io import write_workspace

        write_workspace(self, path)
        return path

    @classmethod
    def load(cls, path: str | Path) -> "Workspace":  # pragma: no cover
        """Load workspace from disk path."""
        from .io import read_workspace

        return read_workspace(path)

    def info_json(self) -> Dict[str, Any]:  # pragma: no cover
        from .analysis import info_json

        return info_json(self)

    def graph_json(self) -> Dict[str, Any]:  # pragma: no cover
        from .analysis import graph_json

        return graph_json(self)


__all__ = ["Workspace"]
