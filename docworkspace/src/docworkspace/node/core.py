"""Node core definition (split from former monolithic node.py).

Contains structural aspects: construction, parent/child tracking, schema helpers,
materialization, serialization (kept minimal for workspace persistence),
and core dataframe operations (join/filter/slice/dynamic delegation).
"""

from __future__ import annotations

import uuid
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

import polars as pl
from polars import DataFrame, LazyFrame

from docframe import DocDataFrame, DocLazyFrame  # type: ignore  # runtime import

if False:  # TYPE_CHECKING replacement to avoid runtime import cycle
    from ..workspace.core import Workspace  # pragma: no cover

# Supported data types
SupportedDataTypes = DataFrame | LazyFrame | DocDataFrame | DocLazyFrame


class NodeDataType(str, Enum):
    DataFrame = "DataFrame"
    LazyFrame = "LazyFrame"
    DocDataFrame = "DocDataFrame"
    DocLazyFrame = "DocLazyFrame"


SerializableDataType = Literal[
    "DataFrame",
    "LazyFrame",
    "DocDataFrame",
    "DocLazyFrame",
]


def extract_polars_data(data: SupportedDataTypes) -> pl.DataFrame | pl.LazyFrame:
    """
    Extract the underlying Polars DataFrame or LazyFrame from any supported data type.

    This is needed for operations like join that require native Polars objects.
    """
    if isinstance(data, (pl.DataFrame, pl.LazyFrame)):
        return data
    elif isinstance(data, DocDataFrame):
        return data.to_dataframe()
    elif isinstance(data, DocLazyFrame):
        return data.to_lazyframe()
    else:
        raise TypeError(f"Unsupported data type: {type(data)}")


