"""
Integration tests for analysis persistence.

Tests the end-to-end flow from API endpoints to file persistence.
"""

from datetime import datetime

import pytest
from httpx import AsyncClient
from ldaca_web_app_backend.core.analysis_store import list_analyses


# Helper functions
async def post_json(client: AsyncClient, path: str, payload: dict):
    """Helper to POST JSON data and return response."""
    return await client.post(path, json=payload)


async def get_json(client: AsyncClient, path: str):
    """Helper to GET JSON data and return response."""
    return await client.get(path)


def assert_analysis_record_structure(record_dict: dict, expected_task: str):
    """Assert that a record dict has the expected structure."""
    required_keys = {"task", "saved_at", "request", "result"}
    assert set(record_dict.keys()) == required_keys

    assert record_dict["task"] == expected_task
    assert isinstance(record_dict["saved_at"], str)
    assert isinstance(record_dict["request"], dict)
    assert isinstance(record_dict["result"], dict)

    # Validate ISO 8601 timestamp format
    datetime.fromisoformat(record_dict["saved_at"])


def assert_successful_result(result_dict: dict):
    """Assert that a result dict represents a successful analysis."""
    # Contract migrated: 'success': True -> 'state': 'successful'
    assert result_dict.get("state") == "successful"
    # message remains optional in some endpoints; only assert data presence
    assert "data" in result_dict


@pytest.mark.anyio
class TestTokenFrequencyPersistence:
    """Test token frequency analysis persistence."""

    async def test_token_frequency_creates_analysis_record(
        self, authenticated_client, workspace_id, tiny_node_id, test_user
    ):
        """Test that token frequency analysis creates a proper analysis record."""
        # Given: A workspace with a text node
        request_payload = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
            "limit": 10,
        }

        # When: We call the token frequencies endpoint
        response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            request_payload,
        )

        # Then: The response is successful
        assert response.status_code == 200
        result_data = response.json()
        assert_successful_result(result_data)

        # And: An analysis record was persisted
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1

        record = analyses[0]
        assert record.task == "token_frequencies"
        # Check that the core request parameters are preserved
        assert record.request["node_ids"] == request_payload["node_ids"]
        assert record.request["node_columns"] == request_payload["node_columns"]
        assert record.request["limit"] == request_payload["limit"]
        assert_successful_result(record.result)

        # Validate timestamp
        saved_time = datetime.fromisoformat(record.saved_at)
        assert isinstance(saved_time, datetime)

        # Validate result structure
        assert "data" in record.result
        assert isinstance(record.result["data"], dict)

    async def test_token_frequency_overwrites_previous_analysis(
        self, authenticated_client, workspace_id, tiny_node_id, test_user
    ):
        """Test that repeated analysis overwrites previous results."""
        # Given: We run token frequency analysis twice with different limits
        first_request = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
            "limit": 5,
        }

        second_request = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
            "limit": 15,
        }

        # When: We call the endpoint twice
        await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            first_request,
        )

        response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            second_request,
        )

        # Then: Only one analysis record exists (the latest)
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1

        record = analyses[0]
        assert record.request == second_request  # Latest request
        assert record.request != first_request  # Not the first request

    async def test_token_frequency_with_invalid_node_fails(
        self, authenticated_client, workspace_id
    ):
        """Test that token frequency with invalid node ID fails gracefully."""
        # Given: A request with non-existent node ID
        request_payload = {
            "node_ids": ["nonexistent_node"],
            "node_columns": {"nonexistent_node": "document"},
            "limit": 10,
        }

        # When: We call the token frequencies endpoint
        response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            request_payload,
        )

        # Then: The response indicates failure
        assert response.status_code == 404

    async def test_token_frequency_multiple_nodes(
        self,
        authenticated_client,
        workspace_id,
        sample_node_id,
        tiny_node_id,
        test_user,
    ):
        """Test token frequency analysis with multiple nodes."""
        # Given: A request with multiple nodes
        request_payload = {
            "node_ids": [sample_node_id, tiny_node_id],
            "node_columns": {sample_node_id: "document", tiny_node_id: "document"},
            "limit": 20,
        }

        # When: We call the token frequencies endpoint
        response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            request_payload,
        )

        # Then: The response is successful
        assert response.status_code == 200
        result_data = response.json()
        assert_successful_result(result_data)

        # And: The analysis record contains both nodes
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1

        record = analyses[0]
        assert set(record.request["node_ids"]) == {sample_node_id, tiny_node_id}


