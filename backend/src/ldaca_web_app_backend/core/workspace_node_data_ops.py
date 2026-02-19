"""Node-level data manipulation helpers used by workspace APIs.

These utilities operate on Polars LazyFrame node data and raise
``NodeDataError`` when a requested operation cannot be applied. Keeping this
logic outside FastAPI modules makes it reusable in other contexts (CLI, task
workers) and keeps the HTTP layer thin.
"""

from __future__ import annotations

from dataclasses import dataclass

import polars as pl


def _normalize_lazy_data(data: object) -> pl.LazyFrame:
    """Validate and normalize node data to the lazy-only contract.

    Used by:
    - `drop_column`
    - `rename_column`

    Why:
    - Enforces backend convention that workspace node data stays lazy.
    """
    if isinstance(data, pl.LazyFrame):
        return data

    raise NodeDataError(
        message=(
            "Workspace node data must be a Polars LazyFrame. "
            f"Received '{type(data).__name__}'."
        ),
        status_code=400,
    )


@dataclass(slots=True)
class NodeDataError(Exception):
    """Domain-specific exception raised for invalid node data operations."""

    message: str
    status_code: int = 400

    def __str__(self) -> str:  # pragma: no cover - dataclass convenience
        return self.message


def drop_column(data: object, column_name: str) -> pl.LazyFrame:
    """Return data with one column removed under lazy-only constraints.

    Used by:
    - `api.workspaces.base.drop_node_column`

    Why:
    - Centralizes column removal validation and error semantics.
    """

    lazyframe = _normalize_lazy_data(data)
    schema_names = tuple(lazyframe.collect_schema().names())
    if column_name not in schema_names:
        raise NodeDataError(
            message=f"Column '{column_name}' not found in node data.",
            status_code=404,
        )

    result_lazy = lazyframe.drop([column_name])
    return result_lazy


def rename_column(data: object, column_name: str, new_name: str) -> pl.LazyFrame:
    """Return data with one column renamed under lazy-only constraints.

    Used by:
    - `api.workspaces.base.rename_node_column`

    Why:
    - Reuses consistent validation for existence/uniqueness/name normalization.
    """

    trimmed_name = (new_name or "").strip()
    if not trimmed_name:
        raise NodeDataError(
            message="New column name must be a non-empty string.",
        )

    lazyframe = _normalize_lazy_data(data)
    schema = tuple(lazyframe.collect_schema().names())
    if column_name not in schema:
        raise NodeDataError(
            message=f"Column '{column_name}' not found in node data.",
            status_code=404,
        )
    if trimmed_name in schema and trimmed_name != column_name:
        raise NodeDataError(
            message=f"Column '{trimmed_name}' already exists in node data.",
            status_code=400,
        )

    renamed_lazy = lazyframe.rename({column_name: trimmed_name})
    return renamed_lazy


__all__ = ["NodeDataError", "drop_column", "rename_column"]
