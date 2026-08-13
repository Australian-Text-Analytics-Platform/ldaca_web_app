"""Polars column-casting builder for identity-preserving Data Block Edits.

Used by ``node_operations`` while it builds a replacement lazy plan. This module
owns the cast expression and validation details; ``NodeService`` owns workspace
mutation and persistence.

Flow:
- Inspect the source LazyFrame schema to capture the original dtype.
- Build the target Polars expression for the requested cast.
- Validate the expression against a small sample before mutating the full lazy
  plan.
- Return the new LazyFrame plus response metadata for the route.
"""

from __future__ import annotations

from dataclasses import dataclass

import polars as pl

from ..shared.errors import AppError, InvalidInputError


SUPPORTED_CAST_TARGETS = "string, integer, float, datetime, categorical"
TIMEZONE_FORMAT_TOKENS = ("%z", "%:z", "%#z")


@dataclass(frozen=True)
class CastLazyFrameColumnResult:
    """Result metadata for a successful lazy-frame column cast.

    Used by ``cast_lazyframe_column`` and the edit builder, which needs the new
    lazy frame plus before/after dtype metadata for validation.
    """

    lazyframe: pl.LazyFrame
    original_type: str
    new_type: str
    target_type: str
    format_used: str | None
    strict_used: bool | None


def _datetime_cast_expr(
    column_name: str,
    *,
    original_type: str,
    datetime_format: str | None,
    strict_flag: bool,
) -> pl.Expr:
    """Build a timezone-aware UTC datetime cast expression.

    Called by:
    - ``_cast_expr`` for the datetime branch because string parsing and
      timezone application have several guards that should stay out of the HTTP
      route.
    """

    orig_lower = original_type.lower()
    try:
        if orig_lower.startswith("datetime"):
            parsed = pl.col(column_name)
        elif datetime_format:
            parsed = pl.col(column_name).str.to_datetime(
                format=datetime_format, strict=bool(strict_flag)
            )
        else:
            parsed = pl.col(column_name).str.to_datetime(strict=bool(strict_flag))

        format_has_tz = datetime_format and any(
            token in datetime_format for token in TIMEZONE_FORMAT_TOKENS
        )
        source_has_tz = orig_lower.startswith("datetime") and "," in orig_lower
        if format_has_tz or source_has_tz:
            return parsed.dt.convert_time_zone("UTC").alias(column_name)
        return parsed.dt.replace_time_zone("UTC").alias(column_name)
    except Exception as exc:
        raise InvalidInputError(
            f"Error casting column '{column_name}' to datetime: {exc}. "
            "This often occurs when some rows don't match the supplied format. "
            "Note your notebook example used .head() (sampling) which may hide later malformed rows. "
            "Either clean inconsistent rows or keep strict=False (default) to set them null."
        ) from exc


def _cast_expr(
    column_name: str,
    *,
    original_type: str,
    target_type: str,
    datetime_format: str | None,
    strict_flag: bool,
) -> pl.Expr:
    """Build the Polars expression for one supported target type.

    Called by:
    - ``cast_lazyframe_column`` after schema inspection.
    """

    target_lower = target_type.lower()
    orig_lower = original_type.lower()

    if target_lower == "datetime":
        return _datetime_cast_expr(
            column_name,
            original_type=original_type,
            datetime_format=datetime_format,
            strict_flag=strict_flag,
        )
    if target_lower in ("string", "utf8", "str", "text"):
        if original_type.startswith("Datetime") and datetime_format:
            return pl.col(column_name).dt.strftime(datetime_format).alias(column_name)
        return pl.col(column_name).cast(pl.Utf8).alias(column_name)
    if target_lower == "integer":
        return pl.col(column_name).cast(pl.Int64, strict=False).alias(column_name)
    if target_lower == "float":
        return pl.col(column_name).cast(pl.Float64).alias(column_name)
    if target_lower == "categorical":
        if any(
            token in orig_lower for token in ["utf8", "string", "str", "categorical"]
        ):
            return (
                pl.col(column_name)
                .cast(pl.Categorical, strict=False)
                .alias(column_name)
            )
        return (
            pl.col(column_name)
            .cast(pl.Utf8, strict=False)
            .cast(pl.Categorical, strict=False)
            .alias(column_name)
        )

    raise InvalidInputError(
        f"Casting to '{target_type}' is not yet supported. Supported: {SUPPORTED_CAST_TARGETS}.",
    )


def cast_lazyframe_column(
    lazyframe: pl.LazyFrame,
    *,
    column_name: str,
    target_type: str,
    datetime_format: str | None = None,
    strict: bool | None = None,
) -> CastLazyFrameColumnResult:
    """Return a new LazyFrame with one column cast to the requested dtype.

    Used by ``node_operations`` as the single operation that validates and
    builds a casted lazy plan before the selected Data Block is updated.

    Flow:
    - Capture source dtype metadata from the lazy schema.
    - Build a target expression for supported cast targets.
    - Collect a 50-row validation sample so conversion errors surface before
      the workspace is persisted.
    - Return the casted LazyFrame and response metadata.
    """

    strict_flag = strict if strict is not None else False
    try:
        schema = lazyframe.collect_schema()
        original_type = str(schema[column_name])
        target_lower = target_type.lower()
        cast_expr = _cast_expr(
            column_name,
            original_type=original_type,
            target_type=target_type,
            datetime_format=datetime_format,
            strict_flag=bool(strict_flag),
        )

        try:
            lazyframe.head(50).with_columns(cast_expr).collect()
        except Exception as sample_err:
            raise InvalidInputError(
                f"Sample validation failed when casting column '{column_name}' "
                f"to {target_type}: {sample_err}"
            ) from sample_err

        casted_lazyframe = lazyframe.with_columns(cast_expr)
        new_type = str(casted_lazyframe.collect_schema()[column_name])
        return CastLazyFrameColumnResult(
            lazyframe=casted_lazyframe,
            original_type=original_type,
            new_type=new_type,
            target_type=target_type,
            format_used=datetime_format if datetime_format else None,
            strict_used=bool(strict_flag) if target_lower == "datetime" else None,
        )
    except AppError:
        raise
    except Exception as cast_error:
        raise InvalidInputError(
            f"Error casting column '{column_name}' to {target_type}: {str(cast_error)}. "
            "Check that the target data type is valid and the data can be converted.",
        ) from cast_error
