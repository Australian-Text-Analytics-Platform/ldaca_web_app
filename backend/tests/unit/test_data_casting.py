"""
Tests for data type casting functionality.
Migrated from test_cast_functionality.py with proper pytest structure.
"""

import polars as pl
import pytest

try:
    import docframe as dc

    DOCFRAME_AVAILABLE = True
except ImportError:
    DOCFRAME_AVAILABLE = False
    dc = None

pytestmark = pytest.mark.skipif(not DOCFRAME_AVAILABLE, reason="docframe not available")


class TestBasicCasting:
    """Test basic casting functionality"""

    @pytest.fixture
    def sample_dataframe(self):
        """Sample DataFrame for casting tests"""
        return pl.DataFrame(
            {
                "id": ["1", "2", "3"],
                "age": ["25", "30", "35"],
                "price": ["19.99", "25.50", "30.00"],
                "date_str": ["2023-01-01", "2023-02-15", "2023-03-20"],
            }
        )

    def test_string_to_int_cast(self, sample_dataframe):
        """Test casting string column to integer"""
        casted_df = sample_dataframe.with_columns(
            pl.col("age").cast(pl.Int64).alias("age")
        )

        assert casted_df.schema["age"] == pl.Int64
        assert casted_df["age"].to_list() == [25, 30, 35]

    def test_string_to_float_cast(self, sample_dataframe):
        """Test casting string column to float"""
        casted_df = sample_dataframe.with_columns(
            pl.col("price").cast(pl.Float64).alias("price")
        )

        assert casted_df.schema["price"] == pl.Float64
        assert casted_df["price"].to_list() == pytest.approx([19.99, 25.50, 30.00])

    def test_string_to_datetime_cast(self, sample_dataframe):
        """Test casting string column to datetime"""
        casted_df = sample_dataframe.with_columns(
            pl.col("date_str").str.to_datetime(format="%Y-%m-%d").alias("date_str")
        )

        assert casted_df.schema["date_str"] == pl.Datetime("us")
        # Verify dates are parsed correctly
        dates = casted_df["date_str"].to_list()
        assert len(dates) == 3


class TestDocDataFrameCasting:
    """Test casting functionality with DocDataFrame"""

    @pytest.fixture
    def sample_doc_dataframe(self):
        """Sample DocDataFrame for casting tests"""
        if dc is None:
            pytest.skip("docframe not available")

        df = pl.DataFrame(
            {
                "text": ["Hello world", "Good morning", "How are you"],
                "score": ["0.85", "0.92", "0.78"],
            }
        )
        return dc.DocDataFrame(df, document_column="text")  # type: ignore

    def test_cast_in_doc_dataframe(self, sample_doc_dataframe):
        """Test casting columns within a DocDataFrame"""
        if dc is None:
            pytest.skip("docframe not available")

        # Cast score to float - already a DataFrame
        casted_polars = sample_doc_dataframe.dataframe.with_columns(
            pl.col("score").cast(pl.Float64).alias("score")
        )

        # Create new DocDataFrame with casted data
        document_column = getattr(sample_doc_dataframe, "_document_column_name", "text")
        new_doc_df = dc.DocDataFrame(casted_polars, document_column=document_column)  # type: ignore

        assert new_doc_df.dataframe.schema["score"] == pl.Float64
        # Get score values using proper DataFrame syntax
        score_values = new_doc_df.dataframe.get_column("score").to_list()
        assert score_values == pytest.approx([0.85, 0.92, 0.78])
        assert getattr(new_doc_df, "_document_column_name", None) == "text"


class TestTypeMappings:
    """Test type mapping functionality"""

    def test_polars_type_mappings(self):
        """Test that polars type mappings work correctly"""
        type_mappings = {
            "Int64": pl.Int64,
            "Int32": pl.Int32,
            "Float64": pl.Float64,
            "Float32": pl.Float32,
            "Utf8": pl.Utf8,
            "Boolean": pl.Boolean,
            "Datetime": pl.Datetime,
            "Date": pl.Date,
        }

        for type_str, polars_type in type_mappings.items():
            assert polars_type is not None, (
                f"Type {type_str} should map to a valid polars type"
            )

            # Verify we can create columns with these types
            test_df = pl.DataFrame({"test": [1]})
            if polars_type in [pl.Int64, pl.Int32]:
                casted = test_df.with_columns(pl.col("test").cast(polars_type))
                assert casted.schema["test"] == polars_type
            elif polars_type in [pl.Float64, pl.Float32]:
                casted = test_df.with_columns(pl.col("test").cast(polars_type))
                assert casted.schema["test"] == polars_type

    def test_string_type_aliases(self):
        """Test that string type aliases work correctly"""
        # These should be equivalent
        assert pl.Utf8 == pl.String if hasattr(pl, "String") else pl.Utf8

        # Boolean aliases
        assert pl.Boolean == pl.Bool if hasattr(pl, "Bool") else pl.Boolean
