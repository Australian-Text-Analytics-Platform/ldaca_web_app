"""Node core definition (split from former monolithic node.py).

Contains structural aspects: construction, parent/child tracking, schema helpers,
and core dataframe operations (join/filter/slice/dynamic delegation).
"""

from __future__ import annotations

import uuid
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

    def __getattr__(self, item: str) -> Any:  # pragma: no cover - thin wrapper
        # Delegate attribute access to underlying data object. Callable
        # results are assumed to be LazyFrame and wrapped as Node.
        attr = getattr(self.data, item)
        if callable(attr):

            def wrapper(*args, **kwargs):
                result: pl.LazyFrame = attr(*args, **kwargs)
                child = Node(
                    data=result,
                    name=f"{item}_{self.name}",
                    workspace=self.workspace,
                    parents=[self],
                    operation=item,
                )
                if self.document:
                    child.document = self.document
                return child

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
    def filter(self, *predicates: Any, **constraints: Any) -> "Node":
        result = self.data.filter(*predicates, **constraints)
        return Node(
            data=result,
            name=f"filter_{self.name}",
            workspace=self.workspace,
            parents=[self],
            operation="filter",
        )

    def select(self, *exprs: Any, **named_exprs: Any) -> "Node":
        result = self.data.select(*exprs, **named_exprs)
        return Node(
            data=result,
            name=f"select_{self.name}",
            workspace=self.workspace,
            parents=[self],
            operation="select",
        )

    def join(
        self,
        other: "Node",
        on: Any = None,
        how: str = "inner",
        **kwargs: Any,
    ) -> "Node":
        result = self.data.join(other.data, on=on, how=how, **kwargs)
        return Node(
            data=result,
            name=f"join_{self.name}_{other.name}",
            workspace=self.workspace,
            parents=[self, other],
            operation=f"join({how})",
        )

    def slice(self, offset: int, length: int | None = None) -> "Node":
        result = self.data.slice(offset, length)
        return Node(
            data=result,
            name=f"slice_{self.name}",
            workspace=self.workspace,
            parents=[self],
            operation="slice",
        )

    def drop(
        self,
        columns: Any,
        *more_columns: Any,
        strict: bool = True,
    ) -> "Node":
        """Drop columns using Polars semantics and return a child node.

        Mirrors ``polars.LazyFrame.drop`` while preserving DocWorkspace lineage.
        """
        result = self.data.drop(columns, *more_columns, strict=strict)
        child = Node(
            data=result,
            name=f"drop_{self.name}",
            workspace=self.workspace,
            parents=[self],
            operation="drop",
        )

        if self.document:
            before_names = set(self.data.collect_schema().names())
            after_names = set(result.collect_schema().names())
            if self.document in before_names and self.document not in after_names:
                child.document = None
            else:
                child.document = self.document

        return child

    def rename(self, mapping: Any, *, strict: bool = True) -> "Node":
        """Rename columns in-place using Polars semantics and return this node."""
        self.data = self.data.rename(mapping, strict=strict)

        if self.document:
            new_document = self.document
            if isinstance(mapping, dict) and self.document in mapping:
                mapped_value = mapping[self.document]
                if isinstance(mapped_value, str):
                    new_document = mapped_value
            elif callable(mapping):
                try:
                    mapped_value = mapping(self.document)
                    if isinstance(mapped_value, str):
                        new_document = mapped_value
                except Exception:
                    # Keep original document metadata when mapping function fails.
                    pass
            self.document = new_document

        return self

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    @property
    def document(self) -> Optional[str]:
        return self._document_column

    @document.setter
    def document(self, value: Optional[str]) -> None:
        self._document_column = value

    # ------------------------------------------------------------------
    # Schema utilities
    # ------------------------------------------------------------------
    def json_schema(self) -> Dict[str, str]:
        """Return raw schema - JSON conversion should be handled by API layer."""
        schema = self.data.collect_schema()
        return {col: str(dtype) for col, dtype in schema.items()} if schema else {}

    # ------------------------------------------------------------------
    # Info
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
            "document": self.document,
            "shape": (height, self.data.collect_schema().len()),
            "schema": {col: str(dtype) for col, dtype in schema.items()},
            "columns": list(schema.names()),
        }

    # Representation --------------------------------------------------
    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"Node(id={self.id[:8]}, name='{self.name}', dtype={type(self.data).__name__}, "
            f"parents={len(self.parents)}, children={len(self.children)}, document={self.document})"
        )


__all__ = ["Node"]
