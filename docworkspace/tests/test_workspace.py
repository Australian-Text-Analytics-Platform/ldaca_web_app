"""Tests for the Workspace class."""

import os
import tempfile
from pathlib import Path

import polars as pl
import pytest

from docframe import DocDataFrame
from docworkspace import Node, Workspace


class TestWorkspace:
    """Test cases for the Workspace class."""

    @pytest.fixture
    def sample_df(self):
        """Create a sample polars DataFrame."""
        return pl.DataFrame({"text": ["Hello", "World", "Test"], "value": [1, 2, 3]})

    @pytest.fixture
    def workspace(self):
        """Create a test workspace."""
        return Workspace("test_workspace")

    def test_workspace_creation(self):
        """Test creating a Workspace."""
        workspace = Workspace("test_workspace")
        assert workspace.name == "test_workspace"
        assert len(workspace.nodes) == 0
        assert workspace.id is not None

    def test_workspace_creation_default_name(self):
        """Test creating a Workspace with default name."""
        workspace = Workspace()
        assert workspace.name.startswith("workspace_")
        assert len(workspace.nodes) == 0

    def test_add_node(self, workspace, sample_df):
        """Test adding a node to workspace."""
        node = Node(sample_df, "test_node", workspace)

        # Node should already be in workspace due to constructor
        assert len(workspace.nodes) == 1
        assert node.id in workspace.nodes
        assert workspace.nodes[node.id] == node

    def test_load_dataframe(self, workspace, sample_df):
        """Test loading a DataFrame into a Workspace."""
        node = workspace.add_node(
            Node(data=sample_df, name="test_data", workspace=workspace)
        )

        assert len(workspace.nodes) == 1
        assert node.id in workspace.nodes
        assert node.name == "test_data"
        assert node.workspace == workspace

    def test_load_lazy_dataframe(self, workspace):
        """Test loading a LazyFrame into a Workspace."""
        lazy_df = pl.LazyFrame({"text": ["Hello", "World", "Test"], "value": [1, 2, 3]})

        node = workspace.add_node(
            Node(data=lazy_df, name="lazy_data", workspace=workspace)
        )

        assert len(workspace.nodes) == 1
        assert node.is_lazy
        assert node.name == "lazy_data"

    def test_load_csv(self, workspace, sample_df):
        """Test loading a CSV file into a Workspace."""
        # Create a temporary CSV file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            sample_df.write_csv(f.name)
            temp_path = f.name

        try:
            # Use workspace's CSV loading via _load_initial_data
            node = workspace._load_initial_data(temp_path, "csv_data", csv_lazy=False)

            assert len(workspace.nodes) == 1
            assert node.name == "csv_data"
            assert len(node.data) == 3
            assert not node.is_lazy
        finally:
            os.unlink(temp_path)

    def test_load_doc_dataframe(self, workspace, sample_df):
        """Test loading a DocDataFrame into a Workspace."""
        doc_df = DocDataFrame(sample_df, document_column="text")
        node = workspace.add_node(
            Node(data=doc_df, name="doc_data", workspace=workspace)
        )

        assert len(workspace.nodes) == 1
        assert node.name == "doc_data"
        assert isinstance(node.data, DocDataFrame)
        assert not node.is_lazy

    def test_get_node_by_name(self, workspace, sample_df):
        """Test getting a node by name."""
        node = workspace.add_node(
            Node(data=sample_df, name="test_data", workspace=workspace)
        )

        found_node = workspace.get_node_by_name("test_data")
        assert found_node == node

        not_found = workspace.get_node_by_name("nonexistent")
        assert not_found is None

    def test_get_root_nodes(self, workspace, sample_df):
        """Test getting root nodes (nodes without parents)."""
        root_node = workspace.add_node(
            Node(data=sample_df, name="root", workspace=workspace)
        )
        child_node = root_node.filter(pl.col("value") > 1)

        root_nodes = workspace.get_root_nodes()

        assert len(root_nodes) == 1
        assert root_nodes[0] == root_node
        assert child_node not in root_nodes

    def test_get_leaf_nodes(self, workspace, sample_df):
        """Test getting leaf nodes (nodes without children)."""
        root_node = workspace.add_node(
            Node(data=sample_df, name="root", workspace=workspace)
        )
        child_node = root_node.filter(pl.col("value") > 1)

        leaf_nodes = workspace.get_leaf_nodes()

        assert len(leaf_nodes) == 1
        assert leaf_nodes[0] == child_node
        assert root_node not in leaf_nodes

    def test_metadata(self, workspace):
        """Test workspace metadata operations."""
        # Set metadata
        workspace.set_metadata("key1", "value1")
        workspace.set_metadata("key2", 42)
        workspace.set_metadata("key3", {"nested": "data"})

        # Get metadata
        assert workspace.get_metadata("key1") == "value1"
        assert workspace.get_metadata("key2") == 42
        assert workspace.get_metadata("key3") == {"nested": "data"}
        assert workspace.get_metadata("nonexistent") is None

    def test_workspace_summary(self, workspace, sample_df):
        """Test workspace summary."""
        # Create some nodes
        root1 = workspace.add_node(
            Node(data=sample_df, name="root1", workspace=workspace)
        )
        root2 = workspace.add_node(
            Node(data=sample_df.lazy(), name="root2", workspace=workspace)
        )
        root1.filter(pl.col("value") > 1)
        root2.filter(pl.col("value") > 2)

        summary = workspace.summary()

        assert summary["total_nodes"] == 4
        assert summary["root_nodes"] == 2
        assert summary["leaf_nodes"] == 2
        assert "DataFrame" in summary["node_types"]
        assert "LazyFrame" in summary["node_types"]

    def test_workspace_iteration(self, workspace, sample_df):
        """Test iterating over workspace nodes."""
        node1 = workspace.add_node(
            Node(data=sample_df, name="node1", workspace=workspace)
        )
        node2 = workspace.add_node(
            Node(data=sample_df, name="node2", workspace=workspace)
        )
        node3 = workspace.add_node(
            Node(data=sample_df, name="node3", workspace=workspace)
        )

        nodes_list = list(workspace)
        assert len(nodes_list) == 3
        assert all(isinstance(n, Node) for n in nodes_list)
        assert node1 in nodes_list
        assert node2 in nodes_list
        assert node3 in nodes_list

    def test_workspace_len(self, workspace, sample_df):
        """Test len() on workspace."""
        assert len(workspace) == 0

        workspace.add_node(Node(data=sample_df, name="node1", workspace=workspace))
        assert len(workspace) == 1

        workspace.add_node(Node(data=sample_df, name="node2", workspace=workspace))
        assert len(workspace) == 2


