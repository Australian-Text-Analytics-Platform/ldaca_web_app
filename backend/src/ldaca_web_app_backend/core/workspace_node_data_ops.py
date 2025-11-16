"""Node-level data manipulation helpers used by workspace APIs.

These utilities operate purely on data objects (Polars/DataFrame/DocFrame) and
raise ``NodeDataError`` when a requested operation cannot be applied. Keeping
this logic outside of the FastAPI modules makes it easier to reuse in other
contexts (CLI, task workers) and keeps the HTTP layer thin.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import polars as pl

try:  # pragma: no cover - optional dependency
    from docframe import DocDataFrame, DocLazyFrame  # type: ignore
except Exception:  # pragma: no cover
    DocDataFrame = None  # type: ignore
    DocLazyFrame = None  # type: ignore


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


def _ensure_unique_target(columns: Sequence[str], new_name: str, current_name: str) -> None:
    if new_name in columns and new_name != current_name:
        raise NodeDataError(
            message=f"Column '{new_name}' already exists in node data.",
            status_code=400,
        )


def _schema_names(lazyframe: pl.LazyFrame) -> Iterable[str]:
    return lazyframe.collect_schema().names()


def drop_column(data: Any, column_name: str) -> Any:
    """Return a copy of ``data`` without ``column_name``.

    Raises ``NodeDataError`` if the column does not exist or the column is the
    active document column for DocFrame-backed objects.
    """

    if DocDataFrame is not None and isinstance(data, DocDataFrame):  # type: ignore[arg-type]
        doc_col = data.document_column
        if column_name == doc_col:
            raise NodeDataError(
                message="Cannot delete the active document column from a DocDataFrame.",
            )
        if column_name not in data.dataframe.columns:
            raise NodeDataError(
                message=f"Column '{column_name}' not found in node data.",
                status_code=404,
            )
        return DocDataFrame(data.dataframe.drop(column_name), document_column=doc_col)  # type: ignore[call-arg]

    if DocLazyFrame is not None and isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
        doc_col = data.document_column
        schema_names = tuple(_schema_names(data.lazyframe))
        _ensure_column_present(schema_names, column_name)
        if column_name == doc_col:
            raise NodeDataError(
                message="Cannot delete the active document column from a DocLazyFrame.",
            )
        return DocLazyFrame(data.lazyframe.drop([column_name]), document_column=doc_col)  # type: ignore[misc]

    if isinstance(data, pl.DataFrame):
        _ensure_column_present(tuple(data.columns), column_name)
        return data.drop(column_name)

    if isinstance(data, pl.LazyFrame):
        schema_names = tuple(_schema_names(data))
        _ensure_column_present(schema_names, column_name)
        return data.drop([column_name])

    if hasattr(data, "drop"):
        try:
            return data.drop(column_name)
        except Exception as exc:  # pragma: no cover - unexpected backend types
            raise NodeDataError(
                message=f"Failed to delete column '{column_name}': {exc}",
                status_code=500,
            ) from exc

    raise NodeDataError(
        message=f"Unsupported data type '{type(data).__name__}' for column deletion.",
        status_code=400,
    )


def rename_column(data: Any, column_name: str, new_name: str) -> Any:
    """Return a copy of ``data`` with ``column_name`` renamed to ``new_name``."""

    trimmed_name = (new_name or "").strip()
    if not trimmed_name:
        raise NodeDataError(
            message="New column name must be a non-empty string.",
        )

    if DocDataFrame is not None and isinstance(data, DocDataFrame):  # type: ignore[arg-type]
        doc_col = data.document_column
        columns = tuple(data.dataframe.columns)
        _ensure_column_present(columns, column_name)
        if column_name == doc_col:
            if trimmed_name == column_name:
                return data
            try:
                return data.rename_document(trimmed_name)
            except Exception as exc:  # pragma: no cover
                raise NodeDataError(
                    message=f"Failed to rename document column: {exc}",
                ) from exc
        _ensure_unique_target(columns, trimmed_name, column_name)
        renamed_df = data.dataframe.rename({column_name: trimmed_name})
        return DocDataFrame(renamed_df, document_column=doc_col)  # type: ignore[call-arg]

    if DocLazyFrame is not None and isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
        doc_col = data.document_column
        schema = tuple(_schema_names(data.lazyframe))
        _ensure_column_present(schema, column_name)
        _ensure_unique_target(schema, trimmed_name, column_name)
        renamed_lazy = data.lazyframe.rename({column_name: trimmed_name})
        updated_doc_col = trimmed_name if column_name == doc_col else doc_col
        return DocLazyFrame(renamed_lazy, document_column=updated_doc_col)  # type: ignore[misc]

    if isinstance(data, pl.DataFrame):
        columns = tuple(data.columns)
        _ensure_column_present(columns, column_name)
        _ensure_unique_target(columns, trimmed_name, column_name)
        return data.rename({column_name: trimmed_name})

    if isinstance(data, pl.LazyFrame):
        columns = tuple(_schema_names(data))
        _ensure_column_present(columns, column_name)
        _ensure_unique_target(columns, trimmed_name, column_name)
        return data.rename({column_name: trimmed_name})

    if hasattr(data, "rename"):
        try:
            return data.rename({column_name: trimmed_name})
        except Exception as exc:  # pragma: no cover
            raise NodeDataError(
                message=f"Failed to rename column '{column_name}': {exc}",
                status_code=500,
            ) from exc

    raise NodeDataError(
        message=f"Unsupported data type '{type(data).__name__}' for column rename.",
        status_code=400,
    )


__all__ = ["NodeDataError", "drop_column", "rename_column"]
