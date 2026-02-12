"""Node-level data manipulation helpers used by workspace APIs.

These utilities operate purely on data objects (Polars DataFrame/LazyFrame) and
raise ``NodeDataError`` when a requested operation cannot be applied. Keeping
this logic outside of the FastAPI modules makes it easier to reuse in other
contexts (CLI, task workers) and keeps the HTTP layer thin.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional, Sequence

import polars as pl


@dataclass(slots=True)
class _NormalizedLazy:
    lazyframe: pl.LazyFrame


def _normalize_lazy_data(data: Any) -> _NormalizedLazy:
    if isinstance(data, pl.LazyFrame):
        return _NormalizedLazy(data)

    if isinstance(data, pl.DataFrame):
        raise NodeDataError(
            message=(
                "Workspace node data must remain lazy. Convert DataFrame inputs via .lazy() before continuing."
            )
        )

    raise NodeDataError(
        message=f"Unsupported data type '{type(data).__name__}' for lazy operations.",
        status_code=400,
    )


@dataclass(slots=True)
class NodeDataError(Exception):
    """Domain-specific exception raised for invalid node data operations."""

    message: str
    status_code: int = 400

    def __str__(self) -> str:  # pragma: no cover - dataclass convenience
        return self.message


def _ensure_column_present(columns: Sequence[str], column_name: str) -> None:
    if column_name not in columns:
        raise NodeDataError(
            message=f"Column '{column_name}' not found in node data.",
            status_code=404,
        )


def _ensure_unique_target(
    columns: Sequence[str], new_name: str, current_name: str
) -> None:
    if new_name in columns and new_name != current_name:
        raise NodeDataError(
            message=f"Column '{new_name}' already exists in node data.",
            status_code=400,
        )


def _schema_names(lazyframe: pl.LazyFrame) -> Iterable[str]:
    return lazyframe.collect_schema().names()


def drop_column(data: Any, column_name: str) -> Any:
    """Return ``data`` without ``column_name`` (lazy-only contract)."""

    normalized = _normalize_lazy_data(data)
    schema_names = tuple(_schema_names(normalized.lazyframe))
    _ensure_column_present(schema_names, column_name)

    result_lazy = normalized.lazyframe.drop([column_name])
    return result_lazy


def rename_column(data: Any, column_name: str, new_name: str) -> Any:
    """Return ``data`` with ``column_name`` renamed to ``new_name`` (lazy-only)."""

    trimmed_name = (new_name or "").strip()
    if not trimmed_name:
        raise NodeDataError(
            message="New column name must be a non-empty string.",
        )

    normalized = _normalize_lazy_data(data)
    schema = tuple(_schema_names(normalized.lazyframe))
    _ensure_column_present(schema, column_name)
    _ensure_unique_target(schema, trimmed_name, column_name)

    renamed_lazy = normalized.lazyframe.rename({column_name: trimmed_name})
    return renamed_lazy


__all__ = ["NodeDataError", "drop_column", "rename_column"]
