"""Pure Polars sequential-analysis computation used by process workers."""

from __future__ import annotations

from typing import Optional

import polars as pl

DEFAULT_CHART_TYPE = "line"
SEQUENTIAL_PERIOD_INDEX_COLUMN = "period_index"
SEQUENTIAL_GROUP_INDEX_COLUMN = "group_index"
SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN = "__wordflow_trends_period_index"
SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN = "__wordflow_trends_group_index"
_SEQUENTIAL_ROW_INDEX_COLUMN = "__wordflow_trends_row_index"
_CUSTOM_UNIT_SPEC: dict[str, tuple[str, str]] = {
    "seconds": ("s", "%Y-%m-%d %H:%M:%S"),
    "minutes": ("m", "%Y-%m-%d %H:%M"),
    "hours": ("h", "%Y-%m-%d %H:00"),
    "days": ("d", "%Y-%m-%d"),
    "weeks": ("w", "%Y-%m-%d"),
}


def _build_sequential_result_frames(
    lf: pl.LazyFrame,
    *,
    time_column: str,
    group_by_columns: list[str] | None = None,
    frequency: str = "monthly",
    sort_by_time: bool = True,
    column_type: str = "datetime",
    numeric_origin: float | None = None,
    numeric_interval: float | None = None,
    custom_interval_value: int | None = None,
    custom_interval_unit: str | None = None,
    case_sensitive: bool = True,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Pure-Polars implementation of sequential analysis.

    Groups records by time period (datetime truncation or numeric binning),
    counts occurrences per group, and returns a DataFrame with aggregated
    results.  No text-processing dependency required.
    """

    normalized_column_type = (column_type or "datetime").lower()
    if normalized_column_type not in {"datetime", "numeric"}:
        raise ValueError(
            "Unsupported column_type. Use 'datetime' or 'numeric' for sequential analysis"
        )

    # The worker writes both outputs immediately after this computation, so the
    # shared collect is the explicit artifact boundary for both frames.
    source_df = lf.collect()
    reserved_columns = {
        SEQUENTIAL_PERIOD_INDEX_COLUMN,
        SEQUENTIAL_GROUP_INDEX_COLUMN,
        SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN,
        SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN,
        _SEQUENTIAL_ROW_INDEX_COLUMN,
    }
    collision = reserved_columns.intersection(source_df.columns)
    if collision:
        raise ValueError(f"Source column name is reserved: {sorted(collision)[0]}")
    df = source_df.with_row_index(_SEQUENTIAL_ROW_INDEX_COLUMN)

    time_format = ""
    numeric_interval_value: float | None = None
    numeric_origin_value: float | None = None

    if normalized_column_type == "datetime":
        if frequency == "second":
            time_expr = pl.col(time_column).dt.truncate("1s").alias("time_period")
            time_format = "%Y-%m-%d %H:%M:%S"
        elif frequency == "minute":
            time_expr = pl.col(time_column).dt.truncate("1m").alias("time_period")
            time_format = "%Y-%m-%d %H:%M"
        elif frequency == "hourly":
            time_expr = pl.col(time_column).dt.truncate("1h").alias("time_period")
            time_format = "%Y-%m-%d %H:%M"
        elif frequency == "daily":
            time_expr = pl.col(time_column).dt.date().alias("time_period")
            time_format = "%Y-%m-%d"
        elif frequency == "weekly":
            time_expr = (
                pl.col(time_column).dt.truncate("1w").dt.date().alias("time_period")
            )
            time_format = "%Y-W%U"
        elif frequency == "monthly":
            time_expr = (
                pl.col(time_column).dt.truncate("1mo").dt.date().alias("time_period")
            )
            time_format = "%Y-%m"
        elif frequency == "quarterly":
            time_expr = (
                pl.col(time_column).dt.truncate("3mo").dt.date().alias("time_period")
            )
            time_format = "%Y-Q"
        elif frequency == "yearly":
            time_expr = (
                pl.col(time_column).dt.truncate("1y").dt.date().alias("time_period")
            )
            time_format = "%Y"
        elif frequency == "custom":
            if custom_interval_value is None or custom_interval_value <= 0:
                raise ValueError(
                    "custom_interval_value must be a positive integer when frequency='custom'"
                )
            unit_spec = _CUSTOM_UNIT_SPEC.get(custom_interval_unit or "")
            if unit_spec is None:
                raise ValueError(
                    f"Unsupported custom_interval_unit '{custom_interval_unit}'. "
                    f"Use one of: {sorted(_CUSTOM_UNIT_SPEC)}"
                )
            duration_suffix, time_format = unit_spec
            duration = f"{int(custom_interval_value)}{duration_suffix}"
            time_expr = pl.col(time_column).dt.truncate(duration).alias("time_period")
        else:
            raise ValueError("Unsupported datetime frequency")

        df = df.filter(pl.col(time_column).is_not_null()).with_columns(time_expr)
    else:
        # Numeric binning
        if numeric_interval is None or numeric_interval <= 0:
            raise ValueError(
                "numeric_interval must be a positive number for numeric sequential analysis"
            )
        numeric_interval_value = float(numeric_interval)
        df = df.with_columns(
            pl.col(time_column).cast(pl.Float64()).alias("__numeric_value__"),
        ).filter(
            pl.col("__numeric_value__")
            .is_not_null()
            .and_(pl.col("__numeric_value__").is_finite())
        )
        if numeric_origin is not None:
            numeric_origin_value = float(numeric_origin)
        else:
            origin_series = df.select(pl.col("__numeric_value__").min()).to_series()
            numeric_origin_value = origin_series[0] if len(origin_series) else None
        if numeric_origin_value is None:
            raise ValueError(
                "Unable to determine numeric_origin from the provided data"
            )

        df = df.with_columns(
            (
                (pl.col("__numeric_value__") - pl.lit(numeric_origin_value))
                / pl.lit(numeric_interval_value)
            )
            .floor()
            .cast(pl.Int64)
            .alias("__numeric_bin__"),
        )
        df = df.with_columns(
            (
                pl.lit(numeric_origin_value)
                + pl.col("__numeric_bin__").cast(pl.Float64)
                * pl.lit(numeric_interval_value)
            ).alias("time_period"),
        )

    # Determine grouping columns
    group_cols = ["time_period"] + (group_by_columns or [])

    # Lowercase group-by column values for case-insensitive grouping
    if not case_sensitive and group_by_columns:
        for col_name in group_by_columns:
            if (
                df.schema.get(col_name) == pl.String
                or df.schema.get(col_name) == pl.Utf8
            ):
                df = df.with_columns(pl.col(col_name).str.to_lowercase())

    period_indices = (
        df.select("time_period")
        .unique()
        .sort("time_period")
        .with_row_index(SEQUENTIAL_PERIOD_INDEX_COLUMN)
    )
    df = df.join(period_indices, on="time_period", how="left")
    if group_by_columns:
        group_indices = (
            df.select(group_by_columns)
            .unique()
            .sort(group_by_columns)
            .with_row_index(SEQUENTIAL_GROUP_INDEX_COLUMN)
        )
        df = df.join(
            group_indices,
            on=group_by_columns,
            how="left",
            nulls_equal=True,
        )
    else:
        df = df.with_columns(pl.lit(0, dtype=pl.UInt32).alias(SEQUENTIAL_GROUP_INDEX_COLUMN))

    # Perform aggregation
    result_df = df.group_by(
        [
            *group_cols,
            SEQUENTIAL_PERIOD_INDEX_COLUMN,
            SEQUENTIAL_GROUP_INDEX_COLUMN,
        ]
    ).agg(
        [
            pl.len().alias("sequential_count"),
            pl.col(time_column).min().alias("period_start"),
            pl.col(time_column).max().alias("period_end"),
        ]
    )

    # Add formatted time period for display
    if normalized_column_type == "datetime":
        if frequency == "weekly":
            result_df = result_df.with_columns(
                pl.col("time_period")
                .dt.strftime("%Y-W%W")
                .alias("time_period_formatted")
            )
        elif frequency == "quarterly":
            result_df = result_df.with_columns(
                [
                    pl.col("time_period").dt.year().alias("__year__"),
                    ((pl.col("time_period").dt.month() - 1).floordiv(3).add(1)).alias(
                        "__quarter__"
                    ),
                ]
            )
            result_df = result_df.with_columns(
                pl.format(
                    "{}-Q{}",
                    pl.col("__year__"),
                    pl.col("__quarter__"),
                ).alias("time_period_formatted")
            ).drop(["__year__", "__quarter__"])
        else:
            result_df = result_df.with_columns(
                pl.col("time_period")
                .dt.strftime(time_format)
                .alias("time_period_formatted")
            )
    else:
        interval_lit = pl.lit(numeric_interval_value)
        result_df = result_df.with_columns(
            [
                pl.col("time_period").round(6).alias("time_period"),
                (pl.col("time_period") + interval_lit).alias("__numeric_period_end__"),
            ]
        )

        def _format_numeric(value: Optional[float]) -> Optional[str]:
            """Format one numeric interval boundary for the result label."""

            if value is None:
                return None
            return format(value, ".6g")

        result_df = result_df.with_columns(
            [
                pl.col("time_period")
                .map_elements(_format_numeric, return_dtype=pl.String)
                .alias("__numeric_period_label_start__"),
                pl.col("__numeric_period_end__")
                .map_elements(_format_numeric, return_dtype=pl.String)
                .alias("__numeric_period_label_end__"),
            ]
        )
        result_df = result_df.with_columns(
            pl.format(
                "[{}, {})",
                pl.col("__numeric_period_label_start__"),
                pl.col("__numeric_period_label_end__"),
            ).alias("time_period_formatted")
        ).drop(
            [
                "__numeric_period_end__",
                "__numeric_period_label_start__",
                "__numeric_period_label_end__",
            ]
        )

    # Sort by time if requested
    if sort_by_time:
        sort_cols = [SEQUENTIAL_PERIOD_INDEX_COLUMN, SEQUENTIAL_GROUP_INDEX_COLUMN]
        result_df = result_df.sort(sort_cols)

    selection_indices = df.select(
        _SEQUENTIAL_ROW_INDEX_COLUMN,
        pl.col(SEQUENTIAL_PERIOD_INDEX_COLUMN).alias(
            SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN
        ),
        pl.col(SEQUENTIAL_GROUP_INDEX_COLUMN).alias(
            SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN
        ),
    )
    publication_df = (
        source_df.with_row_index(_SEQUENTIAL_ROW_INDEX_COLUMN)
        .join(
            selection_indices,
            on=_SEQUENTIAL_ROW_INDEX_COLUMN,
            how="inner",
            maintain_order="left",
        )
        .drop(_SEQUENTIAL_ROW_INDEX_COLUMN)
        .select(
            *source_df.columns,
            SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN,
            SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN,
        )
    )
    return result_df, publication_df


def _run_sequential_analysis(
    lf: pl.LazyFrame,
    *,
    time_column: str,
    group_by_columns: list[str] | None = None,
    frequency: str = "monthly",
    sort_by_time: bool = True,
    column_type: str = "datetime",
    numeric_origin: float | None = None,
    numeric_interval: float | None = None,
    custom_interval_value: int | None = None,
    custom_interval_unit: str | None = None,
    case_sensitive: bool = True,
) -> pl.DataFrame:
    """Return the public aggregate while preserving the established core API."""

    result, _publication = _build_sequential_result_frames(
        lf,
        time_column=time_column,
        group_by_columns=group_by_columns,
        frequency=frequency,
        sort_by_time=sort_by_time,
        column_type=column_type,
        numeric_origin=numeric_origin,
        numeric_interval=numeric_interval,
        custom_interval_value=custom_interval_value,
        custom_interval_unit=custom_interval_unit,
        case_sensitive=case_sensitive,
    )
    return result


__all__ = [
    "SEQUENTIAL_GROUP_INDEX_COLUMN",
    "SEQUENTIAL_PERIOD_INDEX_COLUMN",
    "SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN",
    "SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN",
    "_build_sequential_result_frames",
    "_run_sequential_analysis",
]
