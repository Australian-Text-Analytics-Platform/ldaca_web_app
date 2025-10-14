"""
Integration tests for analysis persistence.

Tests the end-to-end flow from API endpoints to file persistence.
"""

from datetime import datetime

import pytest
from httpx import AsyncClient
from ldaca_web_app_backend.api.workspaces.analyses.token_frequencies import (
    DEFAULT_TOKEN_LIMIT,
    MAX_SERVER_TOKEN_LIMIT,
    SERVER_LIMIT_MULTIPLIER,
)
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
        expected_limit = DEFAULT_TOKEN_LIMIT
        assert "limit" not in record.request
        assert record.request["token_limit"] == expected_limit
        assert record.request.get("stop_words") == []
        assert_successful_result(record.result)
        assert record.result.get("token_limit") == expected_limit
        assert record.result.get("stop_words") == []
        assert record.result.get("metadata", {}).get("stop_words") == []
        assert record.result.get("analysis_params", {}).get("stop_words") == []

        # Validate timestamp
        saved_time = datetime.fromisoformat(record.saved_at)
        assert isinstance(saved_time, datetime)

        # Validate result structure
        assert "data" in record.result
        assert isinstance(record.result["data"], dict)

    async def test_token_frequency_defaults_limit_when_missing(
        self, authenticated_client, workspace_id, tiny_node_id, test_user
    ):
        """Token frequency requests without a limit should fall back to the default."""
        request_payload = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
        }

        response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            request_payload,
        )

        assert response.status_code == 200
        result_data = response.json()
        assert result_data.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert (
            result_data.get("analysis_params", {}).get("token_limit")
            == DEFAULT_TOKEN_LIMIT
        )
        assert result_data.get("stop_words") == []

        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        assert "limit" not in record.request
        assert record.request["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert record.request.get("stop_words") == []
        assert record.result.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert record.result.get("stop_words") == []
        assert record.result.get("metadata", {}).get("stop_words") == []
        assert record.result.get("analysis_params", {}).get("stop_words") == []

    async def test_token_frequency_overwrites_previous_analysis(
        self, authenticated_client, workspace_id, tiny_node_id, test_user
    ):
        """Test that repeated analysis overwrites previous results."""
        # Given: We run token frequency analysis twice with different limits
        first_request = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
        }

        second_request = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
            "stop_words": ["alpha", "beta"],
        }

        # When: We call the endpoint twice
        await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            first_request,
        )

        await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            second_request,
        )

        # Then: Only one analysis record exists (the latest)
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1

        record = analyses[0]
        assert record.request["node_ids"] == second_request["node_ids"]
        assert record.request["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert record.request.get("stop_words") == ["alpha", "beta"]
        assert "limit" not in record.request

    async def test_token_frequency_with_invalid_node_fails(
        self, authenticated_client, workspace_id
    ):
        """Test that token frequency with invalid node ID fails gracefully."""
        # Given: A request with non-existent node ID
        request_payload = {
            "node_ids": ["nonexistent_node"],
            "node_columns": {"nonexistent_node": "document"},
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
        assert result_data.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert result_data.get("stop_words") == []

        # And: The analysis record contains both nodes
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1

        record = analyses[0]
        assert set(record.request["node_ids"]) == {sample_node_id, tiny_node_id}
        assert record.request["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert record.request.get("stop_words") == []
        assert record.result.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert record.result.get("stop_words") == []
        assert record.result.get("metadata", {}).get("stop_words") == []
        assert record.result.get("analysis_params", {}).get("stop_words") == []

    async def test_current_result_update_persists_preferences(
        self, authenticated_client, workspace_id, tiny_node_id, test_user
    ):
        """Updating current-result should synchronize presentation preferences."""

        initial_request = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
            "stop_words": ["the", "and"],
        }

        initial_response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies",
            initial_request,
        )
        assert initial_response.status_code == 200

        update_payload = {"token_limit": 30, "stop_words": ["alpha", "beta"]}
        update_response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies/current-result",
            update_payload,
        )
        assert update_response.status_code == 200
        update_json = update_response.json()
        assert update_json == {"state": "successful", "message": "saved"}

        current_result_response = await get_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies/current-result",
        )
        assert current_result_response.status_code == 200
        updated_result = current_result_response.json()
        assert updated_result["token_limit"] == 30
        assert updated_result.get("stop_words") == ["alpha", "beta"]
        assert updated_result.get("metadata", {}).get("stop_words") == [
            "alpha",
            "beta",
        ]
        assert updated_result.get("analysis_params", {}).get("stop_words") == [
            "alpha",
            "beta",
        ]
        expected_server_limit = min(
            max(30 * SERVER_LIMIT_MULTIPLIER, DEFAULT_TOKEN_LIMIT),
            MAX_SERVER_TOKEN_LIMIT,
        )
        assert (
            updated_result.get("metadata", {}).get("server_limit")
            == expected_server_limit
        )

        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        assert record.request["token_limit"] == 30
        assert "limit" not in record.request
        assert record.request.get("stop_words") == ["alpha", "beta"]
        assert record.result.get("token_limit") == 30
        assert record.result.get("stop_words") == ["alpha", "beta"]
        assert record.result.get("metadata", {}).get("stop_words") == [
            "alpha",
            "beta",
        ]
        assert record.result.get("analysis_params", {}).get("stop_words") == [
            "alpha",
            "beta",
        ]

        clear_response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/token-frequencies/current-result",
            {"stop_words": []},
        )
        assert clear_response.status_code == 200

        clear_json = clear_response.json()
        assert clear_json == {"state": "successful", "message": "saved"}

        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        assert record.request["token_limit"] == 30  # limit unchanged
        assert record.request.get("stop_words") == []
        assert record.result.get("stop_words") == []
        assert record.result.get("metadata", {}).get("stop_words") == []
        assert record.result.get("analysis_params", {}).get("stop_words") == []
        current_result = (
            await get_json(
                authenticated_client,
                f"/api/workspaces/{workspace_id}/token-frequencies/current-result",
            )
        ).json()
        assert current_result.get("token_limit") == 30
        assert current_result.get("stop_words") == []


