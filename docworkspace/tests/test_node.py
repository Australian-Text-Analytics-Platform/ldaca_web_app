"""Tests for the Node class."""

import polars as pl
import pytest

from docframe import DocDataFrame, DocLazyFrame
from docworkspace import Node, Workspace


class TestNode:
    """Test cases for the Node class."""

    @pytest.fixture
    def sample_df(self):
        """Create a sample polars DataFrame."""
        return pl.DataFrame({"text": ["Hello", "World", "Test"], "value": [1, 2, 3]})

    @pytest.fixture
    def sample_lazy_df(self):
        """Create a sample polars LazyFrame."""
        return pl.LazyFrame({"text": ["Hello", "World", "Test"], "value": [1, 2, 3]})

    @pytest.fixture
    def sample_doc_df(self, sample_df):
        """Create a sample DocDataFrame."""
        return DocDataFrame(sample_df, document_column="text")

    @pytest.fixture
    def sample_doc_lazy_df(self, sample_lazy_df):
        """Create a sample DocLazyFrame."""
        return DocLazyFrame(sample_lazy_df, document_column="text")

    def test_node_creation_with_workspace(self, sample_df):
        """Test creating a Node with explicit workspace."""
        workspace = Workspace("test_workspace")
        node = Node(sample_df, "test_node", workspace)

        assert node.name == "test_node"
        assert not node.is_lazy
        assert len(node.parents) == 0
        assert len(node.children) == 0
        assert node.workspace == workspace

    def test_node_creation_without_workspace(self, sample_df):
        """Test creating a Node without workspace (should create one automatically)."""
        node = Node(sample_df, "test_node")

        assert node.name == "test_node"
        assert not node.is_lazy
        assert node.workspace is not None
        assert isinstance(node.workspace, Workspace)
        assert node.id in node.workspace.nodes

    def test_node_lazy_status_polars_dataframe(self, sample_df):
        """Test lazy status for polars DataFrame."""
        node = Node(sample_df, "test_node")
        assert not node.is_lazy

    def test_node_lazy_status_polars_lazyframe(self, sample_lazy_df):
        """Test lazy status for polars LazyFrame."""
        node = Node(sample_lazy_df, "test_node")
        assert node.is_lazy

    def test_node_lazy_status_doc_dataframe(self, sample_doc_df):
        """Test lazy status for DocDataFrame with DataFrame."""
        node = Node(sample_doc_df, "test_node")
        assert not node.is_lazy

    def test_node_lazy_status_doc_lazyframe(self, sample_doc_lazy_df):
        """Test lazy status for DocLazyFrame."""
        node = Node(sample_doc_lazy_df, "test_node")
        assert node.is_lazy

    def test_node_collect_lazyframe(self, sample_lazy_df):
        """Test collecting a lazy node."""
        node = Node(sample_lazy_df, "test_node")
        assert node.is_lazy

        collected_node = node.collect()
        # collect() creates a new node to preserve computation history
        assert collected_node != node
        assert node.is_lazy  # Original node stays lazy
        assert not collected_node.is_lazy  # New node is materialized
        assert isinstance(collected_node.data, pl.DataFrame)
        assert collected_node in node.children  # New node is child of original

    def test_node_collect_doc_lazyframe(self, sample_doc_lazy_df):
        """Test collecting a lazy DocDataFrame node."""
        node = Node(sample_doc_lazy_df, "test_node")
        assert node.is_lazy

        collected_node = node.collect()
        # collect() creates a new node to preserve computation history
        assert collected_node != node
        assert node.is_lazy  # Original node stays lazy
        assert not collected_node.is_lazy  # New node is materialized
        assert isinstance(collected_node.data, DocDataFrame)
        assert collected_node in node.children  # New node is child of original
        assert isinstance(node.data, DocLazyFrame)  # Original stays as DocLazyFrame
        assert isinstance(collected_node.data, DocDataFrame)  # New node is DocDataFrame

    def test_node_filter(self, sample_df):
        """Test filtering a Node."""
        workspace = Workspace("test_workspace")
        node = Node(sample_df, "test_node", workspace)

        # Filter using polars syntax
        filtered = node.filter(pl.col("value") > 1)

        assert len(filtered.parents) == 1
        assert filtered.parents[0] == node
        assert len(node.children) == 1
        assert node.children[0] == filtered
        assert filtered.workspace == workspace
        assert filtered.id in workspace.nodes

    def test_node_slice(self, sample_df):
        """Test slicing a Node."""
        node = Node(sample_df, "test_node")
        sliced = node.slice(slice(0, 2))

        assert len(sliced.parents) == 1
        assert sliced.parents[0] == node
        assert len(sliced.data) == 2

    def test_node_join(self):
        """Test joining two Nodes."""
        df1 = pl.DataFrame({"key": ["A", "B"], "value1": [1, 2]})
        df2 = pl.DataFrame({"key": ["A", "B"], "value2": [3, 4]})

        workspace = Workspace("test_workspace")
        node1 = Node(df1, "node1", workspace)
        node2 = Node(df2, "node2", workspace)

        # Polars uses join instead of merge
        merged = node1.join(node2, on="key")

        assert len(merged.parents) == 2
        assert node1 in merged.parents
        assert node2 in merged.parents
        assert len(merged.data.columns) == 3  # key, value1, value2

    def test_node_materialize(self, sample_lazy_df):
        """Test materializing a lazy Node."""
        node = Node(sample_lazy_df, "test_node")

        # Before materializing
        assert node.is_lazy
        assert isinstance(node.data, pl.LazyFrame)

        # Materialize
        result = node.materialize()

        # After materializing
        assert result is node  # Should return self
        assert not node.is_lazy  # Should be materialized
        assert isinstance(node.data, pl.DataFrame)

    def test_node_attribute_delegation(self, sample_df):
        """Test that Node delegates attributes to the underlying data."""
        node = Node(sample_df, "test_node")

        # Test property access
        assert node.shape == sample_df.shape
        assert list(node.columns) == list(sample_df.columns)

        # Test method call that returns a new DataFrame
        head_node = node.head(2)
        assert isinstance(head_node, Node)
        assert len(head_node.data) == 2
        assert head_node.parents[0] == node

    def test_node_info(self, sample_df):
        """Test node info method."""
        workspace = Workspace("test_workspace")
        node = Node(sample_df, "test_node", workspace, operation="load")

        info = node.info()

        assert info["name"] == "test_node"
        assert (
            info["dtype"] == pl.DataFrame
        )  # Changed from "type" to "dtype" and comparing class
        assert info["lazy"] is False
        assert info["operation"] == "load"
        assert info["shape"] == (3, 2)
        assert "schema" in info  # Schema should be present instead of columns
        assert len(info["schema"]) == 2  # Should have 2 columns

        # Test that info returns raw types (no JSON conversion in core library)
        raw_info = node.info()
        # dtype should be the actual type object, not a string
        assert raw_info["dtype"] == pl.DataFrame
        # schema should be raw Polars schema, not converted to JS types
        assert hasattr(raw_info["schema"], "items")  # Polars schema has items() method

    def test_node_repr(self, sample_df):
        """Test string representation of Node."""
        node = Node(sample_df, "test_node")

        repr_str = repr(node)
        assert "test_node" in repr_str
        assert "DataFrame" in repr_str
        assert "lazy=False" in repr_str


