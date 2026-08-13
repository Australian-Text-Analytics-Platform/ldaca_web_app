"""Unit tests for the cast operation used by immutable node derivations."""

from __future__ import annotations

import polars as pl
import pytest

from ldaca_wordflow.shared.errors import InvalidInputError
from ldaca_wordflow.services.node_casting import cast_lazyframe_column


def test_cast_lazyframe_column_converts_integer_strings() -> None:
    """Integer casts return a new lazy frame plus response metadata."""

    lazyframe = pl.DataFrame({"value": ["1", "2", "bad"]}).lazy()

    result = cast_lazyframe_column(
        lazyframe,
        column_name="value",
        target_type="integer",
    )

    collected = result.lazyframe.collect()
    assert str(collected.schema["value"]) == "Int64"
    assert collected["value"].to_list() == [1, 2, None]
    assert result.original_type == "String"
    assert result.new_type == "Int64"
    assert result.strict_used is None


def test_cast_lazyframe_column_rejects_unsupported_target() -> None:
    """Unsupported target names fail with the shared input-error type."""

    lazyframe = pl.DataFrame({"value": [1, 2, 3]}).lazy()

    with pytest.raises(InvalidInputError) as exc_info:
        cast_lazyframe_column(
            lazyframe,
            column_name="value",
            target_type="boolean",
        )

    assert "not yet supported" in exc_info.value.message