@pytest.mark.anyio
class TestFrequencyAnalysisPersistence:
    """Test frequency analysis persistence and presentation preferences."""

    async def _run_frequency_analysis(
        self,
        client: AsyncClient,
        workspace_id: str,
        node_id: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> dict:
        from types import SimpleNamespace

        from ldaca_web_app_backend.api.workspaces.analyses import (
            frequency_analysis as frequency_module,
        )

        request_payload = {
            "time_column": "published_at",
            "group_by_columns": ["category"],
            "frequency": "daily",
            "sort_by_time": True,
        }

        class DummyResult:
            def __init__(self) -> None:
                self._rows = [
                    {
                        "time_period": "2024-01-01",
                        "time_period_formatted": "2024-01-01",
                        "frequency_count": 2,
                        "category": "alpha",
                    },
                    {
                        "time_period": "2024-01-02",
                        "time_period_formatted": "2024-01-02",
                        "frequency_count": 1,
                        "category": "beta",
                    },
                ]
                self.columns = list(self._rows[0].keys()) if self._rows else []

            def to_dicts(self) -> list[dict[str, object]]:
                return list(self._rows)

            def __len__(self) -> int:
                return len(self._rows)

        class DummyTextOps:
            @staticmethod
            def frequency_analysis(*_args, **_kwargs) -> DummyResult:
                return DummyResult()

        dummy_node = SimpleNamespace(
            data=SimpleNamespace(
                columns=["published_at", "category"],
                schema=[
                    {"name": "published_at", "js_type": "datetime"},
                    {"name": "category", "js_type": "string"},
                ],
                text=DummyTextOps(),
            )
        )

        monkeypatch.setattr(
            frequency_module.workspace_manager,
            "get_node_from_workspace",
            lambda *_args, **_kwargs: dummy_node,
        )

        response = await post_json(
            client,
            f"/api/workspaces/{workspace_id}/nodes/{node_id}/frequency-analysis",
            request_payload,
        )

        assert response.status_code == 200
        result_data = response.json()
        assert_successful_result(result_data)
        return result_data

    async def test_frequency_analysis_includes_chart_type(
        self,
        authenticated_client,
        workspace_id,
        timeline_node_id,
        test_user,
        monkeypatch,
    ):
        """Frequency analysis responses should include a default chart type."""

        result_data = await self._run_frequency_analysis(
            authenticated_client, workspace_id, timeline_node_id, monkeypatch
        )

        assert result_data.get("chart_type") == "line"

        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        assert record.task == "frequency_analysis"
        assert record.result.get("chart_type") == "line"

        current_result_response = await get_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/frequency-analysis/current-result",
        )
        assert current_result_response.status_code == 200
        current_payload = current_result_response.json()
        assert current_payload["data"]["chart_type"] == "line"

    async def test_frequency_analysis_chart_type_update_persists(
        self,
        authenticated_client,
        workspace_id,
        timeline_node_id,
        test_user,
        monkeypatch,
    ):
        """Updating the chart type should persist via current-result endpoint."""

        await self._run_frequency_analysis(
            authenticated_client, workspace_id, timeline_node_id, monkeypatch
        )

        update_response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/frequency-analysis/current-result",
            {"chart_type": "bar"},
        )
        assert update_response.status_code == 200
        update_json = update_response.json()
        assert update_json == {
            "state": "successful",
            "message": "saved",
            "data": {"chart_type": "bar"},
        }

        current_result_response = await get_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/frequency-analysis/current-result",
        )
        assert current_result_response.status_code == 200
        current_payload = current_result_response.json()
        assert current_payload["data"]["chart_type"] == "bar"

        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        assert record.result.get("chart_type") == "bar"

    async def test_frequency_analysis_rejects_invalid_chart_type(
        self,
        authenticated_client,
        workspace_id,
        timeline_node_id,
        monkeypatch,
    ):
        """Invalid chart types should be rejected with clear feedback."""

        await self._run_frequency_analysis(
            authenticated_client, workspace_id, timeline_node_id, monkeypatch
        )

        invalid_response = await post_json(
            authenticated_client,
            f"/api/workspaces/{workspace_id}/frequency-analysis/current-result",
            {"chart_type": "scatter"},
        )
        assert invalid_response.status_code == 400
        error_payload = invalid_response.json()
        assert "Invalid chart type" in error_payload["detail"]


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
        ws1_payload = {
            "node_ids": [node1_id],
            "node_columns": {node1_id: "document"},
            "stop_words": ["alpha"],
        }

        ws2_payload = {
            "node_ids": [node2_id],
            "node_columns": {node2_id: "document"},
            "stop_words": ["beta"],
        }

        ws1_response_payload = await post_json(
            authenticated_client,
            f"/api/workspaces/{ws1_id}/token-frequencies",
            ws1_payload,
        )
        assert ws1_response_payload.status_code == 200
        ws1_result = ws1_response_payload.json()
        assert ws1_result.get("state") == "successful"

        ws2_response_payload = await post_json(
            authenticated_client,
            f"/api/workspaces/{ws2_id}/token-frequencies",
            ws2_payload,
        )
        assert ws2_response_payload.status_code == 200
        ws2_result = ws2_response_payload.json()
        assert ws2_result.get("state") == "successful"

        # Then: Each workspace has its own isolated analyses
        ws1_analyses = list_analyses(test_user["id"], ws1_id)
        ws2_analyses = list_analyses(test_user["id"], ws2_id)

        # Debug output if assertions fail
        if len(ws1_analyses) != 1 or len(ws2_analyses) != 1:
            print(f"\nDEBUG: ws1_analyses count: {len(ws1_analyses)}")
            print(f"DEBUG: ws2_analyses count: {len(ws2_analyses)}")
            print(f"DEBUG: ws1_id: {ws1_id}")
            print(f"DEBUG: ws2_id: {ws2_id}")
            print(f"DEBUG: test_user: {test_user}")
            from ldaca_web_app_backend.core.workspace import workspace_manager

            print(
                f"DEBUG: analysis_state keys: {list(workspace_manager._analysis_state.keys())}"
            )

        assert len(ws1_analyses) == 1
        assert len(ws2_analyses) == 1

        # And: The analyses contain different request data
        assert ws1_analyses[0].request["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert ws1_analyses[0].request.get("stop_words") == ["alpha"]
        assert ws2_analyses[0].request["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert ws2_analyses[0].request.get("stop_words") == ["beta"]


@pytest.mark.slow
@pytest.mark.anyio
class TestAnalysisPersistencePerformance:
    """Performance and stress tests for analysis persistence."""

    async def test_many_sequential_analyses(
        self, authenticated_client, workspace_id, tiny_node_id, test_user
    ):
        """Test that many sequential analyses don't cause performance issues."""
        # Given: We run many analyses with different stop word sets
        stop_sets = [
            [],
            ["alpha"],
            ["alpha", "beta"],
            ["gamma"],
            ["delta", "epsilon"],
        ]

        for stop_words in stop_sets:
            # When: We run analysis with different stop word configuration each time
            request_payload = {
                "node_ids": [tiny_node_id],
                "node_columns": {tiny_node_id: "document"},
                "stop_words": stop_words,
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
        assert analyses[0].request["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert analyses[0].request.get("stop_words") == ["delta", "epsilon"]
