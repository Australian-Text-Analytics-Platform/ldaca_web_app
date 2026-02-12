"""
Tests for data type detection and serialization functionality.
Migrated from test_datatype_fix.py with proper pytest structure.
"""

import polars as pl
import pytest
from ldaca_web_app_backend.core.utils import serialize_dataframe_for_json


class TestDataTypeDetection:
    """Test data type detection and serialization functionality"""

    @pytest.fixture
    def sample_dataframe(self):
        """Create a sample DataFrame with various data types"""
        return pl.DataFrame({
            "string_col": ["a", "b", "c"],
            "int_col": [1, 2, 3],
            "float_col": [1.1, 2.2, 3.3],
            "bool_col": [True, False, True],
            "null_col": [None, None, None],
        })

    def test_regular_dataframe_serialization(self, sample_dataframe):
        """Test serialization of regular polars DataFrame"""
        if serialize_dataframe_for_json is None:
            pytest.skip("serialize_dataframe_for_json not available")

        result = serialize_dataframe_for_json(sample_dataframe)

        # Check that result is a dictionary with expected structure
        assert isinstance(result, dict)
        assert "columns" in result
        assert "preview" in result  # preview replaces data field

        # Check data types are correctly detected
        columns = result["columns"]
        dtypes = result["dtypes"]

        # Columns should be a list of strings
        assert isinstance(columns, list)
        assert len(columns) == 5

        # Check that basic columns are present
        assert "string_col" in columns
        assert "int_col" in columns
        assert "float_col" in columns
        assert "bool_col" in columns

        # Check dtypes dictionary
        assert isinstance(dtypes, dict)
        assert dtypes["string_col"] == "String"
        assert dtypes["int_col"] == "Int64"
        assert dtypes["float_col"] == "Float64"
        assert dtypes["bool_col"] == "Boolean"

    def test_empty_dataframe_serialization(self):
        """Test serialization of empty DataFrame"""
        if serialize_dataframe_for_json is None:
            pytest.skip("serialize_dataframe_for_json not available")

        empty_df = pl.DataFrame({
            "col1": pl.Series([], dtype=pl.String),
            "col2": pl.Series([], dtype=pl.Int64),
        })

        result = serialize_dataframe_for_json(empty_df)

        assert isinstance(result, dict)
        assert "columns" in result
        assert "preview" in result  # preview replaces data field
        assert len(result["preview"]) == 0  # No rows in preview
        assert len(result["columns"]) == 2  # Two columns defined

    def test_mixed_null_values(self):
        """Test handling of mixed null values"""
        if serialize_dataframe_for_json is None:
            pytest.skip("serialize_dataframe_for_json not available")

        df_with_nulls = pl.DataFrame({
            "mixed_col": [1, None, 3, None],
            "all_null": [None, None, None, None],
            "no_null": [1, 2, 3, 4],
        })

        result = serialize_dataframe_for_json(df_with_nulls)

        assert isinstance(result, dict)
        # Should handle nulls without crashing
        assert "columns" in result
        assert "preview" in result  # preview replaces data field
        assert len(result["preview"]) == 4  # All rows preserved in preview

    def test_large_numbers(self):
        """Test handling of large numbers"""
        if serialize_dataframe_for_json is None:
            pytest.skip("serialize_dataframe_for_json not available")

        df_large = pl.DataFrame({
            "large_int": [2**60, 2**61, 2**62],
            "large_float": [1e100, 1e200, 1e300],
            "small_float": [1e-100, 1e-200, 1e-300],
        })

        result = serialize_dataframe_for_json(df_large)

        assert isinstance(result, dict)
        assert "columns" in result
        assert "preview" in result  # preview replaces data field
        # Should handle large numbers without overflow errors

    def test_special_string_values(self):
        """Test handling of special string values"""
        if serialize_dataframe_for_json is None:
            pytest.skip("serialize_dataframe_for_json not available")

        df_special = pl.DataFrame({
            "special_strings": [
                "normal_string",
                "string with spaces",
                "string\nwith\nnewlines",
                "string\twith\ttabs",
                'string"with"quotes',
                "string'with'apostrophes",
            ]
        })

        result = serialize_dataframe_for_json(df_special)

        assert isinstance(result, dict)
        assert "columns" in result
        assert "preview" in result  # preview replaces data field
        # Should handle special characters without breaking JSON serialization

    def test_categorical_dtype_serialization(self):
        """Ensure categorical dtypes remain categorical after serialization"""
        if serialize_dataframe_for_json is None:
            pytest.skip("serialize_dataframe_for_json not available")

        df_categorical = pl.DataFrame({
            "cat_col": pl.Series(["apple", "banana", "apple"]).cast(pl.Categorical)
        })

        result = serialize_dataframe_for_json(df_categorical)

        assert isinstance(result, dict)
        assert result["dtypes"].get("cat_col", "").lower().startswith("categorical")


class TestDocWorkspaceTypeMapping:
    """Tests for API schema type conversion helpers"""

    def test_polars_type_to_js_type_categorical(self):
        """Categorical dtypes map to categorical JS type"""
        from ldaca_web_app_backend.core.docworkspace_api import \
            DocWorkspaceAPIUtils

        # Test with Polars type object
        assert (
            DocWorkspaceAPIUtils.polars_type_to_js_type(pl.Categorical) == "categorical"
        )
        )
