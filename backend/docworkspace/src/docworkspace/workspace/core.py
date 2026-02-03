"""Workspace core module: node management & graph structure.

Split from the former monolithic workspace.py. This module is intentionally
focused only on core graph/data responsibilities. Complementary concerns:

 - serialization: workspace/io.py
 - analysis & summary: workspace/analysis.py
 - graph views / visualization: workspace/graph_views.py

Import path backwards compatibility is preserved via the original
`docworkspace.workspace` shim that re-exports Workspace.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Union

import polars as pl

import docframe  # noqa: F401  (register text namespace side-effects)

from ..node import Node


class Workspace:
    """Core workspace managing a collection of Nodes and their relationships."""

    def __init__(
        self,
        name: Optional[str] = None,
        data: Optional[Union[str, Path, pl.DataFrame, pl.LazyFrame, Any]] = None,
        data_name: Optional[str] = None,
        csv_lazy: bool = True,
        **csv_kwargs,
    ) -> None:
        self.id = str(uuid.uuid4())
        self.name = name or f"workspace_{self.id[:8]}"
        self.nodes: Dict[str, Node] = {}
        self.description: str = ""
        self.created_at: Optional[str] = None
        self.modified_at: Optional[str] = None
        self.analysis: Any = None  # Placeholder for analysis storage/manager
        if data is not None:
            self._load_initial_data(data, data_name, csv_lazy, **csv_kwargs)

    # Node management -------------------------------------------------
    def _load_initial_data(
        self,
        data: Union[str, Path, pl.DataFrame, pl.LazyFrame, Any],
        data_name: Optional[str] = None,
        csv_lazy: bool = True,
        **csv_kwargs,
    ) -> Node:
        if isinstance(data, (str, Path)):
            file_path = Path(data)
            if csv_lazy:
                df = pl.scan_csv(file_path, **csv_kwargs)
            else:
                df = pl.read_csv(file_path, **csv_kwargs)
            node_name = data_name or f"csv_{file_path.stem}"
            operation = f"load_csv({file_path})"
        else:
            df = data
            node_name = data_name or f"data_{len(self.nodes)}"
            operation = "load_data"
        node = Node(data=df, name=node_name, workspace=self, operation=operation)
        return self.add_node(node)

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

    def remove_node(self, node_id: str, materialize_children: bool = False) -> bool:
        if node_id not in self.nodes:
            return False
        node = self.nodes[node_id]
        if materialize_children:
            for child in node.children.copy():
                child.materialize()
        for parent in node.parents:
            if node in parent.children:
                parent.children.remove(node)
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

    # Backward-compatible helpers (serialize/deserialize & summaries) ----
    def serialize(self, path: Any, format: str = "json") -> Any:  # pragma: no cover
        """Serialize workspace to a metadata.json file inside a folder (json only).

        Parameters
        ----------
        path : str | Path
            Destination directory or metadata.json file path.
        format : str
            Currently only 'json' supported. 'binary' raises NotImplementedError.
        """
        from pathlib import Path as _P

        from .io import write_workspace

        if format == "binary":
            raise NotImplementedError("Binary workspace serialization not implemented")
        if format != "json":
            raise ValueError(f"Unsupported format: {format}")
        if isinstance(path, (str, _P)):
            write_workspace(self, path)
            return path
        raise TypeError("Path must be str or Path for serialize")

    @classmethod
    def deserialize(
        cls, path: Any, format: str = "json"
    ) -> "Workspace":  # pragma: no cover
        from pathlib import Path as _P

        from .io import deserialize_workspace, read_workspace

        if format == "binary":
            raise NotImplementedError(
                "Binary workspace deserialization not implemented"
            )
        if format != "json":
            raise ValueError(f"Unsupported format: {format}")
        if isinstance(path, (str, _P)):
            return read_workspace(path)
        if isinstance(path, dict):
            return deserialize_workspace(path, format=format)
        raise TypeError("Unsupported input for deserialize (expect path or dict)")

    def to_dict(self) -> Dict[str, Any]:  # pragma: no cover
        from .io import serialize_workspace

        return serialize_workspace(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Workspace":  # pragma: no cover
        """Build workspace from dictionary using the current serialization format."""
        if "workspace_metadata" not in data:
            raise ValueError("Invalid workspace dict: missing workspace_metadata")
        return cls.deserialize(data)

    def summary(self, json: bool = False) -> Dict[str, Any]:  # pragma: no cover
        from .analysis import summary

        return summary(self, json=json)

    def info(self, json: bool = False) -> Dict[str, Any]:  # pragma: no cover
        from .analysis import info

        return info(self, json=json)

    def graph(self) -> Dict[str, Any]:  # pragma: no cover
        from .graph_views import graph

        return graph(self)

    def visualize_graph(self) -> str:  # pragma: no cover
        from .graph_views import visualize_graph

        return visualize_graph(self)


__all__ = ["Workspace"]
