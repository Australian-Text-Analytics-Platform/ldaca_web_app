"""Node core definition (split from former monolithic node.py).

Contains structural aspects: construction, parent/child tracking, schema helpers,
materialization, serialization (kept minimal for workspace persistence),
and core dataframe operations (join/filter/slice/dynamic delegation).
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import polars as pl

if False:  # TYPE_CHECKING replacement to avoid runtime import cycle
    from ..workspace.core import Workspace  # pragma: no cover


class Node:
    def __init__(
        self,
        data: pl.LazyFrame,
        name: str | None = None,
        workspace: Optional["Workspace"] = None,
        parents: list["Node"] | None = None,
        operation: str | None = None,
    ) -> None:
        from ..workspace.core import Workspace  # local import to avoid cycle

        self.id = str(uuid.uuid4())
        self.name = name or f"node_{self.id[:8]}"

        if not isinstance(data, pl.LazyFrame):
            raise TypeError(
                "Node data must be a polars LazyFrame "
                f"(received {type(data).__name__})."
            )
        self.data: pl.LazyFrame = data
        self._document_column: Optional[str] = None
        self.parents: list[Node] = parents or []
        self.children: list[Node] = []

        if workspace is None:
            workspace = Workspace(name=f"workspace_for_{self.name}")
        self.workspace: Workspace = workspace  # type: ignore
        self.operation = operation

        if self.id not in self.workspace.nodes:
            self.workspace.add_node(self)

        for parent in self.parents:
            parent.children.append(self)

    # ------------------------------------------------------------------
    # Delegation helpers
    # ------------------------------------------------------------------
    def _wrap_result(self, result: pl.LazyFrame, op_name: str) -> "Node":
        """Wrap a LazyFrame result into a new Node preserving lineage."""
        child = Node(
            data=result,
            name=f"{op_name}_{self.name}",
            workspace=self.workspace,
            parents=[self],
            operation=op_name,
        )
        if self.document:
            child.document = self.document
        return child

    def __getattr__(self, item: str) -> Any:  # pragma: no cover - thin wrapper
        # Delegate attribute access to underlying data object. Callable
        # results are assumed to be LazyFrame and wrapped as Node.
        attr = getattr(self.data, item)
        if callable(attr):

            def wrapper(*args, **kwargs):
                result: pl.LazyFrame = attr(*args, **kwargs)
                return self._wrap_result(result, item)

            return wrapper
        return attr

    # Commonly accessed convenience properties (explicit to avoid delegation surprises)
    @property
    def shape(self) -> tuple[int, int]:
        height = int(self.data.select(pl.len()).collect().item())
        return (height, self.data.collect_schema().len())

    @property
    def columns(self):  # pragma: no cover
        return self.data.collect_schema().names()

    # ------------------------------------------------------------------
    # Explicit graph-producing dataframe operations
    # ------------------------------------------------------------------
    def filter(self, predicate: Any) -> "Node":
        result = self.data.filter(predicate)  # type: ignore[arg-type]
        return Node(
            data=result,
            name=f"filter_{self.name}",
            workspace=self.workspace,
            parents=[self],
            operation="filter",
        )

    def select(self, *columns: str) -> "Node":
        result = self.data.select(*columns)
        return Node(
            data=result,
            name=f"select_{self.name}",
            workspace=self.workspace,
            parents=[self],
            operation="select",
        )

    def join(self, other: "Node", on: str | list[str], how: str = "inner") -> "Node":
        result = self.data.join(other.data, on=on, how=how)  # type: ignore[arg-type]
        return Node(
            data=result,
            name=f"join_{self.name}_{other.name}",
            workspace=self.workspace,
            parents=[self, other],
            operation=f"join({how})",
        )

    def slice(self, *args) -> "Node":
        """Return a sliced Node.

        Supports both slice objects and (offset, length) signatures similar to
        polars. Examples:
            node.slice(0, 10)
            node.slice(slice(0, 10))
        """
        offset: int | None = None
        length: int | None = None
        if args and isinstance(args[0], slice):
            sl: slice = args[0]
            offset = 0 if sl.start is None else sl.start
            if sl.stop is not None:
                length = sl.stop - offset
        elif args:
            offset = args[0]
            if len(args) > 1:
                length = args[1]
        else:
            offset = 0
        # polars slice signature slice(offset, length=None)
        result = self.data.slice(offset, length)  # type: ignore[arg-type]
        return Node(
            data=result,
            name=f"slice_{self.name}",
            workspace=self.workspace,
            parents=[self],
            operation="slice",
        )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    def _extract_document(self) -> Optional[str]:
        return self._document_column

    def _clear_document(self) -> None:
        self._document_column = None

    @property
    def document(self) -> Optional[str]:
        return self._extract_document()

    @document.setter
    def document(self, value: Optional[str]) -> None:
        if value is None:
            self._clear_document()
            return
        self._document_column = value

    # ------------------------------------------------------------------
    # Schema / materialization utilities
    # ------------------------------------------------------------------
    def materialize(self) -> "Node":
        collected = self.data.collect()
        self.data = collected.lazy()
        return self

    def json_schema(self) -> Dict[str, str]:
        """Return raw schema - JSON conversion should be handled by API layer."""
        schema = self.data.collect_schema()
        return {col: str(dtype) for col, dtype in schema.items()} if schema else {}

    # ------------------------------------------------------------------
    # Info / serialization (minimal)
    # ------------------------------------------------------------------
    def info(self) -> Dict[str, Any]:
        """Get JSON-safe node information suitable for API responses.

        All values are plain Python types (str, int, list, dict, None)
        so the result can be returned directly by FastAPI without
        additional conversion.
        """
        schema = self.data.collect_schema()
        height = self.data.select(pl.len()).collect().item()
        return {
            "id": self.id,
            "name": self.name,
            "operation": self.operation,
            "parent_ids": [p.id for p in self.parents],
            "child_ids": [c.id for c in self.children],
            "lazy": True,
            "document": self.document,
            "shape": (height, self.data.collect_schema().len()),
            "schema": {col: str(dtype) for col, dtype in schema.items()},
            "columns": list(schema.names()),
        }

    def serialize(self, format: str = "json") -> Dict[str, Any]:
        if format != "json":
            raise ValueError(f"Unsupported format: {format}")

        # Suppress the deprecation warning for LazyFrame serialization
        # This is mainly used for testing and persistence
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            serialized_data = self.data.serialize(format="json")
        return {
            "node_metadata": {
                "id": self.id,
                "name": self.name,
                "operation": self.operation,
                "data_type": "LazyFrame",
                "document": self.document,
            },
            "serialized_data": serialized_data,
        }

    @classmethod
    def deserialize(
        cls,
        serialized_node: Dict[str, Any],
        workspace: "Workspace",
        format: str = "json",
        base_path: Path | None = None,
    ) -> "Node":
        if format != "json":
            raise ValueError(f"Unsupported format: {format}")

        node_meta = serialized_node["node_metadata"]
        data_path = serialized_node.get("data_path")
        data_blob = serialized_node.get("serialized_data")

        # Polars .serialize(format="json") returns a JSON string (or array-string)
        # that LazyFrame.deserialize expects as a file path *unless* provided a file-like.
        # The previous implementation passed the raw string causing it to be interpreted
        # as a (very long) file path, triggering OSError: File name too long.
        # We detect non-path strings and wrap them in StringIO so Polars treats them as
        # file-like objects containing the serialized payload.
        if data_path is not None:
            if base_path is None:
                raise ValueError(
                    "Cannot load node with data_path without a base_path (workspace directory)"
                )
            file_path = (base_path / str(data_path)).resolve()
            if not file_path.exists():
                raise FileNotFoundError(f"Missing node data file: {file_path}")
            with file_path.open("rb") as f:
                data = pl.LazyFrame.deserialize(f, format="binary")
        else:
            # Backward compatibility: inline JSON payload inside metadata.json
            from io import StringIO

            def _wrap(blob: Any):  # type: ignore[override]
                if isinstance(blob, str):
                    return StringIO(blob)
                return blob

            if data_blob is None:
                raise ValueError(
                    "Missing node data (expected data_path or serialized_data)"
                )
            data = pl.LazyFrame.deserialize(_wrap(data_blob), format="json")
        node = cls.__new__(cls)
        node.id = node_meta["id"]
        node.name = node_meta["name"]
        node.data = data
        node._document_column = None
        document_column = node_meta.get("document")
        if document_column is None:
            document_column = node_meta.get("document_column")
        if document_column is not None:
            node._document_column = document_column
        node.parents = []
        node.children = []
        node.workspace = workspace
        node.operation = node_meta["operation"]
        workspace.nodes[node.id] = node
        return node

    # Representation --------------------------------------------------
    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"Node(id={self.id[:8]}, name='{self.name}', dtype={type(self.data).__name__}, "
            f"parents={len(self.parents)}, children={len(self.children)}, document={self.document})"
        )


__all__ = ["Node"]
