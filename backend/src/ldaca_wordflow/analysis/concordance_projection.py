"""Shared lazy projections over immutable nested Concordance Results."""

from __future__ import annotations

from collections.abc import Collection

import polars as pl

from .generated_columns import CONC_MATCHED_TEXT_COLUMN, CONC_START_IDX_COLUMN

SOURCE_ROW_ID_COLUMN = "__wordflow_source_row_id"
_MATCH_ORDER_COLUMN = "__wordflow_match_order"


def filter_concordance_documents(
    frame: pl.LazyFrame,
    *,
    document_column: str,
    excluded_matched_texts: Collection[str],
    bin_count: int | None,
    selected_bins: Collection[int] | None,
) -> pl.LazyFrame:
    """Return nested source rows containing only matches in the active filter."""

    schema = frame.collect_schema()
    if document_column not in schema or SOURCE_ROW_ID_COLUMN not in schema:
        raise ValueError("Concordance Result document identity is unavailable")
    nested_dtype = schema.get("concordance")
    if not isinstance(nested_dtype, pl.List) or not isinstance(
        nested_dtype.inner, pl.Struct
    ):
        raise ValueError("Concordance Result matches are unavailable")

    base_columns = [column for column in schema if column != "concordance"]
    match_columns = [field.name for field in nested_dtype.inner.fields]
    projected = (
        frame.with_columns(
            pl.int_ranges(0, pl.col("concordance").list.len()).alias(
                _MATCH_ORDER_COLUMN
            )
        )
        .explode(
            ["concordance", _MATCH_ORDER_COLUMN],
            empty_as_null=True,
        )
        .unnest("concordance")
    )
    if excluded_matched_texts:
        projected = projected.filter(
            ~pl.col(CONC_MATCHED_TEXT_COLUMN).is_in(list(excluded_matched_texts))
        )
    if selected_bins is not None:
        if bin_count is None:
            raise ValueError("Selected bins require a bin count")
        document_length = (
            pl.col(document_column)
            .cast(pl.String)
            .fill_null("")
            .str.len_chars()
            .clip(lower_bound=1)
        )
        bin_index = (
            (pl.col(CONC_START_IDX_COLUMN).fill_null(0) * bin_count)
            .floordiv(document_length)
            .clip(0, bin_count - 1)
        )
        projected = projected.filter(bin_index.is_in(list(selected_bins)))

    projected = projected.sort([SOURCE_ROW_ID_COLUMN, _MATCH_ORDER_COLUMN])
    return (
        projected.group_by(SOURCE_ROW_ID_COLUMN, maintain_order=True)
        .agg(
            *[
                pl.col(column).first()
                for column in base_columns
                if column != SOURCE_ROW_ID_COLUMN
            ],
            pl.struct(match_columns).alias("concordance"),
        )
        .select(base_columns + ["concordance"])
    )


__all__ = ["SOURCE_ROW_ID_COLUMN", "filter_concordance_documents"]
