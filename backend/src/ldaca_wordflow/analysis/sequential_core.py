"""Pure Polars sequential-analysis computation used by process workers."""

from __future__ import annotations

from typing import Optional

import polars as pl

DEFAULT_CHART_TYPE = "line"
_CUSTOM_UNIT_SPEC: dict[str, tuple[str, str]] = {
    "seconds": ("s", "%Y-%m-%d %H:%M:%S"),
    "minutes": ("m", "%Y-%m-%d %H:%M"),
    "hours": ("h", "%Y-%m-%d %H:00"),
    "days": ("d", "%Y-%m-%d"),
    "weeks": ("w", "%Y-%m-%d"),
}


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

    # Collect to DataFrame for aggregation
    df = lf.collect()

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

        df = df.with_columns(time_expr)
    else:
        # Numeric binning
        if numeric_interval is None or numeric_interval <= 0:
            raise ValueError(
                "numeric_interval must be a positive number for numeric sequential analysis"
            )
        numeric_interval_value = float(numeric_interval)
        if numeric_origin is not None:
            numeric_origin_value = float(numeric_origin)
        else:
            origin_series = df.select(
                pl.col(time_column).cast(pl.Float64()).min()
            ).to_series()
            numeric_origin_value = origin_series[0] if len(origin_series) else None
        if numeric_origin_value is None:
            raise ValueError(
                "Unable to determine numeric_origin from the provided data"
            )

        df = df.with_columns(
            pl.col(time_column).cast(pl.Float64()).alias("__numeric_value__"),
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

    # Perform aggregation
    result_df = df.group_by(group_cols).agg(
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
        sort_cols = ["time_period"] + (group_by_columns or [])
        result_df = result_df.sort(sort_cols)

    return result_df