class TestNodeRelationships:
    """Test parent-child relationships between nodes."""

    @pytest.fixture
    def workspace(self):
        """Create a test workspace."""
        return Workspace("test_workspace")

    @pytest.fixture
    def sample_df(self):
        """Create a sample DataFrame."""
        return pl.DataFrame(
            {
                "id": [1, 2, 3, 4, 5],
                "category": ["A", "B", "A", "B", "C"],
                "value": [10, 20, 30, 40, 50],
            }
        )

    def test_filter_creates_parent_child_relationship(self, workspace, sample_df):
        """Test that filter operation creates proper parent-child relationship."""
        parent = Node(sample_df, "parent", workspace)
        child = parent.filter(pl.col("category") == "A")

        assert len(parent.children) == 1
        assert parent.children[0] == child
        assert len(child.parents) == 1
        assert child.parents[0] == parent

    def test_multiple_children(self, workspace, sample_df):
        """Test that a node can have multiple children."""
        parent = Node(sample_df, "parent", workspace)

        child1 = parent.filter(pl.col("category") == "A")
        child2 = parent.filter(pl.col("category") == "B")
        child3 = parent.slice(0, 3)

        assert len(parent.children) == 3
        assert child1 in parent.children
        assert child2 in parent.children
        assert child3 in parent.children

    def test_merge_multiple_parents(self, workspace):
        """Test that merge creates a node with multiple parents."""
        df1 = pl.DataFrame({"key": [1, 2], "val1": ["a", "b"]})
        df2 = pl.DataFrame({"key": [1, 2], "val2": ["x", "y"]})

        parent1 = Node(df1, "parent1", workspace)
        parent2 = Node(df2, "parent2", workspace)

        merged = parent1.join(parent2, on="key")

        assert len(merged.parents) == 2
        assert parent1 in merged.parents
        assert parent2 in merged.parents
        assert merged in parent1.children
        assert merged in parent2.children
