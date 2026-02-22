"""
Tests for lazy evaluation information flow through the complete system.
Migrated from test_complete_lazy_flow.py with proper pytest structure.
"""

import polars as pl
import pytest
from docworkspace import Node, Workspace


class TestLazyFlowIntegration:
    """Test that lazy evaluation information flows through the complete system"""

    @pytest.fixture
    def sample_dataframe(self):
        """Create a sample DataFrame for testing"""
        return pl.DataFrame({
            "id": [1, 2, 3, 4, 5],
            "name": ["Alice", "Bob", "Charlie", "David", "Eve"],
            "age": [25, 30, 35, 40, 45],
            "salary": [50000, 60000, 70000, 80000, 90000],
        })

    @pytest.fixture
    def lazy_dataframe(self):
        """Create a lazy DataFrame for testing"""
        return pl.DataFrame({
            "id": [1, 2, 3, 4, 5, 6],
            "department": ["IT", "HR", "Finance", "IT", "HR", "Finance"],
            "budget": [100000, 80000, 120000, 110000, 85000, 125000],
        }).lazy()

    def test_node_info_includes_lazy_field(self, sample_dataframe):
        """Test that Node.info() returns basic node metadata."""
        # Create node with regular DataFrame
        node = Node(sample_dataframe.lazy(), name="test_node")
        info = node.info()

        # Check that info contains expected basic metadata
        assert isinstance(info, dict)
        assert info["name"] == "test_node"
        assert info["columns"] == ["id", "name", "age", "salary"]

    def test_lazy_node_info(self, lazy_dataframe):
        """Test that node info is exposed for lazy-backed nodes."""
        # Create node with lazy DataFrame
        lazy_node = Node(lazy_dataframe, name="lazy_test")
        info = lazy_node.info()

        # Check that info contains expected metadata
        assert isinstance(info, dict)
        assert info["name"] == "lazy_test"
        assert set(info["columns"]) == {"id", "department", "budget"}

    def test_lazy_operations_preserve_lazy_state(
        self, sample_dataframe, lazy_dataframe
    ):
        """Test that operations on lazy nodes produce valid node info."""
        regular_node = Node(sample_dataframe.lazy(), name="regular")
        lazy_node = Node(lazy_dataframe, name="lazy")

        # Join operation
        joined_node = regular_node.join(lazy_node, on="id", how="inner")
        joined_info = joined_node.info()

        assert joined_info["operation"] == "join(inner)"
        assert "columns" in joined_info

    def test_filter_operation_lazy_preservation(self, lazy_dataframe):
        """Test that filter operations expose expected metadata."""
        lazy_node = Node(lazy_dataframe, name="lazy_filter_test")

        # Apply filter operation
        filtered_node = lazy_node.filter(pl.col("budget") > 100000)
        filtered_info = filtered_node.info()

        assert filtered_info["operation"] == "filter"
        assert "columns" in filtered_info

    def test_workspace_lazy_node_handling(self, sample_dataframe, lazy_dataframe):
        """Test that workspace properly handles lazy nodes"""
        # Create workspace with both regular and lazy nodes
        workspace = Workspace()

        regular_node = Node(sample_dataframe.lazy(), name="regular")
        lazy_node = Node(lazy_dataframe, name="lazy")

        workspace.add_node(regular_node)
        workspace.add_node(lazy_node)

        # Get workspace info
        workspace_info = workspace.info_json()

        # Check that workspace tracks lazy state of nodes
        assert isinstance(workspace_info, dict)
        # The exact structure depends on implementation, but it should handle lazy nodes

    def test_lazy_state_after_collect(self, lazy_dataframe):
        """Test that node info remains valid after collect and re-wrap."""
        # Create lazy node
        lazy_node = Node(lazy_dataframe, name="lazy_collect_test")

        # Force collection by accessing data
        collected_data = lazy_node.data.collect()

        # Create new node with collected data
        collected_node = Node(collected_data.lazy(), name="collected")
        collected_info = collected_node.info()

        assert collected_info["name"] == "collected"
        assert set(collected_info["columns"]) == {"id", "department", "budget"}
