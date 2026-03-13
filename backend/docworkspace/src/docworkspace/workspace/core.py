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
from tempfile import mkdtemp
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
        ws_root_dir: str | Path | None = None,
    ) -> None:
        now = datetime.now().isoformat()

        self.id = workspace_id or str(uuid.uuid4())
        self.name = name or f"workspace_{self.id[:8]}"
        self.nodes: Dict[str, Node] = {}
        self.description: str = ""
        self.created_at: Optional[str] = created_at or now
        self.modified_at: Optional[str] = modified_at or now
        self.analysis: Any = None  # Placeholder for analysis storage/manager
        self.ws_root_dir = (
            Path(ws_root_dir)
            if ws_root_dir is not None
            else Path(mkdtemp(prefix=f"docworkspace_{self.id}_"))
        )
        self.ws_root_dir.mkdir(parents=True, exist_ok=True)

    # Node management -------------------------------------------------

    @staticmethod
    def _dedupe_parent_refs(parents: list[Node | str]) -> list[Node | str]:
        deduped: list[Node | str] = []
        seen: set[str] = set()
        for parent in parents:
            key = parent.id if isinstance(parent, Node) else str(parent)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(parent)
        return deduped

    def _resolve_node_parents(self, node: Node) -> None:
        resolved: list[Node | str] = []
        for parent in node.parents:
            if isinstance(parent, Node):
                resolved.append(parent)
                continue

            parent_id = str(parent)
            parent_node = self.nodes.get(parent_id)
            resolved.append(parent_node if parent_node is not None else parent_id)

        node.parents = self._dedupe_parent_refs(resolved)

    def _resolve_existing_parent_references(self, parent_node: Node) -> None:
        for candidate in self.nodes.values():
            if candidate is parent_node:
                continue

            replaced = False
            new_parents: list[Node | str] = []
            for parent in candidate.parents:
                if isinstance(parent, str) and parent == parent_node.id:
                    new_parents.append(parent_node)
                    replaced = True
                else:
                    new_parents.append(parent)

            if replaced:
                candidate.parents = self._dedupe_parent_refs(new_parents)

    def add_node(self, node: Node) -> Node:
        if node.id in self.nodes:
            node.workspace = self
            self._resolve_node_parents(node)
            self._resolve_existing_parent_references(node)
            return node
        source_workspace = getattr(node, "workspace", None)
        if source_workspace is not None and source_workspace is not self:
            if node.id in source_workspace.nodes:
                del source_workspace.nodes[node.id]
        self.nodes[node.id] = node
        node.workspace = self
        self._resolve_node_parents(node)
        self._resolve_existing_parent_references(node)

        def move_children_recursive(current: Node) -> None:
            if source_workspace is None:
                return
            child_nodes = [
                candidate
                for candidate in source_workspace.nodes.values()
                if any(
                    candidate._parent_matches(parent, current)
                    for parent in candidate.parents
                )
            ]
            for child in child_nodes:
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
            child.parents = [
                parent
                for parent in child.parents
                if not child._parent_matches(parent, node)
            ]
            for parent in parent_nodes:
                if (isinstance(parent, Node) and parent is child) or (
                    isinstance(parent, str) and parent == child.id
                ):
                    continue
                if parent not in child.parents:
                    child.parents.append(parent)
            child.parents = self._dedupe_parent_refs(child.parents)

        node.parents = []
        del self.nodes[node_id]

        try:
            data_file = self.ws_root_dir / "data" / f"{node_id}.plbin"
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
