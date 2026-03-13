"""Tests for the Workspace class."""

import os
import tempfile
from pathlib import Path

import polars as pl
import pytest
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
        assert workspace.ws_root_dir.exists()

    def test_workspace_creation_default_name(self):
        """Test creating a Workspace with default name."""
        workspace = Workspace()
        assert workspace.name.startswith("workspace_")
        assert len(workspace.nodes) == 0

    def test_add_node(self, workspace, sample_df):
        """Test adding a node to workspace."""
        node = Node(sample_df.lazy(), "test_node", workspace)

        # Node should already be in workspace due to constructor
        assert len(workspace.nodes) == 1
        assert node.id in workspace.nodes
        assert workspace.nodes[node.id] == node

    def test_load_dataframe(self, workspace, sample_df):
        """Test loading a DataFrame into a Workspace."""
        node = workspace.add_node(
            Node(data=sample_df.lazy(), name="test_data", workspace=workspace)
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
        assert isinstance(node.data, pl.LazyFrame)
        assert node.name == "lazy_data"

    def test_load_csv(self, workspace, sample_df):
        """Test explicit CSV loading into an existing Workspace."""
        # Create a temporary CSV file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            sample_df.write_csv(f.name)
            temp_path = f.name

        try:
            lazy_data = pl.read_csv(temp_path).lazy()
            node = workspace.add_node(
                Node(data=lazy_data, name="csv_data", workspace=workspace)
            )

            assert len(workspace.nodes) == 1
            assert node.name == "csv_data"
            assert node.data.collect().height == 3
            assert isinstance(node.data, pl.LazyFrame)
        finally:
            os.unlink(temp_path)

    def test_get_node_by_name(self, workspace, sample_df):
        """Test getting a node by name."""
        node = workspace.add_node(
            Node(data=sample_df.lazy(), name="test_data", workspace=workspace)
        )

        found_node = workspace.get_node_by_name("test_data")
        assert found_node == node

        not_found = workspace.get_node_by_name("nonexistent")
        assert not_found is None

    def test_get_root_nodes(self, workspace, sample_df):
        """Test getting root nodes (nodes without parents)."""
        root_node = workspace.add_node(
            Node(data=sample_df.lazy(), name="root", workspace=workspace)
        )
        child_node = root_node.filter(pl.col("value") > 1)

        root_nodes = workspace.get_root_nodes()

        assert len(root_nodes) == 1
        assert root_nodes[0] == root_node
        assert child_node not in root_nodes

    def test_get_leaf_nodes(self, workspace, sample_df):
        """Test getting leaf nodes (nodes without children)."""
        root_node = workspace.add_node(
            Node(data=sample_df.lazy(), name="root", workspace=workspace)
        )
        child_node = root_node.filter(pl.col("value") > 1)

        leaf_nodes = workspace.get_leaf_nodes()

        assert len(leaf_nodes) == 1
        assert leaf_nodes[0] == child_node
        assert root_node not in leaf_nodes

    def test_metadata(self, workspace):
        """Test workspace metadata operations via direct properties."""
        workspace.description = "Example workspace"
        workspace.created_at = "2024-01-01T00:00:00Z"
        workspace.modified_at = "2024-01-02T00:00:00Z"

        assert workspace.description == "Example workspace"
        assert workspace.created_at == "2024-01-01T00:00:00Z"
        assert workspace.modified_at == "2024-01-02T00:00:00Z"

    def test_workspace_info_json(self, workspace, sample_df):
        """Test workspace info_json payload."""
        # Create some nodes
        root1 = workspace.add_node(
            Node(data=sample_df.lazy(), name="root1", workspace=workspace)
        )
        root2 = workspace.add_node(
            Node(data=sample_df.lazy(), name="root2", workspace=workspace)
        )
        root1.filter(pl.col("value") > 1)
        root2.filter(pl.col("value") > 2)

        summary = workspace.info_json()

        assert summary["total_nodes"] == 4
        assert summary["root_nodes"] == 2
        assert summary["leaf_nodes"] == 2
        assert "description" in summary
        assert "created_at" in summary
        assert "modified_at" in summary

    def test_workspace_iteration(self, workspace, sample_df):
        """Test iterating over workspace nodes."""
        node1 = workspace.add_node(
            Node(data=sample_df.lazy(), name="node1", workspace=workspace)
        )
        node2 = workspace.add_node(
            Node(data=sample_df.lazy(), name="node2", workspace=workspace)
        )
        node3 = workspace.add_node(
            Node(data=sample_df.lazy(), name="node3", workspace=workspace)
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

        workspace.add_node(
            Node(data=sample_df.lazy(), name="node1", workspace=workspace)
        )
        assert len(workspace) == 1

        workspace.add_node(
            Node(data=sample_df.lazy(), name="node2", workspace=workspace)
        )
        assert len(workspace) == 2


class TestWorkspaceSerialization:
    """Test workspace serialization and deserialization."""

    @pytest.fixture
    def populated_workspace(self):
        """Create a workspace with some nodes and relationships."""
        workspace = Workspace("test_workspace")
        workspace.description = "serialized workspace"
        workspace.created_at = "2024-01-01T00:00:00Z"
        workspace.modified_at = "2024-01-01T12:00:00Z"

        # Create nodes
        df1 = pl.DataFrame({
            "id": [1, 2, 3],
            "category": ["A", "B", "A"],
            "value": [10, 20, 30],
        })

        df2 = pl.DataFrame({"id": [1, 2, 3], "extra": ["x", "y", "z"]})

        root1 = workspace.add_node(
            Node(data=df1.lazy(), name="root1", workspace=workspace)
        )
        root2 = workspace.add_node(
            Node(data=df2.lazy(), name="root2", workspace=workspace)
        )

        # Create relationships
        root1.filter(pl.col("category") == "A")
        root1.join(root2, on="id")

        return workspace

    def test_workspace_serialization_roundtrip(self, populated_workspace):
        """Round-trip workspace serialization using JSON format (pickle removed)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            meta_path = Path(tmpdir) / "metadata.json"

            # Serialize
            populated_workspace.save(meta_path)

            # Deserialize
            loaded_workspace = Workspace.load(meta_path)

            # Check workspace properties
            assert loaded_workspace.name == populated_workspace.name
            assert len(loaded_workspace.nodes) == len(populated_workspace.nodes)
            assert loaded_workspace.description == "serialized workspace"
            assert loaded_workspace.created_at == "2024-01-01T00:00:00Z"
            assert loaded_workspace.modified_at == "2024-01-01T12:00:00Z"

            # Check nodes exist
            root1 = loaded_workspace.get_node_by_name("root1")
            root2 = loaded_workspace.get_node_by_name("root2")
            assert root1 is not None
            assert root2 is not None

            # Check relationships are preserved
            assert len(root1.children) == 2  # filtered and merged
            assert len(root2.children) == 1  # merged

    def test_json_serialization(self, populated_workspace):
        """Explicit JSON serialization test."""
        with tempfile.TemporaryDirectory() as tmpdir:
            meta_path = Path(tmpdir) / "metadata.json"

            # Serialize
            populated_workspace.save(meta_path)

            # Deserialize
            loaded_workspace = Workspace.load(meta_path)

            # Check workspace properties
            assert loaded_workspace.name == populated_workspace.name
            assert len(loaded_workspace.nodes) == len(populated_workspace.nodes)
            assert loaded_workspace.description == "serialized workspace"

    def test_serialization_with_lazy_nodes(self):
        """Test serialization of workspace containing lazy nodes."""
        workspace = Workspace("lazy_workspace")

        # Create lazy nodes
        lazy_df = pl.LazyFrame({"a": [1, 2, 3], "b": [4, 5, 6]})

        lazy_node = workspace.add_node(
            Node(data=lazy_df, name="lazy_node", workspace=workspace)
        )
        lazy_node.filter(pl.col("a") > 1)

        with tempfile.TemporaryDirectory() as tmpdir:
            meta_path = Path(tmpdir) / "metadata.json"

            # Serialize (JSON format only)
            workspace.save(meta_path)

            # Deserialize
            loaded_workspace = Workspace.load(meta_path)

            # Check nodes
            loaded_lazy = loaded_workspace.get_node_by_name("lazy_node")
            assert loaded_lazy is not None
            # After serialization, lazy frames should remain lazy
            assert isinstance(loaded_lazy.data, pl.LazyFrame)

    def test_undo_redo_stacks_are_not_persisted(self):
        """Undo/redo history is in-memory only and must reset after load."""
        workspace = Workspace("undo_runtime_only")
        node = workspace.add_node(
            Node(
                data=pl.DataFrame({"a": [1, 2, 3]}).lazy(),
                name="root",
                workspace=workspace,
            )
        )

        node.data = node.data.with_columns(pl.lit(1).alias("b"))
        assert node.can_undo is True

        with tempfile.TemporaryDirectory() as tmpdir:
            meta_path = Path(tmpdir) / "metadata.json"
            workspace.save(meta_path)

            loaded_workspace = Workspace.load(meta_path)
            loaded_node = loaded_workspace.get_node_by_name("root")

            assert loaded_node is not None
            assert loaded_node.can_undo is False
            assert loaded_node.can_redo is False

    def test_load_from_dict_rejected(self):
        """Workspace.load should accept path-like values only."""
        with pytest.raises(TypeError):
            Workspace.load({"workspace_metadata": {}, "nodes": []})

    def test_workspace_serialized_file_structure(self, populated_workspace):
        """Validate on-disk JSON structure contains expected envelope keys."""
        with tempfile.TemporaryDirectory() as tmpdir:
            meta_path = Path(tmpdir) / "metadata.json"
            populated_workspace.save(meta_path)
            import json as _json

            with open(meta_path, "r", encoding="utf-8") as fh:
                data = _json.load(fh)
            assert "workspace_metadata" in data
            assert "nodes" in data
            assert isinstance(data["nodes"], list)
            # Ensure each node entry has required composite sections
            for n in data["nodes"]:
                assert "node_metadata" in n
                assert "data_path" in n
                assert "serialized_data" not in n
                rel_path = n["data_path"]
                assert isinstance(rel_path, str)
                abs_path = (Path(tmpdir) / rel_path).resolve()
                assert abs_path.exists(), f"Missing node data file: {abs_path}"
                assert abs_path.stat().st_size > 0

    def test_remove_node_deletes_binary_file_when_workspace_dir_attached(self):
        """Removing a node should delete its persisted data/<node_id>.plbin file."""
        workspace = Workspace("ws")
        df = pl.DataFrame({"a": [1, 2, 3]})
        node = workspace.add_node(Node(data=df.lazy(), name="n", workspace=workspace))

        with tempfile.TemporaryDirectory() as tmpdir:
            meta_path = Path(tmpdir) / "metadata.json"
            workspace.save(meta_path)
            workspace.ws_root_dir = Path(tmpdir)

            payload_file = Path(tmpdir) / "data" / f"{node.id}.plbin"
            assert payload_file.exists()

            assert workspace.remove_node(node.id) is True
            assert not payload_file.exists()

    def test_write_workspace_removes_orphan_plbin_files(self):
        """Persisting should clean up stale *.plbin files not referenced by nodes."""
        workspace = Workspace("ws")
        df = pl.DataFrame({"a": [1]})
        workspace.add_node(Node(data=df.lazy(), name="n", workspace=workspace))

        with tempfile.TemporaryDirectory() as tmpdir:
            meta_path = Path(tmpdir) / "metadata.json"
            workspace.save(meta_path)

            orphan = Path(tmpdir) / "data" / "orphan.plbin"
            orphan.parent.mkdir(parents=True, exist_ok=True)
            orphan.write_bytes(b"not a real polars payload")
            assert orphan.exists()

            workspace.save(meta_path)
            assert not orphan.exists()


class TestWorkspaceGraphOperations:
    """Test workspace graph analysis and relationship operations."""

    @pytest.fixture
    def complex_workspace(self):
        """Create a workspace with multiple nodes and relationships."""
        workspace = Workspace("complex")

        # Create initial data
        df1 = pl.DataFrame({"id": [1, 2, 3], "value": [10, 20, 30]})
        df2 = pl.DataFrame({"id": [2, 3, 4], "score": [0.5, 0.7, 0.9]})

        root1 = workspace.add_node(Node(df1.lazy(), "root1"))
        root2 = workspace.add_node(Node(df2.lazy(), "root2"))

        # Create derived nodes
        filtered1 = root1.filter(pl.col("value") > 15)
        filtered2 = root2.filter(pl.col("score") > 0.6)

        # Create a joined node (has multiple parents)
        _joined = filtered1.join(filtered2, on="id", how="inner")

        return workspace

    def test_workspace_graph_structure(self, complex_workspace):
        """Test the generic graph structure generation."""
        graph_data = complex_workspace.graph_json()

        assert "nodes" in graph_data
        assert "edges" in graph_data
        assert "workspace_info" not in graph_data

        # Check node data structure
        if graph_data["nodes"]:
            node_data = graph_data["nodes"][0]
            required_fields = [
                "id",
                "name",
                "operation",
            ]
            for field in required_fields:
                assert field in node_data

    def test_workspace_with_initial_data_loading(self):
        """Test explicit initial data loading after creating an empty workspace."""
        # Test with DataFrame converted to LazyFrame before creating a Node.
        df = pl.DataFrame({"col": [1, 2, 3]})
        workspace1 = Workspace("test1")
        workspace1.add_node(
            Node(data=df.lazy(), name="initial_data", workspace=workspace1)
        )
        assert len(workspace1.nodes) == 1
        assert "initial_data" in [n.name for n in workspace1.nodes.values()]

        # Test with LazyFrame
        lazy_df = pl.LazyFrame({"col": [4, 5, 6]})
        workspace2 = Workspace("test2")
        workspace2.add_node(Node(data=lazy_df, name="lazy_data", workspace=workspace2))
        assert len(workspace2.nodes) == 1
        node = list(workspace2.nodes.values())[0]
        assert isinstance(node.data, pl.LazyFrame)

    def test_workspace_csv_loading(self):
        """Test explicit CSV loading workflow for workspaces."""
        # Create a temporary CSV file
        df = pl.DataFrame({
            "name": ["Alice", "Bob", "Charlie"],
            "age": [25, 30, 35],
            "city": ["NYC", "LA", "Chicago"],
        })

        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
            df.write_csv(f.name)
            temp_path = f.name

        try:
            # Test lazy loading (scan CSV and add node explicitly)
            workspace1 = Workspace("csv_test1")
            workspace1.add_node(
                Node(
                    data=pl.scan_csv(temp_path),
                    name="csv_data",
                    workspace=workspace1,
                )
            )
            assert len(workspace1.nodes) == 1
            node1 = list(workspace1.nodes.values())[0]
            assert isinstance(node1.data, pl.LazyFrame)

            # Test eager loading converted to LazyFrame before add.
            workspace2 = Workspace("csv_test2")
            workspace2.add_node(
                Node(
                    data=pl.read_csv(temp_path).lazy(),
                    name="csv_data",
                    workspace=workspace2,
                )
            )
            assert len(workspace2.nodes) == 1
            node2 = list(workspace2.nodes.values())[0]
            assert isinstance(node2.data, pl.LazyFrame)
        finally:
            Path(temp_path).unlink()

    def test_node_workspace_transfer(self):
        """Test moving nodes between workspaces."""
        workspace1 = Workspace("ws1")
        workspace2 = Workspace("ws2")

        df = pl.DataFrame({"col": [1, 2, 3]})
        node = Node(df.lazy(), "test_node", workspace1)

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
        workspace.description = "meta"
        workspace.created_at = "2024-03-01T00:00:00Z"
        workspace.modified_at = "2024-03-02T00:00:00Z"

        assert workspace.description == "meta"
        assert workspace.created_at == "2024-03-01T00:00:00Z"
        assert workspace.modified_at == "2024-03-02T00:00:00Z"

        # info_json now focuses on structural node counts only
        summary = workspace.info_json()
        assert "metadata_keys" not in summary

    def test_workspace_boolean_and_len_operations(self):
        """Test workspace boolean evaluation and length operations."""
        workspace = Workspace("bool_test")

        # Empty workspace should still be truthy
        assert bool(workspace) is True
        assert len(workspace) == 0

        # Add a node
        df = pl.DataFrame({"col": [1]})
        workspace.add_node(Node(df.lazy(), "test"))

        assert bool(workspace) is True
        assert len(workspace) == 1

    def test_workspace_iteration(self):
        """Test workspace iteration over nodes."""
        workspace = Workspace("iter_test")

        df1 = pl.DataFrame({"col1": [1, 2]})
        df2 = pl.DataFrame({"col2": [3, 4]})

        node1 = workspace.add_node(Node(df1.lazy(), "node1"))
        node2 = workspace.add_node(Node(df2.lazy(), "node2"))

        # Test iteration
        nodes_from_iter = list(workspace)
        assert len(nodes_from_iter) == 2
        assert node1 in nodes_from_iter
        assert node2 in nodes_from_iter

    def test_remove_node_keeps_lazy_child(self):
        """Test node removal keeps remaining child node lazy."""
        workspace = Workspace("remove_test")

        # Create parent and child nodes
        df = pl.LazyFrame({"col": [1, 2, 3, 4, 5]})
        parent = workspace.add_node(Node(df.lazy(), "parent"))
        child = parent.filter(pl.col("col") > 2)

        assert isinstance(child.data, pl.LazyFrame)
        assert len(workspace.nodes) == 2

        removed = workspace.remove_node(parent.id)

        assert removed is True
        assert len(workspace.nodes) == 1
        # Child should still be lazy
        remaining_node = list(workspace.nodes.values())[0]
        assert isinstance(remaining_node.data, pl.LazyFrame)

    def test_remove_node_rewires_child_to_all_parents(self):
        """Deleting an intermediate node should preserve lineage via parent inheritance."""
        workspace = Workspace("rewire_test")

        df_left = pl.DataFrame({"id": [1, 2], "left": [10, 20]})
        df_right = pl.DataFrame({"id": [1, 2], "right": [30, 40]})

        node_b = workspace.add_node(Node(df_left.lazy(), "B"))
        node_c = workspace.add_node(Node(df_right.lazy(), "C"))

        node_a = node_b.join(node_c, on="id", how="inner")
        node_d = node_a.filter(pl.col("id") > 0)

        assert node_a in node_b.children
        assert node_a in node_c.children
        assert node_b in node_a.parents
        assert node_c in node_a.parents
        assert node_d in node_a.children
        assert node_a in node_d.parents

        assert workspace.remove_node(node_a.id) is True

        assert node_d in node_b.children
        assert node_d in node_c.children
        assert node_b in node_d.parents
        assert node_c in node_d.parents
        assert node_a not in node_d.parents
        assert node_a not in workspace.nodes.values()
