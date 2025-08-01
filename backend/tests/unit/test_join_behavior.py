"""
Tests for join behavior with DocDataFrames and regular DataFrames.
Migrated from test_join_behavior.py with proper pytest structure.
"""

import polars as pl
import pytest

try:
    import docframe as dc
    from docframe import DocDataFrame

    DOCFRAME_AVAILABLE = True
except ImportError:
    DOCFRAME_AVAILABLE = False
    dc = None
    DocDataFrame = None

try:
    from docworkspace import Node

    DOCWORKSPACE_AVAILABLE = True
except ImportError:
    DOCWORKSPACE_AVAILABLE = False
    Node = None

pytestmark = pytest.mark.skipif(
    not (DOCFRAME_AVAILABLE and DOCWORKSPACE_AVAILABLE),
    reason="docframe or docworkspace not available",
)


class TestJoinBehavior:
    """Test join behavior with different DataFrame types"""

    @pytest.fixture
    def regular_dataframe(self):
        """Create a regular polars DataFrame"""
        return pl.DataFrame(
            {"id": [1, 2, 3], "name": ["Alice", "Bob", "Charlie"], "age": [25, 30, 35]}
        )

    @pytest.fixture
    def doc_dataframe(self):
        """Create a DocDataFrame for testing"""
        if dc is None:
            pytest.skip("docframe not available")

        data = pl.DataFrame(
            {
                "id": [1, 2, 3],
                "text": ["Document 1", "Document 2", "Document 3"],
                "score": [0.8, 0.9, 0.7],
            }
        )
        return DocDataFrame(data, document_column="text")  # type: ignore

    def test_join_returns_regular_dataframe(self, regular_dataframe, doc_dataframe):
        """Test that joins between regular and DocDataFrame return regular DataFrame"""
        if dc is None or Node is None:
            pytest.skip("Required dependencies not available")

        # Create nodes
        node1 = Node(regular_dataframe, name="regular_data")
        node2 = Node(doc_dataframe, name="doc_data")

        # Perform join
        joined_node = node1.join(node2, on="id", how="inner")
        joined_data = joined_node.data

        # Verify the result is a regular DataFrame, not DocDataFrame
        assert isinstance(joined_data, pl.DataFrame)
        if DocDataFrame is not None:
            assert not isinstance(joined_data, DocDataFrame)

        # Verify join worked correctly
        assert joined_data.shape[0] == 3  # All rows should match
        assert "name" in joined_data.columns  # From regular_dataframe
        assert "text" in joined_data.columns  # From doc_dataframe
        assert "score" in joined_data.columns  # From doc_dataframe

    def test_join_preserves_data_integrity(self, regular_dataframe, doc_dataframe):
        """Test that data integrity is preserved in joins"""
        if dc is None or Node is None:
            pytest.skip("Required dependencies not available")

        node1 = Node(regular_dataframe, name="regular_data")
        node2 = Node(doc_dataframe, name="doc_data")

        joined_node = node1.join(node2, on="id", how="inner")
        joined_data = joined_node.data

        # Check specific values to ensure data integrity
        first_row = joined_data.filter(pl.col("id") == 1).row(0, named=True)
        assert first_row["name"] == "Alice"
        assert first_row["text"] == "Document 1"
        assert first_row["score"] == pytest.approx(0.8)

    def test_left_join_behavior(self, regular_dataframe):
        """Test left join behavior with different DataFrame types"""
        if dc is None or Node is None:
            pytest.skip("Required dependencies not available")

        # Create a smaller DocDataFrame for left join testing
        small_doc_data = pl.DataFrame(
            {
                "id": [1, 2],  # Missing id=3
                "category": ["A", "B"],
            }
        )
        small_doc_df = DocDataFrame(small_doc_data, document_column="category")  # type: ignore

        node1 = Node(regular_dataframe, name="regular_data")
        node2 = Node(small_doc_df, name="small_doc_data")

        # Left join should keep all rows from regular_dataframe
        left_joined = node1.join(node2, on="id", how="left")
        result = left_joined.data

        assert isinstance(result, pl.DataFrame)
        if DocDataFrame is not None:
            assert not isinstance(result, DocDataFrame)
        assert result.shape[0] == 3  # All original rows preserved

        # Check that missing value is handled correctly
        third_row = result.filter(pl.col("id") == 3).row(0, named=True)
        assert third_row["name"] == "Charlie"
        assert third_row["category"] is None  # Should be null for missing join
