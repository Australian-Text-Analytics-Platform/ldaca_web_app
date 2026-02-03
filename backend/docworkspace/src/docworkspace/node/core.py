"""Node core definition (split from former monolithic node.py).

Contains structural aspects: construction, parent/child tracking, schema helpers,
materialization, serialization (kept minimal for workspace persistence),
and core dataframe operations (join/filter/slice/dynamic delegation).
"""

from __future__ import annotations

import uuid
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import polars as pl
from polars import DataFrame, LazyFrame

from docframe import DocDataFrame  # type: ignore  # runtime import
from docframe import DocLazyFrame

if False:  # TYPE_CHECKING replacement to avoid runtime import cycle
    from ..workspace.core import Workspace  # pragma: no cover

# Supported data types
InitDataTypes = DataFrame | LazyFrame | DocDataFrame | DocLazyFrame
LazyDataTypes = LazyFrame | DocLazyFrame


class NodeDataType(str, Enum):
    LazyFrame = "LazyFrame"
    DocLazyFrame = "DocLazyFrame"


SerializableDataType = Literal[
    "LazyFrame",
    "DocLazyFrame",
    "DataFrame",
    "DocDataFrame",
]


def _ensure_lazy_data(data: InitDataTypes) -> LazyDataTypes:
    """Normalize supported data types to lazy representations."""

    if isinstance(data, DocLazyFrame):
        return data
    if isinstance(data, LazyFrame):
        return data
    if isinstance(data, DocDataFrame):
        return data.to_doclazyframe()
    if isinstance(data, DataFrame):
        return data.lazy()
    raise TypeError(
        f"Unsupported data type: {type(data).__name__}. Node requires LazyFrame or DocLazyFrame inputs."
    )


def _unwrap_lazyframe(data: LazyDataTypes) -> pl.LazyFrame:
    """Return the underlying polars LazyFrame for either LazyFrame or DocLazyFrame."""

    if isinstance(data, DocLazyFrame):
        return data.to_lazyframe()
    return data


