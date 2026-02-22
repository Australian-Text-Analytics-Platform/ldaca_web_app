"""Tests for LDaCA dtype mapping helpers."""

import polars as pl


class TestDocWorkspaceTypeMapping:
    """Tests for API schema type conversion helpers"""

    def test_polars_dtype_to_ldaca_dtype_categorical(self):
        """Categorical dtypes map to categorical LDaCA dtype."""
        from ldaca_web_app_backend.core.docworkspace_data_types import (
            DocWorkspaceDataTypeUtils,
        )

        # Test with Polars type object
        assert (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(pl.Categorical)
            == "categorical"
        )

    def test_polars_dtype_to_ldaca_dtype_list_string(self):
        """Exact list-of-string dtype maps to list_string."""
        from ldaca_web_app_backend.core.docworkspace_data_types import (
            DocWorkspaceDataTypeUtils,
        )

        assert (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(pl.List(pl.String))
            == "list_string"
        )

    def test_polars_dtype_to_ldaca_dtype_non_string_list_is_unknown(self):
        """Non-string list dtypes map to unknown."""
        from ldaca_web_app_backend.core.docworkspace_data_types import (
            DocWorkspaceDataTypeUtils,
        )

        assert (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(pl.List(pl.Int64))
            == "unknown"
        )

    def test_polars_dtype_to_ldaca_dtype_array_is_unknown(self):
        """Array dtypes map to unknown."""
        from ldaca_web_app_backend.core.docworkspace_data_types import (
            DocWorkspaceDataTypeUtils,
        )

        assert (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(pl.Array(pl.Int64, 2))
            == "unknown"
        )
        assert (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(pl.Array(pl.Int64, 2))
            == "unknown"
        )
        assert (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(pl.Array(pl.Int64, 2))
            == "unknown"
        )
        assert (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(pl.Array(pl.Int64, 2))
            == "unknown"
        )
