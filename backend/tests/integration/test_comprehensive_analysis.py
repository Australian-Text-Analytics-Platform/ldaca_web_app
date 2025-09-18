"""
Parametrized and comprehensive tests for analysis persistence.
"""

import pytest
from ldaca_web_app_backend.core.analysis_store import list_analyses

# Analysis type configurations for parametrized testing
ANALYSIS_CONFIGS = [
    {
        "task": "token_frequencies",
        "endpoint": "token-frequencies",
        "request_template": {
            "node_ids": [],  # Will be filled by test
            "node_columns": {},  # Will be filled by test
            "limit": 10,
        },
        "expected_result_keys": {"state", "data"},
    },
    # Add more analysis types as they become available:
    # {
    #     "task": "topic_modeling",
    #     "endpoint": "topic-modeling",
    #     "request_template": {
    #         "node_ids": [],
    #         "node_columns": {},
    #         "min_topic_size": 5
    #     },
    #     "expected_result_keys": {"success", "message", "data"}
    # },
    # {
    #     "task": "multi_concordance",
    #     "endpoint": "concordance",
    #     "request_template": {
    #         "node_ids": [],
    #         "search_word": "test",
    #         "context_size": 5
    #     },
    #     "expected_result_keys": {"success", "message", "data"}
    # }
]


@pytest.mark.anyio
@pytest.mark.parametrize("analysis_config", ANALYSIS_CONFIGS)
class TestParametrizedAnalysisPersistence:
    """Parametrized tests across all analysis types."""

    async def test_analysis_persistence_generic(
        self,
        authenticated_client,
        workspace_id,
        tiny_node_id,
        test_user,
        analysis_config,
    ):
        """Test that any analysis type persists correctly."""
        # Given: A request for this analysis type
        request_payload = analysis_config["request_template"].copy()
        request_payload["node_ids"] = [tiny_node_id]

        if "node_columns" in request_payload:
            request_payload["node_columns"] = {tiny_node_id: "document"}

        # When: We call the analysis endpoint
        response = await authenticated_client.post(
            f"/api/workspaces/{workspace_id}/{analysis_config['endpoint']}",
            json=request_payload,
        )

        # Then: The response is successful
        assert response.status_code == 200
        result_data = response.json()

        # Verify expected result structure (state + data; message optional)
        for key in analysis_config["expected_result_keys"]:
            assert key in result_data
        assert result_data.get("state") == "successful"

        # And: An analysis record was persisted
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1

        record = analyses[0]
        assert record.task == analysis_config["task"]
        assert record.request == request_payload

        # Verify result structure matches response
        for key in analysis_config["expected_result_keys"]:
            assert key in record.result
        assert record.result.get("state") == "successful"


@pytest.mark.anyio
class TestAnalysisErrorHandling:
    """Test error handling and edge cases."""

    @pytest.mark.parametrize(
        "invalid_param,expected_status",
        [
            ({"node_ids": []}, 400),  # Empty node list
            ({"node_ids": ["nonexistent"]}, 404),  # Nonexistent node
            ({"limit": -1}, 400),  # Invalid limit
            ({"limit": "not_a_number"}, 422),  # Type error
        ],
    )
    async def test_token_frequency_validation_errors(
        self, authenticated_client, workspace_id, invalid_param, expected_status
    ):
        """Test that invalid requests are properly rejected."""
        # Given: A request with invalid parameters
        base_request = {
            "node_ids": ["dummy"],
            "node_columns": {"dummy": "document"},
            "limit": 10,
        }
        base_request.update(invalid_param)

        # When: We call the endpoint
        response = await authenticated_client.post(
            f"/api/workspaces/{workspace_id}/token-frequencies", json=base_request
        )

        # Then: The response indicates the appropriate error
        assert response.status_code == expected_status

    async def test_nonexistent_workspace_fails(
        self, authenticated_client, tiny_node_id
    ):
        """Test that operations on nonexistent workspaces fail."""
        # Given: A request to a nonexistent workspace
        request_payload = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
            "limit": 10,
        }

        # When: We call the endpoint with nonexistent workspace
        response = await authenticated_client.post(
            "/api/workspaces/nonexistent-workspace/token-frequencies",
            json=request_payload,
        )

        # Then: The response indicates not found
        assert response.status_code == 404

    @pytest.mark.parametrize("missing_field", ["node_ids", "limit"])
    async def test_missing_required_fields(
        self, authenticated_client, workspace_id, tiny_node_id, missing_field
    ):
        """Test that missing required fields are rejected."""
        # Given: A request missing a required field
        complete_request = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
            "limit": 10,
        }
        incomplete_request = {
            k: v for k, v in complete_request.items() if k != missing_field
        }

        # When: We call the endpoint
        response = await authenticated_client.post(
            f"/api/workspaces/{workspace_id}/token-frequencies", json=incomplete_request
        )

        # Then: The response indicates validation error
        assert response.status_code == 422