class TestWorkspaceSerialization:
    """Test workspace serialization and deserialization."""

    @pytest.fixture
    def populated_workspace(self):
        """Create a workspace with some nodes and relationships."""
        workspace = Workspace("test_workspace")
        workspace.set_metadata("test_key", "test_value")
        workspace.set_metadata("version", 1.0)

        # Create nodes
        df1 = pl.DataFrame(
            {"id": [1, 2, 3], "category": ["A", "B", "A"], "value": [10, 20, 30]}
        )

        df2 = pl.DataFrame({"id": [1, 2, 3], "extra": ["x", "y", "z"]})

        root1 = workspace.add_node(Node(data=df1, name="root1", workspace=workspace))
        root2 = workspace.add_node(Node(data=df2, name="root2", workspace=workspace))

        # Create relationships
        root1.filter(pl.col("category") == "A")
        root1.join(root2, on="id")

        return workspace

    def test_workspace_serialization_roundtrip(self, populated_workspace):
        """Round-trip workspace serialization using JSON format (pickle removed)."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            temp_path = f.name

        try:
            # Serialize
            populated_workspace.serialize(temp_path)

            # Deserialize
            loaded_workspace = Workspace.deserialize(temp_path)

            # Check workspace properties
            assert loaded_workspace.name == populated_workspace.name
            assert len(loaded_workspace.nodes) == len(populated_workspace.nodes)
            assert loaded_workspace.get_metadata("test_key") == "test_value"
            assert loaded_workspace.get_metadata("version") == 1.0

            # Check nodes exist
            root1 = loaded_workspace.get_node_by_name("root1")
            root2 = loaded_workspace.get_node_by_name("root2")
            assert root1 is not None
            assert root2 is not None

            # Check relationships are preserved
            assert len(root1.children) == 2  # filtered and merged
            assert len(root2.children) == 1  # merged

        finally:
            os.unlink(temp_path)

    def test_json_serialization(self, populated_workspace):
        """Explicit JSON serialization test (legacy name retained for compatibility)."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            temp_path = f.name

        try:
            # Serialize
            populated_workspace.serialize(temp_path)

            # Deserialize
            loaded_workspace = Workspace.deserialize(temp_path)

            # Check workspace properties
            assert loaded_workspace.name == populated_workspace.name
            assert len(loaded_workspace.nodes) == len(populated_workspace.nodes)
            assert loaded_workspace.get_metadata("test_key") == "test_value"

        finally:
            os.unlink(temp_path)

    def test_serialization_with_lazy_nodes(self):
        """Test serialization of workspace containing lazy nodes."""
        workspace = Workspace("lazy_workspace")

        # Create lazy nodes
        lazy_df = pl.LazyFrame({"a": [1, 2, 3], "b": [4, 5, 6]})

        lazy_node = workspace.add_node(
            Node(data=lazy_df, name="lazy_node", workspace=workspace)
        )
        lazy_node.filter(pl.col("a") > 1)

        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            temp_path = f.name

        try:
            # Serialize (JSON format only)
            workspace.serialize(temp_path)

            # Deserialize
            loaded_workspace = Workspace.deserialize(temp_path)

            # Check nodes
            loaded_lazy = loaded_workspace.get_node_by_name("lazy_node")
            assert loaded_lazy is not None
            # After serialization, lazy frames should remain lazy
            assert loaded_lazy.is_lazy

        finally:
            os.unlink(temp_path)

    def test_load_from_dict(self):
        """Test loading workspace from dictionary (for API compatibility)."""
        # Create a workspace and export to new format
        workspace = Workspace("test")
        df = pl.DataFrame({"a": [1, 2, 3]})
        node = workspace.add_node(Node(data=df, name="test_df", workspace=workspace))

        # Create workspace dict using new serialization format
        workspace_dict = {
            "id": workspace.id,
            "name": workspace.name,
            "nodes": {},
            "metadata": {},
            "relationships": [],
        }

        # Convert nodes using new format
        for node_id, node in workspace.nodes.items():
            workspace_dict["nodes"][node_id] = node.serialize()

        # Load from dict
        loaded = Workspace.from_dict(workspace_dict)

        assert loaded.name == workspace.name
        assert len(loaded.nodes) == 1
        assert loaded.get_node_by_name("test_df") is not None

    def test_workspace_serialized_file_structure(self, populated_workspace):
        """Validate on-disk JSON structure contains expected envelope keys."""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            temp_path = f.name
        try:
            populated_workspace.serialize(temp_path)
            import json as _json

            with open(temp_path, "r", encoding="utf-8") as fh:
                data = _json.load(fh)
            assert "workspace_metadata" in data
            assert "nodes" in data
            assert isinstance(data["nodes"], list)
            # Ensure each node entry has required composite sections
            for n in data["nodes"]:
                for key in ("node_metadata", "data_metadata", "serialized_data"):
                    assert key in n
                assert isinstance(n["serialized_data"], str)
        finally:
            os.unlink(temp_path)


