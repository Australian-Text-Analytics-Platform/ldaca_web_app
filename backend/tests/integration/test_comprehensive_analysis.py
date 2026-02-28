"""
Parametrized and comprehensive tests for analysis persistence.
"""

from types import SimpleNamespace

import pytest
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.analysis.results import GenericAnalysisResult
from ldaca_web_app_backend.api.workspaces.analyses.token_frequencies import (
    DEFAULT_TOKEN_LIMIT,
    MAX_SERVER_TOKEN_LIMIT,
    SERVER_LIMIT_MULTIPLIER,
)
from ldaca_web_app_backend.core.worker import token_frequencies_task
from ldaca_web_app_backend.core.workspace import workspace_manager


def _simulate_token_frequency_completion(workspace_id: str):
    task_manager = get_task_manager("test")
    task_ids = task_manager.get_current_task_ids("token_frequencies")
    assert task_ids
    task = task_manager.get_task(task_ids[0])
    assert task is not None
    req = task.request.model_dump() if hasattr(task.request, "model_dump") else {}
    workspace = workspace_manager.get_current_workspace("test")
    assert workspace is not None

    node_ids = req.get("node_ids") or []
    node_columns = req.get("node_columns") or {}
    node_corpora: dict[str, list[str]] = {}
    node_display_names: dict[str, str] = {}
    for node_id in node_ids:
        node = workspace.nodes.get(node_id)
        assert node is not None
        node_data = getattr(node, "data", None)
        assert node_data is not None
        column_name = node_columns.get(node_id)
        assert column_name
        docs_df = node_data.select(column_name).collect()
        node_corpora[node_id] = [
            str(v) if v is not None else "" for v in docs_df[column_name].to_list()
        ]
        node_display_names[node_id] = str(getattr(node, "name", None) or node_id)

    artifacts_dir = workspace_manager.ensure_workspace_artifacts_dir(
        "test", workspace_id
    )
    assert artifacts_dir is not None
    worker_result = token_frequencies_task(
        user_id="test",
        workspace_id=workspace_id,
        node_corpora=node_corpora,
        node_display_names=node_display_names,
        stop_words=req.get("stop_words") or [],
        token_limit=req.get("token_limit") or DEFAULT_TOKEN_LIMIT,
        artifact_dir=str(artifacts_dir),
        artifact_prefix=f"test_token_freq_{task.task_id}",
    )
    task.complete(GenericAnalysisResult(worker_result))
    task_manager.save_task(task)


def _list_analysis_records(user_id: str, workspace_id: str, task: str | None = None):
    task_manager = get_task_manager(user_id)
    tasks = [
        t
        for t in task_manager.get_all_tasks()
        if getattr(t, "workspace_id", None) == workspace_id
    ]
    if task:
        task_ids = set(task_manager.get_current_task_ids(task))
        tasks = [t for t in tasks if t.task_id in task_ids]
    tasks.sort(key=lambda t: t.updated_at or t.created_at)

    def _to_record(t):
        req = t.request.model_dump() if hasattr(t.request, "model_dump") else t.request
        res = t.result.to_json() if hasattr(t.result, "to_json") else t.result
        return SimpleNamespace(
            task=task,
            task_id=t.task_id,
            saved_at=(t.updated_at or t.created_at).isoformat(),
            request=req,
            result=res,
        )

    return [_to_record(t) for t in tasks]


@pytest.fixture(autouse=True)
def _stub_task_manager(monkeypatch):
    class ImmediateTaskManager:
        async def any_running(self, **_kwargs):  # pragma: no cover
            return False

        async def latest_by_type(self, *args, **_kwargs):  # pragma: no cover
            return None

        async def submit_task(self, **_kwargs):  # pragma: no cover
            return SimpleNamespace(id="test-task")

    def fake_get_task_manager(self, _user_id):
        return ImmediateTaskManager()

    monkeypatch.setattr(
        workspace_manager.__class__, "get_task_manager", fake_get_task_manager
    )


@pytest.fixture(autouse=True)
def _reset_analysis_task_manager_state():
    task_manager = get_task_manager("test")
    task_manager.clear_all()
    yield
    task_manager.clear_all()


