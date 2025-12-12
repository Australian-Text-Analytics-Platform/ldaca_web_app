"""Node-level data manipulation helpers used by workspace APIs.

These utilities operate purely on data objects (Polars/DataFrame/DocFrame) and
raise ``NodeDataError`` when a requested operation cannot be applied. Keeping
this logic outside of the FastAPI modules makes it easier to reuse in other
contexts (CLI, task workers) and keeps the HTTP layer thin.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional, Sequence

import polars as pl

from docframe import DocDataFrame, DocLazyFrame


@dataclass(slots=True)
class _NormalizedLazy:
    lazyframe: pl.LazyFrame
    is_doc: bool
    document_column: Optional[str]

    def wrap(self, lf: pl.LazyFrame, *, document_column: Optional[str] = None) -> Any:
        if not self.is_doc:
            return lf
        doc_col = (
            document_column if document_column is not None else self.document_column
        )
        if not doc_col:
            raise NodeDataError(
                message="Missing document column metadata for DocLazyFrame.",
                status_code=500,
            )
        return DocLazyFrame(lf, document_column=doc_col)  # type: ignore[misc]


def _normalize_lazy_data(data: Any) -> _NormalizedLazy:
    if isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
        return _NormalizedLazy(data.lazyframe, True, data.document_column)

    if isinstance(data, DocDataFrame):  # type: ignore[arg-type]
        raise NodeDataError(
            message=(
                "DocDataFrame inputs are no longer supported. Convert to DocLazyFrame before applying workspace operations."
            )
        )

    if isinstance(data, pl.LazyFrame):
        return _NormalizedLazy(data, False, None)

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

    if normalized.is_doc and column_name == normalized.document_column:
        raise NodeDataError(
            message="Cannot delete the active document column from a DocLazyFrame.",
        )

    result_lazy = normalized.lazyframe.drop([column_name])
    return normalized.wrap(result_lazy)


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
    updated_doc_col = normalized.document_column
    if normalized.is_doc and column_name == normalized.document_column:
        updated_doc_col = trimmed_name

    return normalized.wrap(renamed_lazy, document_column=updated_doc_col)


__all__ = ["NodeDataError", "drop_column", "rename_column"]
__all__ = ["NodeDataError", "drop_column", "rename_column"]