class TestWorkspaceGraphOperations:
    """Test workspace graph analysis and relationship operations."""

    @pytest.fixture
    def complex_workspace(self):
        """Create a workspace with multiple nodes and relationships."""
        workspace = Workspace("complex")

        # Create initial data
        df1 = pl.DataFrame({"id": [1, 2, 3], "value": [10, 20, 30]})
        df2 = pl.DataFrame({"id": [2, 3, 4], "score": [0.5, 0.7, 0.9]})

        root1 = workspace.add_node(Node(df1, "root1"))
        root2 = workspace.add_node(Node(df2, "root2"))

        # Create derived nodes
        filtered1 = root1.filter(pl.col("value") > 15)
        filtered2 = root2.filter(pl.col("score") > 0.6)

        # Create a joined node (has multiple parents)
        _joined = filtered1.join(filtered2, on="id", how="inner")

        return workspace

    def test_workspace_graph_structure(self, complex_workspace):
        """Test the generic graph structure generation."""
        graph_data = complex_workspace.graph()

        assert "nodes" in graph_data
        assert "edges" in graph_data
        assert "workspace_info" in graph_data

        # Check node data structure
        if graph_data["nodes"]:
            node_data = graph_data["nodes"][0]
            required_fields = [
                "id",
                "name",
                "type",
                "lazy",
                "operation",
                "parent_count",
                "child_count",
            ]
            for field in required_fields:
                assert field in node_data

    def test_visualize_graph(self, complex_workspace):
        """Test graph visualization."""
        visualization = complex_workspace.visualize_graph()

        assert isinstance(visualization, str)
        assert "Workspace:" in visualization
        assert "Graph Info:" in visualization

        # Should contain node information
        for node in complex_workspace.nodes.values():
            assert node.name in visualization

    def test_workspace_with_initial_data_loading(self):
        """Test workspace creation with initial data loading."""
        # Test with DataFrame
        df = pl.DataFrame({"col": [1, 2, 3]})
        workspace1 = Workspace("test1", data=df, data_name="initial_data")
        assert len(workspace1.nodes) == 1
        assert "initial_data" in [n.name for n in workspace1.nodes.values()]

        # Test with LazyFrame
        lazy_df = pl.LazyFrame({"col": [4, 5, 6]})
        workspace2 = Workspace("test2", data=lazy_df, data_name="lazy_data")
        assert len(workspace2.nodes) == 1
        node = list(workspace2.nodes.values())[0]
        assert node.is_lazy

    def test_workspace_csv_loading(self):
        """Test workspace CSV loading functionality."""
        # Create a temporary CSV file
        df = pl.DataFrame(
            {
                "name": ["Alice", "Bob", "Charlie"],
                "age": [25, 30, 35],
                "city": ["NYC", "LA", "Chicago"],
            }
        )

        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            df.write_csv(f.name)
            temp_path = f.name

        try:
            # Test lazy loading (default)
            workspace1 = Workspace("csv_test1", data=temp_path, data_name="csv_data")
            assert len(workspace1.nodes) == 1
            node1 = list(workspace1.nodes.values())[0]
            assert node1.is_lazy

            # Test eager loading
            workspace2 = Workspace(
                "csv_test2", data=temp_path, data_name="csv_data", csv_lazy=False
            )
            assert len(workspace2.nodes) == 1
            node2 = list(workspace2.nodes.values())[0]
            assert not node2.is_lazy
        finally:
            Path(temp_path).unlink()

    def test_node_workspace_transfer(self):
        """Test moving nodes between workspaces."""
        workspace1 = Workspace("ws1")
        workspace2 = Workspace("ws2")

        df = pl.DataFrame({"col": [1, 2, 3]})
        node = Node(df, "test_node", workspace1)

        # Node should be in workspace1
        assert node.id in workspace1.nodes
        assert node.workspace == workspace1

        # Add to workspace2 (should move from workspace1)
        workspace2.add_node(node)

        assert node.id not in workspace1.nodes
        assert node.id in workspace2.nodes
        assert node.workspace == workspace2

    def test_workspace_metadata_operations(self):
        """Test workspace metadata functionality."""
        workspace = Workspace("metadata_test")

        # Set metadata
        workspace.set_metadata("project", "test_project")
        workspace.set_metadata("version", "1.0.0")
        workspace.set_metadata("tags", ["test", "development"])

        # Get metadata
        assert workspace.get_metadata("project") == "test_project"
        assert workspace.get_metadata("version") == "1.0.0"
        assert workspace.get_metadata("tags") == ["test", "development"]
        assert workspace.get_metadata("nonexistent") is None

        # Check summary includes metadata
        summary = workspace.summary()
        assert "metadata_keys" in summary
        assert "project" in summary["metadata_keys"]
        assert "version" in summary["metadata_keys"]

    def test_workspace_boolean_and_len_operations(self):
        """Test workspace boolean evaluation and length operations."""
        workspace = Workspace("bool_test")

        # Empty workspace should still be truthy
        assert bool(workspace) is True
        assert len(workspace) == 0

        # Add a node
        df = pl.DataFrame({"col": [1]})
        workspace.add_node(Node(df, "test"))

        assert bool(workspace) is True
        assert len(workspace) == 1

    def test_workspace_iteration(self):
        """Test workspace iteration over nodes."""
        workspace = Workspace("iter_test")

        df1 = pl.DataFrame({"col1": [1, 2]})
        df2 = pl.DataFrame({"col2": [3, 4]})

        node1 = workspace.add_node(Node(df1, "node1"))
        node2 = workspace.add_node(Node(df2, "node2"))

        # Test iteration
        nodes_from_iter = list(workspace)
        assert len(nodes_from_iter) == 2
        assert node1 in nodes_from_iter
        assert node2 in nodes_from_iter

    def test_remove_node_with_materialization(self):
        """Test node removal with child materialization."""
        workspace = Workspace("remove_test")

        # Create parent and child nodes
        df = pl.LazyFrame({"col": [1, 2, 3, 4, 5]})
        parent = workspace.add_node(Node(df, "parent"))
        child = parent.filter(pl.col("col") > 2)

        assert child.is_lazy
        assert len(workspace.nodes) == 2

        # Remove parent with materialization
        removed = workspace.remove_node(parent.id, materialize_children=True)

        assert removed is True
        assert len(workspace.nodes) == 1
        # Child should now be materialized
        remaining_node = list(workspace.nodes.values())[0]
        assert not remaining_node.is_lazy