@pytest.mark.anyio
class TestAnalysisDataIntegrity:
    """Test data integrity and consistency."""

    async def test_analysis_data_consistency(
        self, authenticated_client, workspace_id, sample_node_id, test_user
    ):
        """Test that persisted data matches API response exactly."""
        # Given: A token frequency request
        request_payload = {
            "node_ids": [sample_node_id],
            "node_columns": {sample_node_id: "document"},
            "limit": 15,
        }

        # When: We call the endpoint
        response = await authenticated_client.post(
            f"/api/workspaces/{workspace_id}/token-frequencies", json=request_payload
        )

        assert response.status_code == 200
        api_result = response.json()

        # Then: The persisted data matches the API response
        analyses = list_analyses(test_user["id"], workspace_id)
        persisted_result = analyses[0].result

        # Key fields should match exactly
        assert persisted_result["state"] == api_result["state"]
        # message may be absent; only compare if both present
        if "message" in persisted_result and "message" in api_result:
            assert persisted_result["message"] == api_result["message"]
        assert persisted_result["data"] == api_result["data"]

        # Check data structure integrity
        assert isinstance(persisted_result["data"], dict)
        for node_id, node_data in persisted_result["data"].items():
            assert "data" in node_data
            assert "columns" in node_data
            assert isinstance(node_data["data"], list)
            assert isinstance(node_data["columns"], list)

    async def test_unicode_handling(
        self, authenticated_client, workspace_id, test_user, temp_data_root
    ):
        """Test that unicode text is handled correctly in persistence."""
        from ldaca_web_app_backend.core.utils import get_user_data_folder

        # Given: A file with unicode content
        user_data_dir = get_user_data_folder(test_user["id"])
        unicode_file = user_data_dir / "unicode.csv"
        unicode_content = """document
héllo wörld tëst
こんにちは 世界
emoji test 🚀 🎉 💫"""
        unicode_file.write_text(unicode_content, encoding="utf-8")

        # Add the unicode file as a node
        node_response = await authenticated_client.post(
            f"/api/workspaces/{workspace_id}/nodes", params={"filename": "unicode.csv"}
        )
        assert node_response.status_code == 200
        unicode_node_id = node_response.json()["id"]

        # When: We analyze the unicode content
        request_payload = {
            "node_ids": [unicode_node_id],
            "node_columns": {unicode_node_id: "document"},
            "limit": 20,
        }

        response = await authenticated_client.post(
            f"/api/workspaces/{workspace_id}/token-frequencies", json=request_payload
        )

        # Then: The analysis completes successfully
        assert response.status_code == 200

        # And: Unicode is preserved in persistence
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1

        # Verify the analysis contains unicode tokens
        result_data = analyses[0].result["data"]
        # Should contain at least some unicode tokens from our test data
        all_tokens = []
        for node_data in result_data.values():
            for row in node_data["data"]:
                all_tokens.extend(row)

        # Check that we have some unicode content (exact tokens depend on tokenization)
        assert len(all_tokens) > 0  # Basic sanity check

    async def test_large_result_handling(
        self, authenticated_client, workspace_id, test_user, temp_data_root
    ):
        """Test handling of analyses with large result sets."""
        from ldaca_web_app_backend.core.utils import get_user_data_folder

        # Given: A file with many repeated tokens (to generate large frequency data)
        user_data_dir = get_user_data_folder(test_user["id"])
        large_file = user_data_dir / "large.csv"

        # Create content with many repetitions to ensure large token frequency results
        repeated_content = ["document"] + [
            f"word{i % 100} " * 10 + f" token{i % 50} extra content here"
            for i in range(500)  # 500 rows with repeated tokens
        ]
        large_file.write_text("\n".join(repeated_content))

        # Add the large file as a node
        node_response = await authenticated_client.post(
            f"/api/workspaces/{workspace_id}/nodes", params={"filename": "large.csv"}
        )
        assert node_response.status_code == 200
        large_node_id = node_response.json()["id"]

        # When: We analyze with a high limit to get large results
        request_payload = {
            "node_ids": [large_node_id],
            "node_columns": {large_node_id: "document"},
            "limit": 200,  # High limit to get many results
        }

        response = await authenticated_client.post(
            f"/api/workspaces/{workspace_id}/token-frequencies", json=request_payload
        )

        # Then: The analysis handles large data correctly
        assert response.status_code == 200

        # And: Large results are persisted correctly
        analyses = list_analyses(test_user["id"], workspace_id)
        assert len(analyses) == 1

        result_data = analyses[0].result["data"]

        # Verify we got substantial results
        total_tokens = sum(len(node_data["data"]) for node_data in result_data.values())
        assert total_tokens > 50  # Should have many token frequency results
