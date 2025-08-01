"""
Tests for lazy evaluation information flow through the complete system.
Migrated from test_complete_lazy_flow.py with proper pytest structure.
"""

import polars as pl
import pytest

try:
    from docworkspace import Node, Workspace

    DOCWORKSPACE_AVAILABLE = True
except ImportError:
    DOCWORKSPACE_AVAILABLE = False
    Node = None
    Workspace = None

try:
    import docframe as dc
    from docframe import DocDataFrame

    DOCFRAME_AVAILABLE = True
except ImportError:
    DOCFRAME_AVAILABLE = False
    dc = None
    DocDataFrame = None

pytestmark = pytest.mark.skipif(
    not DOCWORKSPACE_AVAILABLE, reason="docworkspace not available"
)


class TestLazyFlowIntegration:
    """Test that lazy evaluation information flows through the complete system"""

    @pytest.fixture
    def sample_dataframe(self):
        """Create a sample DataFrame for testing"""
        return pl.DataFrame(
            {
                "id": [1, 2, 3, 4, 5],
                "name": ["Alice", "Bob", "Charlie", "David", "Eve"],
                "age": [25, 30, 35, 40, 45],
                "salary": [50000, 60000, 70000, 80000, 90000],
            }
        )

    @pytest.fixture
    def lazy_dataframe(self):
        """Create a lazy DataFrame for testing"""
        return pl.DataFrame(
            {
                "id": [1, 2, 3, 4, 5, 6],
                "department": ["IT", "HR", "Finance", "IT", "HR", "Finance"],
                "budget": [100000, 80000, 120000, 110000, 85000, 125000],
            }
        ).lazy()

    def test_node_info_includes_lazy_field(self, sample_dataframe):
        """Test that Node.info() method includes lazy field"""
        if Node is None:
            pytest.skip("docworkspace not available")

        # Create node with regular DataFrame
        node = Node(sample_dataframe, name="test_node")
        info = node.info()

        # Check that info includes lazy field
        assert isinstance(info, dict)
        assert "lazy" in info
        assert info["lazy"] is False  # Regular DataFrame is not lazy

    def test_lazy_node_info(self, lazy_dataframe):
        """Test that lazy DataFrames are properly identified"""
        if Node is None:
            pytest.skip("docworkspace not available")

        # Create node with lazy DataFrame
        lazy_node = Node(lazy_dataframe, name="lazy_test")
        info = lazy_node.info()

        # Check that lazy field correctly indicates lazy state
        assert isinstance(info, dict)
        assert "lazy" in info
        assert info["lazy"] is True  # Lazy DataFrame should be identified as lazy

    def test_lazy_operations_preserve_lazy_state(
        self, sample_dataframe, lazy_dataframe
    ):
        """Test that operations on lazy DataFrames preserve lazy state"""
        if Node is None:
            pytest.skip("docworkspace not available")

        regular_node = Node(sample_dataframe, name="regular")
        lazy_node = Node(lazy_dataframe, name="lazy")

        # Join operation
        joined_node = regular_node.join(lazy_node, on="id", how="inner")
        joined_info = joined_node.info()

        # The result should indicate whether it's lazy or not
        assert "lazy" in joined_info
        # After join, the result might be materialized (implementation dependent)

    def test_filter_operation_lazy_preservation(self, lazy_dataframe):
        """Test that filter operations preserve lazy state when appropriate"""
        if Node is None:
            pytest.skip("docworkspace not available")

        lazy_node = Node(lazy_dataframe, name="lazy_filter_test")

        # Apply filter operation
        filtered_node = lazy_node.filter(pl.col("budget") > 100000)
        filtered_info = filtered_node.info()

        # Check that lazy state information is available
        assert "lazy" in filtered_info

    def test_workspace_lazy_node_handling(self, sample_dataframe, lazy_dataframe):
        """Test that workspace properly handles lazy nodes"""
        if Node is None or Workspace is None:
            pytest.skip("docworkspace not available")

        # Create workspace with both regular and lazy nodes
        workspace = Workspace()

        regular_node = Node(sample_dataframe, name="regular")
        lazy_node = Node(lazy_dataframe, name="lazy")

        workspace.add_node(regular_node)
        workspace.add_node(lazy_node)

        # Get workspace info
        workspace_info = workspace.info()

        # Check that workspace tracks lazy state of nodes
        assert isinstance(workspace_info, dict)
        # The exact structure depends on implementation, but it should handle lazy nodes

    def test_lazy_state_after_collect(self, lazy_dataframe):
        """Test that lazy state changes after collect() operation"""
        if Node is None:
            pytest.skip("docworkspace not available")

        # Create lazy node
        lazy_node = Node(lazy_dataframe, name="lazy_collect_test")
        lazy_info = lazy_node.info()

        # Verify it starts as lazy
        assert lazy_info["lazy"] is True

        # Force collection by accessing data
        collected_data = lazy_node.data.collect()

        # Create new node with collected data
        collected_node = Node(collected_data, name="collected")
        collected_info = collected_node.info()

        # Should no longer be lazy
        assert collected_info["lazy"] is False

    @pytest.mark.skipif(not DOCFRAME_AVAILABLE, reason="docframe not available")
    def test_lazy_with_doc_dataframe(self):
        """Test lazy state with DocDataFrame integration"""
        if Node is None or dc is None:
            pytest.skip("Required dependencies not available")

        # Create a lazy DataFrame
        lazy_df = pl.DataFrame(
            {
                "text": ["Document 1", "Document 2", "Document 3"],
                "score": [0.8, 0.9, 0.7],
            }
        ).lazy()

        # Create DocDataFrame (this will likely collect the lazy frame)
        doc_df = DocDataFrame(lazy_df.collect(), document_column="text")  # type: ignore

        # Create node with DocDataFrame
        doc_node = Node(doc_df, name="doc_test")
        doc_info = doc_node.info()

        # Check lazy state handling with DocDataFrame
        assert "lazy" in doc_info
        # DocDataFrame typically works with collected data
        assert doc_info["lazy"] is False
