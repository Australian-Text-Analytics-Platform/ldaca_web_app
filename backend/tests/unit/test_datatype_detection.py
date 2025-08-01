"""
Tests for data type detection and serialization functionality.
Migrated from test_datatype_fix.py with proper pytest structure.
"""

import polars as pl
import pytest

try:
    from core.utils import serialize_dataframe_for_json

    CORE_UTILS_AVAILABLE = True
except ImportError:
    CORE_UTILS_AVAILABLE = False
    serialize_dataframe_for_json = None

try:
    import docframe as dc
    from docframe import DocDataFrame

    DOCFRAME_AVAILABLE = True
except ImportError:
    DOCFRAME_AVAILABLE = False
    dc = None
    DocDataFrame = None

pytestmark = pytest.mark.skipif(
    not CORE_UTILS_AVAILABLE, reason="core.utils not available"
)


class TestDataTypeDetection:
    """Test data type detection and serialization functionality"""

    @pytest.fixture
    def sample_dataframe(self):
        """Create a sample DataFrame with various data types"""
        return pl.DataFrame(
            {
                "string_col": ["a", "b", "c"],
                "int_col": [1, 2, 3],
                "float_col": [1.1, 2.2, 3.3],
                "bool_col": [True, False, True],
                "null_col": [None, None, None],
            }
        )

    @pytest.fixture
    def doc_dataframe(self):
        """Create a DocDataFrame for testing"""
        if dc is None:
            pytest.skip("docframe not available")

        data = pl.DataFrame(
            {
                "text": ["Document 1", "Document 2", "Document 3"],
                "score": [0.8, 0.9, 0.7],
                "category": ["news", "blog", "research"],
            }
        )
        return DocDataFrame(data, document_column="text")  # type: ignore

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

    @pytest.mark.skipif(not DOCFRAME_AVAILABLE, reason="docframe not available")
    def test_doc_dataframe_serialization(self, doc_dataframe):
        """Test serialization of DocDataFrame"""
        if serialize_dataframe_for_json is None:
            pytest.skip("serialize_dataframe_for_json not available")

        result = serialize_dataframe_for_json(doc_dataframe)

        # Should handle DocDataFrame properly
        assert isinstance(result, dict)
        assert "columns" in result
        assert "preview" in result  # preview replaces data field

        # Check that text column (document column) is detected
        columns = result["columns"]

        # Columns should be a list of strings
        assert isinstance(columns, list)
        assert "text" in columns
        assert "score" in columns
        assert "category" in columns

    def test_empty_dataframe_serialization(self):
        """Test serialization of empty DataFrame"""
        if serialize_dataframe_for_json is None:
            pytest.skip("serialize_dataframe_for_json not available")

        empty_df = pl.DataFrame(
            {
                "col1": pl.Series([], dtype=pl.String),
                "col2": pl.Series([], dtype=pl.Int64),
            }
        )

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

        df_with_nulls = pl.DataFrame(
            {
                "mixed_col": [1, None, 3, None],
                "all_null": [None, None, None, None],
                "no_null": [1, 2, 3, 4],
            }
        )

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

        df_large = pl.DataFrame(
            {
                "large_int": [2**60, 2**61, 2**62],
                "large_float": [1e100, 1e200, 1e300],
                "small_float": [1e-100, 1e-200, 1e-300],
            }
        )

        result = serialize_dataframe_for_json(df_large)

        assert isinstance(result, dict)
        assert "columns" in result
        assert "preview" in result  # preview replaces data field
        # Should handle large numbers without overflow errors

    def test_special_string_values(self):
        """Test handling of special string values"""
        if serialize_dataframe_for_json is None:
            pytest.skip("serialize_dataframe_for_json not available")

        df_special = pl.DataFrame(
            {
                "special_strings": [
                    "normal_string",
                    "string with spaces",
                    "string\nwith\nnewlines",
                    "string\twith\ttabs",
                    'string"with"quotes',
                    "string'with'apostrophes",
                ]
            }
        )

        result = serialize_dataframe_for_json(df_special)

        assert isinstance(result, dict)
        assert "columns" in result
        assert "preview" in result  # preview replaces data field
        # Should handle special characters without breaking JSON serialization
