"""Tests for core library independence from API functionality.

This module tests that the core docworkspace library is properly separated
from API-specific functionality and can operate independently.
"""

import pytest

from docworkspace import Node, Workspace


class TestCoreLibraryIndependence:
    """Test that core library doesn't depend on API functionality."""

    def test_core_imports_only(self):
        """Test that core library only exports core functionality."""
        from docworkspace import __all__

        # Core library should only export Node and Workspace
        expected_exports = {"Node", "Workspace"}
        actual_exports = set(__all__)

        assert actual_exports == expected_exports, (
            f"Core library exports unexpected items: {actual_exports - expected_exports}"
        )

    def test_no_api_dependencies(self):
        """Test that core classes don't have API-specific methods."""
        df = pytest.importorskip("polars").DataFrame(
            {"id": [1, 2, 3], "text": ["a", "b", "c"]}
        )

        workspace = Workspace("test")
        node = workspace.add_node(Node(df, "test_node"))

        # These API methods should NOT exist in core library
        api_methods = [
            "to_api_summary",
            "get_paginated_data",
            "to_api_graph",
            "get_node_summaries",
            "safe_operation",
            "set_relationship",
        ]

        for method in api_methods:
            assert not hasattr(node, method), (
                f"Node should not have API method: {method}"
            )
            assert not hasattr(workspace, method), (
                f"Workspace should not have API method: {method}"
            )

    def test_core_functionality_works(self):
        """Test that core functionality works without API dependencies."""
        pl = pytest.importorskip("polars")

        # Test basic workspace and node creation
        workspace = Workspace("core_test")
        df = pl.DataFrame({"x": [1, 2, 3], "y": ["a", "b", "c"]})

        node = workspace.add_node(Node(df, "test_data"))

        # Test core functionality
        assert len(workspace.nodes) == 1
        assert node.name == "test_data"
        assert node.data.height == 3
        assert node.data.width == 2
        assert not node.is_lazy

        # Test node operations (polars delegation)
        filtered = node.filter(pl.col("x") > 1)
        assert isinstance(filtered, Node)
        assert filtered.data.height == 2

    def test_lazy_frame_support(self):
        """Test that lazy frame support works without API dependencies."""
        pl = pytest.importorskip("polars")

        workspace = Workspace("lazy_test")
        lazy_df = pl.LazyFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})

        lazy_node = workspace.add_node(Node(lazy_df, "lazy_data"))

        assert lazy_node.is_lazy
        assert len(workspace.nodes) == 1

        # Test lazy operations
        filtered_lazy = lazy_node.filter(pl.col("a") > 1)
        assert isinstance(filtered_lazy, Node)
        assert filtered_lazy.is_lazy