class Node:
    def __init__(
        self,
        data: InitDataTypes,
        name: str | None = None,
        workspace: Optional["Workspace"] = None,
        parents: List["Node"] | None = None,
        operation: str | None = None,
    ) -> None:
        from ..workspace.core import Workspace  # local import to avoid cycle

        self.id = str(uuid.uuid4())
        self.name = name or f"node_{self.id[:8]}"

        self.data = _ensure_lazy_data(data)
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
    def _wrap_result(self, result: Any, op_name: str) -> Any:
        """Wrap DataFrame-like results into a new Node preserving lineage.

        Non-dataframe results (scalars, lists, etc.) are returned directly.
        """
        if isinstance(result, (pl.LazyFrame, DocLazyFrame)):
            return Node(
                data=result,
                name=f"{op_name}_{self.name}",
                workspace=self.workspace,
                parents=[self],
                operation=op_name,
            )
        return result

    def __getattr__(self, item: str) -> Any:  # pragma: no cover - thin wrapper
        # Delegate attribute access to underlying data object. If it's a
        # callable returning a dataframe-like object we convert result to Node.
        attr = getattr(self.data, item)
        if callable(attr):

            def wrapper(*args, **kwargs):
                result = attr(*args, **kwargs)
                return self._wrap_result(result, item)

            return wrapper
        return attr

    # Commonly accessed convenience properties (explicit to avoid delegation surprises)
    @property
    def shape(self):  # pragma: no cover - trivial delegation
        return getattr(self.data, "shape", None)

    @property
    def columns(self):  # pragma: no cover
        if hasattr(self.data, "collect_schema"):
            try:
                return self.data.collect_schema().names()
            except Exception:
                pass
        return getattr(self.data, "columns", [])

    # ------------------------------------------------------------------
    # Explicit graph-producing dataframe operations
    # ------------------------------------------------------------------
    def filter(self, predicate: Any) -> "Node":
        df = self.data
        if hasattr(df, "filter"):
            result = getattr(df, "filter")(predicate)  # type: ignore[arg-type]
            return Node(
                data=result,
                name=f"filter_{self.name}",
                workspace=self.workspace,
                parents=[self],
                operation="filter",
            )
        raise AttributeError("Underlying data does not support filter")

    def select(self, *columns: str) -> "Node":
        df = self.data
        if hasattr(df, "select"):
            result = getattr(df, "select")(*columns)
            return Node(
                data=result,
                name=f"select_{self.name}",
                workspace=self.workspace,
                parents=[self],
                operation="select",
            )
        raise AttributeError("Underlying data does not support select")

    def join(self, other: "Node", on: str | list[str], how: str = "inner") -> "Node":
        ldf = _unwrap_lazyframe(self.data)
        rdf = _unwrap_lazyframe(other.data)

        if hasattr(ldf, "join"):
            result = getattr(ldf, "join")(rdf, on=on, how=how)  # type: ignore[arg-type]
            return Node(
                data=result,
                name=f"join_{self.name}_{other.name}",
                workspace=self.workspace,
                parents=[self, other],
                operation=f"join({how})",
            )
        raise AttributeError("Underlying data does not support join")

    def slice(self, *args, **kwargs) -> "Node":
        """Return a sliced Node.

        Supports both slice objects and (offset, length) signatures similar to
        polars. Examples:
            node.slice(0, 10)
            node.slice(slice(0, 10))
        """
        df = self.data
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
        if not hasattr(df, "slice"):
            raise AttributeError("Underlying data does not support slice operation")
        # polars slice signature slice(offset, length=None)
        result = getattr(df, "slice")(offset, length)  # type: ignore[arg-type]
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
        if isinstance(self.data, DocLazyFrame):
            try:
                return self.data.document_column
            except Exception:
                return None
        return None

    def _clear_document(self) -> None:
        if isinstance(self.data, DocLazyFrame):
            self.data = self.data.to_lazyframe()

    @property
    def document(self) -> Optional[str]:
        return self._extract_document()

    @document.setter
    def document(self, value: Optional[str]) -> None:
        if value is None:
            self._clear_document()
            return

        if isinstance(self.data, DocLazyFrame):
            if self.data.document_column == value:
                return
            self.data = self.data.set_document(value)
            return

        if isinstance(self.data, pl.LazyFrame):
            self.data = DocLazyFrame(self.data, document_column=value)
            return

        raise TypeError(
            f"Unsupported data type {type(self.data).__name__} for document assignment"
        )

    # ------------------------------------------------------------------
    # Schema / materialization utilities
    # ------------------------------------------------------------------
    def materialize(self) -> "Node":
        if isinstance(self.data, DocLazyFrame):
            try:
                collected = self.data.collect()
                self.data = collected.to_doclazyframe()
            except Exception:
                pass
            return self

        if isinstance(self.data, pl.LazyFrame):
            try:
                collected = self.data.collect()
                self.data = collected.lazy()
            except Exception:
                pass
        return self

    def json_schema(self) -> Dict[str, str]:
        """Return raw schema - JSON conversion should be handled by API layer."""
        try:
            schema = _unwrap_lazyframe(self.data).collect_schema()
            return {col: str(dtype) for col, dtype in schema.items()} if schema else {}
        except Exception:
            return {}

    # ------------------------------------------------------------------
    # Info / serialization (minimal)
    # ------------------------------------------------------------------
    def info(self) -> Dict[str, Any]:
        """Get node information with raw schema data.

        Returns raw Polars schema - JSON type conversion should be handled
        by the API layer, not in the core docworkspace library.
        """
        dtype = type(self.data)
        info_dict: Dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "dtype": dtype,  # Return actual type object - API layer will convert to string
            "operation": self.operation,
            "parent_ids": [p.id for p in self.parents],
            "child_ids": [c.id for c in self.children],
            "lazy": True,
        }
        info_dict["shape"] = (0, 0)
        info_dict["schema"] = {}
        try:
            lf = _unwrap_lazyframe(self.data)
            height = lf.select(pl.len()).collect().item()
            width = len(lf.collect_schema().names())
            info_dict["shape"] = (height, width)
            info_dict["schema"] = lf.collect_schema()
        except Exception:
            pass
        if self.document is not None:
            info_dict["document"] = self.document
        return info_dict

    def serialize(self, format: str = "json") -> Dict[str, Any]:
        if format != "json":
            raise ValueError(f"Unsupported format: {format}")

        # For workspace persistence and API transport we intentionally serialize the
        # *underlying* Polars LazyFrame payload. DocLazyFrame is reconstructed from
        # the persisted `document` metadata on load.
        normalized: SerializableDataType = "LazyFrame"

        # Suppress the deprecation warning for LazyFrame serialization
        # This is mainly used for testing and persistence
        import warnings

        node_metadata = {
            "id": self.id,
            "name": self.name,
            "operation": self.operation,
            "data_type": normalized,
            "document": self.document,
        }

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            serialized_data = _unwrap_lazyframe(self.data).serialize(format="json")
        return {
            "node_metadata": node_metadata,
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
        import polars as pl

        if format != "json":
            raise ValueError(f"Unsupported format: {format}")

        node_meta = serialized_node["node_metadata"]
        data_path = serialized_node.get("data_path")
        data_blob = serialized_node.get("serialized_data")

        # Polars/DocFrame .serialize(format="json") returns a JSON string (or array-string)
        # that DataFrame.deserialize expects as a file path *unless* provided a file-like.
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
        document_column = node_meta.get("document")
        if document_column is None:
            document_column = node_meta.get("document_column")
        if document_column is not None:
            try:
                node.document = document_column
            except Exception:
                pass
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
