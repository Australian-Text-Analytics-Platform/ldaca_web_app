"""Tests for join behavior with Polars DataFrames."""

import polars as pl
import pytest
from docworkspace import Node


def _materialize_to_dataframe(data):
    """Return a plain polars DataFrame regardless of lazy wrappers."""

    if hasattr(data, "collect"):
        collected = data.collect()
    else:
        collected = data

    return collected


class TestJoinBehavior:
    """Test join behavior with different DataFrame types"""

    @pytest.fixture
    def regular_dataframe(self):
        """Create a regular polars DataFrame"""
        return pl.DataFrame({
            "id": [1, 2, 3],
            "name": ["Alice", "Bob", "Charlie"],
            "age": [25, 30, 35],
        })

    @pytest.fixture
    def secondary_dataframe(self):
        """Create a secondary DataFrame for join tests."""
        return pl.DataFrame({
            "id": [1, 2, 3],
            "text": ["Document 1", "Document 2", "Document 3"],
            "score": [0.8, 0.9, 0.7],
        })

    def test_join_returns_regular_dataframe(
        self, regular_dataframe, secondary_dataframe
    ):
        """Test that joins between regular DataFrames return regular DataFrame"""
        node1 = Node(regular_dataframe.lazy(), name="regular_data")
        node2 = Node(secondary_dataframe.lazy(), name="secondary_data")

        # Perform join
        joined_node = node1.join(node2, on="id", how="inner")
        joined_data = _materialize_to_dataframe(joined_node.data)

        # Verify the result is a regular DataFrame
        assert isinstance(joined_data, pl.DataFrame)

        # Verify join worked correctly
        assert joined_data.shape[0] == 3  # All rows should match
        assert "name" in joined_data.columns  # From regular_dataframe
        assert "text" in joined_data.columns  # From secondary_dataframe
        assert "score" in joined_data.columns  # From secondary_dataframe

    def test_join_preserves_data_integrity(
        self, regular_dataframe, secondary_dataframe
    ):
        """Test that data integrity is preserved in joins"""
        node1 = Node(regular_dataframe.lazy(), name="regular_data")
        node2 = Node(secondary_dataframe.lazy(), name="secondary_data")

        joined_node = node1.join(node2, on="id", how="inner")
        joined_data = _materialize_to_dataframe(joined_node.data)

        # Check specific values to ensure data integrity
        first_row = joined_data.filter(pl.col("id") == 1).row(0, named=True)
        assert first_row["name"] == "Alice"
        assert first_row["text"] == "Document 1"
        assert first_row["score"] == pytest.approx(0.8)

    def test_left_join_behavior(self, regular_dataframe):
        """Test left join behavior with different DataFrame sizes"""

        # Create a smaller DataFrame for left join testing
        small_data = pl.DataFrame({
            "id": [1, 2],  # Missing id=3
            "category": ["A", "B"],
        })
        node1 = Node(regular_dataframe.lazy(), name="regular_data")
        node2 = Node(small_data.lazy(), name="small_data")

        # Left join should keep all rows from regular_dataframe
        left_joined = node1.join(node2, on="id", how="left")
        result = _materialize_to_dataframe(left_joined.data)

        assert isinstance(result, pl.DataFrame)
        assert result.shape[0] == 3  # All original rows preserved

        # Check that missing value is handled correctly
        third_row = result.filter(pl.col("id") == 3).row(0, named=True)
        assert third_row["name"] == "Charlie"
        assert third_row["category"] is None  # Should be null for missing join
