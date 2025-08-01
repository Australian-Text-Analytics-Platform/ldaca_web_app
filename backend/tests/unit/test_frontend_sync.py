"""
Tests for frontend-backend data synchronization logic.
Migrated from test_duplicate_fix.py with proper pytest structure.
"""

from typing import Any, Dict, List, Optional

import pytest


def simulate_flow_nodes_logic(
    state_nodes: List[Dict], workspace_graph: Optional[Dict[str, Any]] = None
) -> Dict:
    """
    Simulate the flowNodes useMemo logic from WorkspaceView.tsx
    This function helps prevent duplicate node display in the frontend.
    """
    # Check if we have graph nodes and if they match state node count
    has_graph_nodes = (
        workspace_graph is not None
        and workspace_graph.get("nodes") is not None
        and len(workspace_graph["nodes"]) > 0
    )
    graph_node_count = len(workspace_graph.get("nodes", [])) if workspace_graph else 0
    state_node_count = len(state_nodes)

    # Use graph data only if it matches the current node count (not stale)
    use_graph_data = has_graph_nodes and graph_node_count == state_node_count

    if use_graph_data:
        source_nodes = workspace_graph["nodes"]  # type: ignore
        source_type = "graph"
    else:
        # Convert state.nodes to ReactFlow format
        source_nodes = []
        for node in state_nodes:
            source_nodes.append(
                {
                    "id": node["node_id"],
                    "type": "default",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "label": node["name"],
                        "nodeId": node["node_id"],
                        "nodeName": node["name"],
                        "dataType": node["data_type"],
                        "isLazy": node.get("is_lazy", False),
                    },
                }
            )
        source_type = "nodes"

    return {
        "source_type": source_type,
        "use_graph_data": use_graph_data,
        "graph_node_count": graph_node_count,
        "state_node_count": state_node_count,
        "source_nodes": source_nodes,
        "node_count": len(source_nodes),
    }


class TestDuplicateNodePrevention:
    """Test duplicate node prevention logic"""

    @pytest.fixture
    def sample_state_nodes(self):
        """Sample state nodes for testing"""
        return [
            {
                "node_id": "node1",
                "name": "parent1",
                "data_type": "DataFrame",
                "is_lazy": False,
            },
            {
                "node_id": "node2",
                "name": "parent2",
                "data_type": "DataFrame",
                "is_lazy": False,
            },
        ]

    @pytest.fixture
    def sample_workspace_graph(self):
        """Sample workspace graph for testing"""
        return {
            "nodes": [
                {
                    "id": "node1",
                    "data": {
                        "nodeName": "parent1",
                        "dataType": "DataFrame",
                        "isLazy": False,
                    },
                },
                {
                    "id": "node2",
                    "data": {
                        "nodeName": "parent2",
                        "dataType": "DataFrame",
                        "isLazy": False,
                    },
                },
            ],
            "edges": [],
        }

    def test_initial_state_with_matching_counts(
        self, sample_state_nodes, sample_workspace_graph
    ):
        """Test scenario where state and graph node counts match"""
        result = simulate_flow_nodes_logic(sample_state_nodes, sample_workspace_graph)

        assert result["source_type"] == "graph"
        assert result["use_graph_data"] is True
        assert result["graph_node_count"] == 2
        assert result["state_node_count"] == 2
        assert result["node_count"] == 2

    def test_race_condition_stale_graph(
        self, sample_state_nodes, sample_workspace_graph
    ):
        """Test race condition where graph is stale (fewer nodes than state)"""
        # Add a third node to state (simulating join operation)
        state_nodes_3 = sample_state_nodes + [
            {
                "node_id": "node3",
                "name": "joined",
                "data_type": "DataFrame",
                "is_lazy": False,
            }
        ]

        # Graph still has only 2 nodes (stale)
        result = simulate_flow_nodes_logic(state_nodes_3, sample_workspace_graph)

        # Should fall back to state nodes to avoid showing stale data
        assert result["source_type"] == "nodes"
        assert result["use_graph_data"] is False
        assert result["graph_node_count"] == 2
        assert result["state_node_count"] == 3
        assert result["node_count"] == 3

    def test_null_graph_fallback(self, sample_state_nodes):
        """Test fallback behavior when graph is null/None"""
        result = simulate_flow_nodes_logic(sample_state_nodes, None)

        assert result["source_type"] == "nodes"
        assert result["use_graph_data"] is False
        assert result["graph_node_count"] == 0
        assert result["state_node_count"] == 2
        assert result["node_count"] == 2

    def test_empty_graph_fallback(self, sample_state_nodes):
        """Test fallback behavior when graph has no nodes"""
        empty_graph = {"nodes": [], "edges": []}
        result = simulate_flow_nodes_logic(sample_state_nodes, empty_graph)

        assert result["source_type"] == "nodes"
        assert result["use_graph_data"] is False
        assert result["graph_node_count"] == 0
        assert result["state_node_count"] == 2
        assert result["node_count"] == 2

    def test_updated_graph_with_matching_counts(self, sample_state_nodes):
        """Test scenario where graph is updated to match state count"""
        # State with 3 nodes
        state_nodes_3 = sample_state_nodes + [
            {
                "node_id": "node3",
                "name": "joined",
                "data_type": "DataFrame",
                "is_lazy": False,
            }
        ]

        # Updated graph with 3 nodes and edges
        updated_graph = {
            "nodes": [
                {
                    "id": "node1",
                    "data": {
                        "nodeName": "parent1",
                        "dataType": "DataFrame",
                        "isLazy": False,
                    },
                },
                {
                    "id": "node2",
                    "data": {
                        "nodeName": "parent2",
                        "dataType": "DataFrame",
                        "isLazy": False,
                    },
                },
                {
                    "id": "node3",
                    "data": {
                        "nodeName": "joined",
                        "dataType": "DataFrame",
                        "isLazy": False,
                    },
                },
            ],
            "edges": [
                {"id": "edge1", "source": "node1", "target": "node3"},
                {"id": "edge2", "source": "node2", "target": "node3"},
            ],
        }

        result = simulate_flow_nodes_logic(state_nodes_3, updated_graph)

        # Should use graph data for positioning and edges
        assert result["source_type"] == "graph"
        assert result["use_graph_data"] is True
        assert result["graph_node_count"] == 3
        assert result["state_node_count"] == 3
        assert result["node_count"] == 3

    def test_react_flow_node_conversion(self, sample_state_nodes):
        """Test that state nodes are properly converted to ReactFlow format"""
        result = simulate_flow_nodes_logic(sample_state_nodes, None)

        assert result["source_type"] == "nodes"
        assert len(result["source_nodes"]) == 2

        # Check ReactFlow node structure
        for i, node in enumerate(result["source_nodes"]):
            expected_node_id = f"node{i + 1}"
            expected_name = f"parent{i + 1}"

            assert node["id"] == expected_node_id
            assert node["type"] == "default"
            assert "position" in node
            assert node["position"] == {"x": 0, "y": 0}

            # Check data structure
            node_data = node["data"]
            assert node_data["label"] == expected_name
            assert node_data["nodeId"] == expected_node_id
            assert node_data["nodeName"] == expected_name
            assert node_data["dataType"] == "DataFrame"
            assert node_data["isLazy"] is False