async def _get_current_task_id(client, workspace_id: str, analysis: str):
    slug = analysis.replace("_", "-")
    response = await client.get(f"/api/workspaces/{slug}/tasks/current")
    if response.status_code != 200:
        return None
    payload = response.json()
    task_ids = payload.get("task_ids") or []
    return task_ids[0] if task_ids else None


# Analysis type configurations for parametrized testing
ANALYSIS_CONFIGS = [
    {
        "task": "token_frequencies",
        "endpoint": "token-frequencies",
        "request_template": {
            "node_ids": [],  # Will be filled by test
            "node_columns": {},  # Will be filled by test
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
            f"/api/workspaces/{analysis_config['endpoint']}",
            json=request_payload,
        )

        # Then: The response is successful
        assert response.status_code == 200
        result_data = response.json()

        # Verify expected result structure (state + data; message optional)
        for key in analysis_config["expected_result_keys"]:
            assert key in result_data

        if analysis_config["task"] == "token_frequencies":
            assert result_data.get("state") == "running"
            assert result_data.get("metadata", {}).get("task_id")
            _simulate_token_frequency_completion(workspace_id)
            task_id = await _get_current_task_id(
                authenticated_client, workspace_id, "token_frequencies"
            )
            assert task_id
            final = (
                await authenticated_client.get(
                    f"/api/workspaces/token-frequencies/tasks/{task_id}/result"
                )
            ).json()
            assert final.get("state") == "successful"
            result_data = final
        else:
            assert result_data.get("state") == "successful"

        # And: An analysis record was persisted
        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1

        record = analyses[0]
        if analysis_config["task"] == "token_frequencies":
            assert record.task_id == task_id
        else:
            current_task_id = await _get_current_task_id(
                authenticated_client, workspace_id, analysis_config["endpoint"]
            )
            if current_task_id:
                assert record.task_id == current_task_id
            else:
                assert record.task_id
        if analysis_config["task"] == "token_frequencies":
            expected_limit = request_payload.get("token_limit", DEFAULT_TOKEN_LIMIT)
            expected_stop_words = [
                str(word).strip()
                for word in request_payload.get("stop_words", [])
                if str(word).strip()
            ]
            assert result_data.get("token_limit") == expected_limit
            assert (
                result_data.get("analysis_params", {}).get("token_limit")
                == expected_limit
            )
            assert result_data.get("stop_words") == expected_stop_words
            assert record.request["node_ids"] == request_payload["node_ids"]
            assert record.request["node_columns"] == request_payload["node_columns"]
            assert "limit" not in record.request
            assert record.request.get("token_limit") == expected_limit
            assert record.request.get("stop_words") == expected_stop_words
            # Result may be stored wrapped by the task manager; validate via endpoint payload (result_data)
            assert result_data.get("token_limit") == expected_limit
            assert result_data.get("stop_words") == expected_stop_words
            assert (
                result_data.get("metadata", {}).get("stop_words") == expected_stop_words
            )
            assert (
                result_data.get("analysis_params", {}).get("stop_words")
                == expected_stop_words
            )
        else:
            assert record.request == request_payload

        # Verify result structure matches response
        if analysis_config["task"] == "token_frequencies":
            # Stored result is task-manager wrapped; current-result endpoint is authoritative
            assert result_data.get("state") == "successful"
        else:
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
            ({"node_ids": ["nonexistent"]}, 400),  # Nonexistent node
            ({"token_limit": -1}, 400),  # Invalid limit
            ({"token_limit": "not_a_number"}, 422),  # Type error
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
        }
        base_request.update(invalid_param)

        # When: We call the endpoint
        response = await authenticated_client.post(
            "/api/workspaces/token-frequencies", json=base_request
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
        }

        # When: We call the endpoint with nonexistent workspace
        response = await authenticated_client.post(
            "/api/workspaces/nonexistent-workspace/token-frequencies",
            json=request_payload,
        )

        # Then: The response indicates not found
        assert response.status_code == 404

    @pytest.mark.parametrize("missing_field", ["node_ids"])
    async def test_missing_required_fields(
        self, authenticated_client, workspace_id, tiny_node_id, missing_field
    ):
        """Test that missing required fields are rejected."""
        # Given: A request missing a required field
        complete_request = {
            "node_ids": [tiny_node_id],
            "node_columns": {tiny_node_id: "document"},
        }
        incomplete_request = {
            k: v for k, v in complete_request.items() if k != missing_field
        }

        # When: We call the endpoint
        response = await authenticated_client.post(
            "/api/workspaces/token-frequencies", json=incomplete_request
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
        }

        # When: We call the endpoint
        response = await authenticated_client.post(
            "/api/workspaces/token-frequencies", json=request_payload
        )

        assert response.status_code == 200
        api_result = response.json()
        assert api_result.get("state") == "running"

        _simulate_token_frequency_completion(workspace_id)
        task_id = await _get_current_task_id(
            authenticated_client, workspace_id, "token_frequencies"
        )
        assert task_id
        final = (
            await authenticated_client.get(
                f"/api/workspaces/token-frequencies/tasks/{task_id}/result"
            )
        ).json()
        expected_limit = DEFAULT_TOKEN_LIMIT
        assert final.get("token_limit") == expected_limit
        assert final.get("analysis_params", {}).get("token_limit") == expected_limit

        # Then: The persisted request is present and includes default limit/stop_words
        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert analyses
        assert analyses[0].request.get("token_limit") == expected_limit
        assert "limit" not in analyses[0].request
        assert final.get("stop_words") == []
        assert final.get("metadata", {}).get("stop_words") == []

        # Check data structure integrity
        assert isinstance(final.get("data"), dict)
        for node_id, node_data in final["data"].items():
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
            "/api/workspaces/nodes", params={"filename": "unicode.csv"}
        )
        assert node_response.status_code == 200
        unicode_node_id = node_response.json()["id"]

        # When: We analyze the unicode content
        request_payload = {
            "node_ids": [unicode_node_id],
            "node_columns": {unicode_node_id: "document"},
        }

        response = await authenticated_client.post(
            "/api/workspaces/token-frequencies", json=request_payload
        )

        # Then: Task starts successfully
        assert response.status_code == 200
        assert response.json().get("state") == "running"

        _simulate_token_frequency_completion(workspace_id)
        task_id = await _get_current_task_id(
            authenticated_client, workspace_id, "token_frequencies"
        )
        assert task_id
        final = (
            await authenticated_client.get(
                f"/api/workspaces/token-frequencies/tasks/{task_id}/result"
            )
        ).json()
        assert final.get("state") == "successful"

        # Verify the analysis contains some tokens
        result_data = final.get("data") or {}
        all_tokens = [
            row.get("token")
            for node_data in result_data.values()
            for row in (node_data.get("data") or [])
            if isinstance(row, dict)
        ]
        assert len([t for t in all_tokens if isinstance(t, str) and t]) > 0

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
            "/api/workspaces/nodes", params={"filename": "large.csv"}
        )
        assert node_response.status_code == 200
        large_node_id = node_response.json()["id"]

        # When: We analyze with default limits to ensure persistence works on large inputs
        request_payload = {
            "node_ids": [large_node_id],
            "node_columns": {large_node_id: "document"},
        }

        response = await authenticated_client.post(
            "/api/workspaces/token-frequencies", json=request_payload
        )

        # Then: The analysis handles large data correctly
        assert response.status_code == 200

        _simulate_token_frequency_completion(workspace_id)
        task_id = await _get_current_task_id(
            authenticated_client, workspace_id, "token_frequencies"
        )
        assert task_id
        final = (
            await authenticated_client.get(
                f"/api/workspaces/token-frequencies/tasks/{task_id}/result"
            )
        ).json()
        assert final.get("state") == "successful"

        # And: Large results are present in the final payload
        result_data = final.get("data") or {}

        # Verify we got substantial results
        total_tokens = sum(len(node_data["data"]) for node_data in result_data.values())
        assert total_tokens >= DEFAULT_TOKEN_LIMIT

        metadata = final.get("metadata", {})
        expected_server_limit = min(
            DEFAULT_TOKEN_LIMIT * SERVER_LIMIT_MULTIPLIER,
            MAX_SERVER_TOKEN_LIMIT,
        )
        assert metadata.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert metadata.get("server_limit") == expected_server_limit
        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1
        assert analyses[0].request.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert "limit" not in analyses[0].request