class Node:
    def __init__(
        self,
        data: SupportedDataTypes,
        name: str | None = None,
        workspace: Optional["Workspace"] = None,
        parents: List["Node"] | None = None,
        operation: str | None = None,
    ) -> None:
        from ..workspace.core import Workspace  # local import to avoid cycle

        self.id = str(uuid.uuid4())
        self.name = name or f"node_{self.id[:8]}"

        assert isinstance(data, SupportedDataTypes), (
            f"Unsupported data type: {type(data).__name__}. Node supports pl.DataFrame, pl.LazyFrame, DocDataFrame, DocLazyFrame."
        )

        self.data = data
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
        if isinstance(result, (pl.DataFrame, pl.LazyFrame, DocDataFrame, DocLazyFrame)):
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
        # Extract underlying Polars data for both nodes
        ldf = extract_polars_data(self.data)
        rdf = extract_polars_data(other.data)

        # Ensure both are the same type for join operation
        # If one is lazy and other is not, convert the eager one to lazy
        if isinstance(ldf, pl.LazyFrame) and isinstance(rdf, pl.DataFrame):
            rdf = rdf.lazy()
        elif isinstance(ldf, pl.DataFrame) and isinstance(rdf, pl.LazyFrame):
            ldf = ldf.lazy()

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
    @property
    def is_lazy(self) -> bool:
        return isinstance(self.data, (pl.LazyFrame, DocLazyFrame))

    @property
    def document_column(self) -> Optional[str]:
        if isinstance(self.data, (DocDataFrame, DocLazyFrame)):
            return self.data.document_column
        return None

    # ------------------------------------------------------------------
    # Schema / materialization utilities
    # ------------------------------------------------------------------
    def collect(self) -> "Node":
        if (
            self.is_lazy
            and hasattr(self.data, "collect")
            and callable(self.data.collect)
        ):
            try:
                collected = self.data.collect()
                new_node = Node(
                    data=collected,
                    name=f"collect_{self.name}",
                    workspace=self.workspace,
                    parents=[self],
                    operation=f"collect({self.name})",
                )
                self.workspace.add_node(new_node)
                return new_node
            except Exception:
                return self
        return self

    def materialize(self) -> "Node":
        if (
            self.is_lazy
            and hasattr(self.data, "collect")
            and callable(self.data.collect)
        ):
            try:
                self.data = self.data.collect()
            except Exception:
                pass
        return self

    def json_schema(self) -> Dict[str, str]:
        """Return raw schema - JSON conversion should be handled by API layer."""
        try:
            schema = self.data.collect_schema() if self.is_lazy else self.data.schema
            # Return raw schema as dict for API layer to convert
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
            "lazy": self.is_lazy,
            "operation": self.operation,
            "parent_ids": [p.id for p in self.parents],
            "child_ids": [c.id for c in self.children],
        }
        if isinstance(self.data, (pl.DataFrame, DocDataFrame)):
            info_dict["shape"] = getattr(self.data, "shape", (0, 0))
        elif isinstance(self.data, (pl.LazyFrame, DocLazyFrame)):
            lf = (
                self.data.lazyframe
                if isinstance(self.data, DocLazyFrame)
                else self.data
            )
            try:
                height = lf.select(pl.count()).collect().item()
                width = len(lf.collect_schema().names())
                info_dict["shape"] = (height, width)
            except Exception:
                info_dict["shape"] = (0, 0)
        schema = None
        try:
            schema = self.data.collect_schema() if self.is_lazy else self.data.schema
        except Exception:
            pass
        if schema is not None:
            # Always return raw schema - API layer will convert to JS types
            info_dict["schema"] = schema
        else:
            info_dict["schema"] = {}
        if isinstance(self.data, (DocDataFrame, DocLazyFrame)):
            info_dict["document_column"] = self.document_column
        return info_dict

    def _normalized_type(self) -> SerializableDataType:
        if isinstance(self.data, DocDataFrame):
            return "DocDataFrame"
        if isinstance(self.data, DocLazyFrame):
            return "DocLazyFrame"
        if isinstance(self.data, pl.LazyFrame):
            return "LazyFrame"
        return "DataFrame"

    def serialize(self, format: str = "json") -> Dict[str, Any]:
        if format != "json":
            raise ValueError(f"Unsupported format: {format}")
        normalized = self._normalized_type()

        # Suppress the deprecation warning for LazyFrame serialization
        # This is mainly used for testing and persistence
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            serialized_data = self.data.serialize(format="json")
        data_metadata = {"type": normalized}
        return {
            "node_metadata": {
                "id": self.id,
                "name": self.name,
                "operation": self.operation,
                "data_type": normalized,
                "is_lazy": normalized in ("LazyFrame", "DocLazyFrame"),
            },
            "data_metadata": data_metadata,
            "serialized_data": serialized_data,
        }

    @classmethod
    def deserialize(
        cls,
        serialized_node: Dict[str, Any],
        workspace: "Workspace",
        format: str = "json",
    ) -> "Node":
        import polars as pl

        from docframe import DocDataFrame, DocLazyFrame

        if format != "json":
            raise ValueError(f"Unsupported format: {format}")

        node_meta = serialized_node["node_metadata"]
        data_meta = serialized_node["data_metadata"]
        data_blob = serialized_node["serialized_data"]
        data_type = data_meta["type"]

        # Polars/DocFrame .serialize(format="json") returns a JSON string (or array-string)
        # that DataFrame.deserialize expects as a file path *unless* provided a file-like.
        # The previous implementation passed the raw string causing it to be interpreted
        # as a (very long) file path, triggering OSError: File name too long.
        # We detect non-path strings and wrap them in StringIO so Polars treats them as
        # file-like objects containing the serialized payload.
        from io import StringIO
        from pathlib import Path as _P

        def _wrap(blob: Any):  # type: ignore[override]
            if isinstance(blob, str):
                try:
                    p = _P(blob)
                    # Treat as real path only if it exists on disk and is reasonably short
                    if p.exists():
                        return blob
                except Exception:  # pragma: no cover - path edge cases
                    pass
                return StringIO(blob)
            return blob

        if data_type == "DocDataFrame":
            data = DocDataFrame.deserialize(_wrap(data_blob), format="json")
        elif data_type == "DocLazyFrame":
            data = DocLazyFrame.deserialize(_wrap(data_blob), format="json")
        elif data_type == "DataFrame":
            data = pl.DataFrame.deserialize(_wrap(data_blob), format="json")
        elif data_type == "LazyFrame":
            data = pl.LazyFrame.deserialize(_wrap(data_blob), format="json")
        else:
            raise ValueError(f"Unknown data type: {data_meta['type']}")
        node = cls.__new__(cls)
        node.id = node_meta["id"]
        node.name = node_meta["name"]
        node.data = data
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
            f"lazy={self.is_lazy}, parents={len(self.parents)}, children={len(self.children)})"
        )


__all__ = ["Node"]
