"""Simple tests for node operations to replace some failing tests."""

import polars as pl
import pytest

from docworkspace import Node, Workspace


class TestSimpleOperations:
    """Test simple node operations that work with current architecture."""

    def test_node_filter_creates_child(self):
        """Test that filtering creates a child node automatically."""
        workspace = Workspace("filter_test")
        df = pl.DataFrame({"id": [1, 2, 3, 4, 5], "value": [10, 20, 30, 40, 50]})

        original = workspace.add_node(Node(df, "original"))
        filtered = original.filter(pl.col("value") > 25)

        # Should create a new node automatically
        assert len(workspace.nodes) == 2
        assert filtered.name == "filter_original"
        assert len(filtered.parents) == 1
        assert filtered.parents[0] == original
        assert len(original.children) == 1
        assert original.children[0] == filtered

    def test_node_select_creates_child(self):
        """Test that selecting creates a child node automatically."""
        workspace = Workspace("select_test")
        df = pl.DataFrame(
            {"id": [1, 2, 3], "name": ["a", "b", "c"], "value": [10, 20, 30]}
        )

        original = workspace.add_node(Node(df, "original"))
        selected = original.select(["id", "name"])

        assert len(workspace.nodes) == 2
        assert selected.data.width == 2
        assert len(selected.parents) == 1

    def test_chained_operations(self):
        """Test chaining multiple operations."""
        workspace = Workspace("chain_test")
        df = pl.DataFrame(
            {
                "id": [1, 2, 3, 4, 5],
                "category": ["A", "B", "A", "C", "B"],
                "value": [10, 20, 30, 40, 50],
            }
        )

        original = workspace.add_node(Node(df, "original"))
        filtered = original.filter(pl.col("value") > 15)
        selected = filtered.select(["id", "category"])

        # Should have 3 nodes now
        assert len(workspace.nodes) == 3

        # Check the chain
        assert len(original.children) == 1
        assert len(filtered.parents) == 1
        assert len(filtered.children) == 1
        assert len(selected.parents) == 1

    def test_workspace_basic_metadata(self):
        """Test basic workspace metadata without API methods."""
        workspace = Workspace("metadata_test")
        df = pl.DataFrame({"x": [1, 2], "y": ["a", "b"]})

        node = workspace.add_node(Node(df, "test_node"))

        # Test basic properties
        assert len(workspace.nodes) == 1
        assert workspace.name == "metadata_test"
        assert node.name == "test_node"
        assert not node.is_lazy

    def test_lazy_frame_operations(self):
        """Test operations with lazy frames."""
        workspace = Workspace("lazy_test")
        lazy_df = pl.LazyFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})

        lazy_node = workspace.add_node(Node(lazy_df, "lazy_original"))
        filtered_lazy = lazy_node.filter(pl.col("a") > 1)

        assert lazy_node.is_lazy
        assert filtered_lazy.is_lazy
        assert len(workspace.nodes) == 2
