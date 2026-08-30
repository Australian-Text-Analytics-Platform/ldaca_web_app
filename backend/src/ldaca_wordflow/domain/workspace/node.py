"""Lazy Polars node and graph relationships for a workspace aggregate."""

from __future__ import annotations

import uuid
from typing import (
    TYPE_CHECKING,
)
from collections.abc import Sequence

import polars as pl

from .provenance import NodeProvenance, SourceProvenance, referenced_node_ids

if TYPE_CHECKING:  # pragma: no cover
    from .graph import Workspace

PLAN_HISTORY_LIMIT = 50
PlanHistorySnapshot = tuple[
    tuple[pl.LazyFrame, ...],
    tuple[pl.LazyFrame, ...],
]


class Node:
    """One lazy dataset and its explicit lineage inside a workspace.

    ``Workspace`` owns graph registration and persistence. Runtime-only,
    plan-only Undo/Redo belongs to the Data Block, while application services
    remain responsible for constructing and validating replacement plans.
    """

    @staticmethod
    def _lazyframe_height(data: pl.LazyFrame) -> int:
        collected = data.select(pl.len()).collect()
        return int(collected.item())

    def __init__(
        self,
        data: pl.LazyFrame,
        name: str,
        parents: Sequence[Node] = (),
        provenance: NodeProvenance | None = None,
        id: uuid.UUID | None = None,
        document: str | None = None,
        color: str | None = None,
        tokenizer_model: str | None = None,
    ) -> None:
        self.id = id or uuid.uuid4()
        self.name = name or f"node_{str(self.id)[:8]}"

        if not isinstance(data, pl.LazyFrame):
            raise TypeError(
                "Node data must be a polars LazyFrame "
                f"(received {type(data).__name__})."
            )
        self._data: pl.LazyFrame = data
        self._undo_stack: list[pl.LazyFrame] = []
        self._redo_stack: list[pl.LazyFrame] = []
        self._document_column: str | None = document
        self.color: str | None = color
        normalized_tokenizer_model = (
            tokenizer_model.strip() if tokenizer_model is not None else ""
        )
        if len(normalized_tokenizer_model) > 500:
            raise ValueError("Tokenizer model ID exceeds 500 characters")
        self.tokenizer_model: str | None = normalized_tokenizer_model or None
        self.parents: list[Node] = list(parents)
        # Graph attachment is an explicit Workspace operation; construction
        # itself never mutates or implicitly joins an aggregate.
        self.workspace: Workspace | None = None
        self.provenance: NodeProvenance = provenance or SourceProvenance()
        if referenced_node_ids(self.provenance) != [
            parent.id for parent in self.parents
        ]:
            raise ValueError(
                "Node parents must exactly match its ordered provenance references"
            )

    # Commonly accessed convenience properties (explicit to avoid delegation surprises)
    @property
    def shape(self) -> tuple[int, int]:
        height = self._lazyframe_height(self.data)
        return (height, self.data.collect_schema().len())

    @property
    def data(self) -> pl.LazyFrame:
        return self._data

    @data.setter
    def data(self, value: pl.LazyFrame) -> None:
        if not isinstance(value, pl.LazyFrame):
            raise TypeError(
                "Node data must be a polars LazyFrame "
                f"(received {type(value).__name__})."
            )
        if value is self._data:
            return

        self._append_bounded(self._undo_stack, self._data)
        self._data = value
        self._redo_stack.clear()

    @staticmethod
    def _append_bounded(
        stack: list[pl.LazyFrame],
        plan: pl.LazyFrame,
    ) -> None:
        stack.append(plan)
        if len(stack) > PLAN_HISTORY_LIMIT:
            del stack[0]

    @property
    def can_undo(self) -> bool:
        return bool(self._undo_stack)

    @property
    def can_redo(self) -> bool:
        return bool(self._redo_stack)

    def undo_data(self) -> bool:
        """Restore the previous plan without recording a new checkpoint."""

        if not self._undo_stack:
            return False
        self._append_bounded(self._redo_stack, self._data)
        self._data = self._undo_stack.pop()
        return True

    def redo_data(self) -> bool:
        """Restore the next plan without recording a new checkpoint."""

        if not self._redo_stack:
            return False
        self._append_bounded(self._undo_stack, self._data)
        self._data = self._redo_stack.pop()
        return True

    def snapshot_plan_history(self) -> PlanHistorySnapshot:
        """Capture runtime plan stacks for transaction rollback only."""

        return tuple(self._undo_stack), tuple(self._redo_stack)

    def restore_plan_history(self, snapshot: PlanHistorySnapshot) -> None:
        """Restore previously captured runtime plan stacks."""

        undo_stack, redo_stack = snapshot
        self._undo_stack = list(undo_stack[-PLAN_HISTORY_LIMIT:])
        self._redo_stack = list(redo_stack[-PLAN_HISTORY_LIMIT:])

    @property
    def children(self) -> list[Node]:
        if self.workspace is None:
            return []
        return self.workspace.children_of(self.id)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    @property
    def document(self) -> str | None:
        return self._document_column

    @document.setter
    def document(self, value: str | None) -> None:
        self._document_column = value

    # Representation --------------------------------------------------
    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"Node(id={str(self.id)[:8]}, name='{self.name}', dtype={type(self.data).__name__}, "
            f"parents={len(self.parents)}, children={len(self.children)}, document={self.document})"
        )


__all__ = ["Node", "PlanHistorySnapshot"]