@pytest.mark.anyio
class TestWorkspaceGraphEnrichment:
    """Test workspace graph enrichment with analysis data."""

    async def test_graph_includes_latest_analysis_empty(
        self, authenticated_client, workspace_id
    ):
        """Test that workspace graph includes empty latest_analysis when no analyses exist."""
        # Given: A workspace with no analyses

        # When: We get the workspace graph
        response = await get_json(
            authenticated_client, f"/api/workspaces/{workspace_id}/graph"
        )

        # Then: The response includes latest_analysis as empty dict
        assert response.status_code == 200
        graph_data = response.json()
        assert "latest_analysis" in graph_data
        assert graph_data["latest_analysis"] == {}

    async def test_graph_includes_latest_analysis_populated(
        self, authenticated_client, workspace_id, tiny_node_id, test_user
    ):
        """Test that workspace graph includes analysis data after running analysis."""
        # Given: We run a token frequency analysis
        request_payload = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
            "limit": 10,
        }

        await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            request_payload,
        )

        # When: We get the workspace graph
        response = await get_json(
            authenticated_client, f"/api/workspaces/{workspace_id}/graph"
        )

        # Then: The response includes the analysis in latest_analysis
        assert response.status_code == 200
        graph_data = response.json()
        assert "latest_analysis" in graph_data

        latest_analysis = graph_data["latest_analysis"]
        assert "token_frequencies" in latest_analysis

        token_freq_data = latest_analysis["token_frequencies"]
        assert "saved_at" in token_freq_data
        assert "request" in token_freq_data
        assert "result" in token_freq_data

        # Validate structure matches our persistence format
        assert_analysis_record_structure(token_freq_data, "token_frequencies")
        assert_successful_result(token_freq_data["result"])

    async def test_graph_includes_multiple_analyses(
        self, authenticated_client, workspace_id, sample_node_id, test_user
    ):
        """Test that workspace graph includes multiple analysis types."""
        # Given: We run token frequency analysis
        tf_request = {
            "node_ids": [sample_node_id],
            "node_columns": {sample_node_id: "document"},
            "limit": 10,
        }

        await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            tf_request,
        )

        # Note: We would add other analysis types here when available
        # For now, just verify the structure supports multiple analyses

        # When: We get the workspace graph
        response = await get_json(
            authenticated_client, f"/api/workspaces/{workspace_id}/graph"
        )

        # Then: The latest_analysis structure can hold multiple analysis types
        assert response.status_code == 200
        graph_data = response.json()
        latest_analysis = graph_data["latest_analysis"]

        assert isinstance(latest_analysis, dict)
        assert "token_frequencies" in latest_analysis

        # Structure should support adding more analysis types
        # like latest_analysis["topic_modeling"], etc.


@pytest.mark.anyio
class TestAnalysisPersistenceEdgeCases:
    """Test edge cases and error conditions."""

    async def test_persistence_survives_analysis_errors(
        self, authenticated_client, workspace_id, test_user
    ):
        """Test that failed analyses don't corrupt the persistence system."""
        # Given: A request that will fail (invalid node)
        invalid_request = {
            "node_ids": ["invalid_node"],
            "node_columns": {"invalid_node": "document"},
            "limit": 10,
        }

        # When: We call the endpoint with invalid data
        await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            invalid_request,
        )

        # And: No analysis records were created
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 0

    async def test_multiple_workspaces_isolated(
        self, authenticated_client, test_user, tiny_text_file
    ):
        """Test that analyses in different workspaces are isolated."""
        # Given: Two different workspaces
        ws1_response = await post_json(
            authenticated_client, "/api/workspaces/", {"name": "workspace_1"}
        )
        ws1_id = ws1_response.json()["workspace_id"]

        ws2_response = await post_json(
            authenticated_client, "/api/workspaces/", {"name": "workspace_2"}
        )
        ws2_id = ws2_response.json()["workspace_id"]

        # Add nodes to both workspaces
        node1_response = await authenticated_client.post(
            f"/api/workspaces/{ws1_id}/nodes", params={"filename": tiny_text_file.name}
        )
        node1_id = node1_response.json()["id"]  # Changed from node_id to id

        node2_response = await authenticated_client.post(
            f"/api/workspaces/{ws2_id}/nodes", params={"filename": tiny_text_file.name}
        )
        node2_id = node2_response.json()["id"]  # Changed from node_id to id

        # When: We run analyses in both workspaces
        await post_json(
            authenticated_client,
            f"/api/workspaces/{ws1_id}/token-frequencies",
            {
                "node_ids": [node1_id],
                "node_columns": {node1_id: "document"},
                "limit": 5,
            },
        )

        await post_json(
            authenticated_client,
            f"/api/workspaces/{ws2_id}/token-frequencies",
            {
                "node_ids": [node2_id],
                "node_columns": {node2_id: "document"},
                "limit": 15,
            },
        )

        # Then: Each workspace has its own isolated analyses
        ws1_analyses = list_analyses(test_user["id"], ws1_id)
        ws2_analyses = list_analyses(test_user["id"], ws2_id)

        assert len(ws1_analyses) == 1
        assert len(ws2_analyses) == 1

        # And: The analyses contain different request data
        assert ws1_analyses[0].request["limit"] == 5
        assert ws2_analyses[0].request["limit"] == 15


@pytest.mark.slow
@pytest.mark.anyio
class TestAnalysisPersistencePerformance:
    """Performance and stress tests for analysis persistence."""

    async def test_many_sequential_analyses(
        self, authenticated_client, workspace_id, tiny_node_id, test_user
    ):
        """Test that many sequential analyses don't cause performance issues."""
        # Given: We run many analyses with different limits
        limits = [5, 10, 15, 20, 25]

        for limit in limits:
            # When: We run analysis with different limit each time
            request_payload = {
                "node_ids": [tiny_node_id],
                "node_columns": {tiny_node_id: "document"},
                "limit": limit,
            }

            response = await post_json(
                authenticated_client,
                f"/api/workspaces/{workspace_id}/token-frequencies",
                request_payload,
            )

            # Then: Each analysis succeeds
            assert response.status_code == 200

        # And: Only the latest analysis is persisted (overwrites previous)
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1
        assert analyses[0].request["limit"] == 25  # Last limit used
