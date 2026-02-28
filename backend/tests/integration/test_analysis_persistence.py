"""
Integration tests for analysis persistence.

Tests the end-to-end flow from API endpoints to file persistence.
"""

from datetime import datetime
from types import SimpleNamespace

import polars as pl
import pytest
from httpx import AsyncClient
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.analysis.results import GenericAnalysisResult
from ldaca_web_app_backend.api.workspaces.analyses.token_frequencies import (
    DEFAULT_TOKEN_LIMIT,
    MAX_SERVER_TOKEN_LIMIT,
    SERVER_LIMIT_MULTIPLIER,
)
from ldaca_web_app_backend.core.worker import token_frequencies_task
from ldaca_web_app_backend.core.workspace import workspace_manager


# Helper functions
async def post_json(client: AsyncClient, path: str, payload: dict):
    """Helper to POST JSON data and return response."""
    return await client.post(path, json=payload)


async def get_json(client: AsyncClient, path: str):
    """Helper to GET JSON data and return response."""
    return await client.get(path)


async def get_current_task_id(client: AsyncClient, workspace_id: str, analysis: str):
    """Fetch the current task id for a given analysis tab."""
    slug = analysis.replace("_", "-")
    response = await client.get(f"/api/workspaces/{slug}/tasks/current")
    if response.status_code != 200:
        return None
    payload = response.json()
    task_ids = payload.get("task_ids") or []
    return task_ids[0] if task_ids else None


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
    # Some analyses return a generic data envelope, while others expose
    # analysis-specific fields at top-level.
    assert "data" in result_dict or "analysis_params" in result_dict


def _simulate_token_frequency_completion(workspace_id: str):
    """Run token frequencies synchronously and persist the result via TaskManager."""

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
        artifact_dir=str(artifacts_dir),
        artifact_prefix=f"test_token_freq_{task.task_id}",
        token_limit=req.get("token_limit") or DEFAULT_TOKEN_LIMIT,
        stop_words=req.get("stop_words") or [],
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
    """Avoid spawning real worker processes in tests; mimic immediate task submission."""

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
            "/api/workspaces/token-frequencies",
            request_payload,
        )

        # Then: The response starts a background task
        assert response.status_code == 200
        result_data = response.json()
        assert result_data.get("state") == "running"
        task_id = result_data.get("metadata", {}).get("task_id")
        assert task_id

        # Simulate worker completion and fetch persisted result
        _simulate_token_frequency_completion(workspace_id)

        result_resp = await get_json(
            authenticated_client,
            f"/api/workspaces/token-frequencies/tasks/{task_id}/result",
        )
        assert result_resp.status_code == 200
        final_result = result_resp.json()
        assert_successful_result(final_result)

        # And: An analysis record was persisted
        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1

        record = analyses[0]
        assert record.task_id == task_id
        # Check that the core request parameters are preserved
        assert record.request["node_ids"] == request_payload["node_ids"]
        assert record.request["node_columns"] == request_payload["node_columns"]
        expected_limit = DEFAULT_TOKEN_LIMIT
        assert "limit" not in record.request
        assert record.request["token_limit"] == expected_limit
        assert record.request.get("stop_words") == []
        # Result is stored (may be wrapped by task manager); validate via endpoint contract
        assert final_result.get("token_limit") == expected_limit
        assert final_result.get("stop_words") == []
        assert final_result.get("metadata", {}).get("stop_words") == []
        assert final_result.get("analysis_params", {}).get("stop_words") == []

        # Validate timestamp
        saved_time = datetime.fromisoformat(record.saved_at)
        assert isinstance(saved_time, datetime)

        # Validate persisted artifact manifest structure
        assert "artifacts" in record.result
        assert isinstance(record.result["artifacts"], dict)
        assert isinstance(record.result["artifacts"].get("nodes"), list)

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
            "/api/workspaces/token-frequencies",
            request_payload,
        )

        assert response.status_code == 200
        result_data = response.json()
        assert result_data.get("state") == "running"

        _simulate_token_frequency_completion(workspace_id)
        task_id = await get_current_task_id(
            authenticated_client, workspace_id, "token_frequencies"
        )
        assert task_id
        result_resp = await get_json(
            authenticated_client,
            f"/api/workspaces/token-frequencies/tasks/{task_id}/result",
        )
        final_result = result_resp.json()
        assert final_result.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert (
            final_result.get("analysis_params", {}).get("token_limit")
            == DEFAULT_TOKEN_LIMIT
        )
        assert final_result.get("stop_words") == []

        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        assert "limit" not in record.request
        assert record.request["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert record.request.get("stop_words") == []
        assert final_result.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert final_result.get("stop_words") == []
        assert final_result.get("metadata", {}).get("stop_words") == []
        assert final_result.get("analysis_params", {}).get("stop_words") == []

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
        first_resp = await post_json(
            authenticated_client,
            "/api/workspaces/token-frequencies",
            first_request,
        )
        assert first_resp.status_code == 200

        second_resp = await post_json(
            authenticated_client,
            "/api/workspaces/token-frequencies",
            second_request,
        )
        assert second_resp.status_code == 200

        # Then: Only one analysis record exists (the latest)
        analyses = _list_analysis_records(test_user["id"], workspace_id)
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
            "/api/workspaces/token-frequencies",
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
            "/api/workspaces/token-frequencies",
            request_payload,
        )

        # Then: The response starts a background task
        assert response.status_code == 200
        result_data = response.json()
        assert result_data.get("state") == "running"
        assert result_data.get("metadata", {}).get("task_id")

        _simulate_token_frequency_completion(workspace_id)
        task_id = await get_current_task_id(
            authenticated_client, workspace_id, "token_frequencies"
        )
        assert task_id
        result_resp = await get_json(
            authenticated_client,
            f"/api/workspaces/token-frequencies/tasks/{task_id}/result",
        )
        final_result = result_resp.json()
        assert_successful_result(final_result)
        assert final_result.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert final_result.get("stop_words") == []

        # And: The analysis record contains both nodes
        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1

        record = analyses[0]
        assert set(record.request["node_ids"]) == {sample_node_id, tiny_node_id}
        assert record.request["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert record.request.get("stop_words") == []
        assert final_result.get("token_limit") == DEFAULT_TOKEN_LIMIT
        assert final_result.get("stop_words") == []
        assert final_result.get("metadata", {}).get("stop_words") == []
        assert final_result.get("analysis_params", {}).get("stop_words") == []

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
            "/api/workspaces/token-frequencies",
            initial_request,
        )
        assert initial_response.status_code == 200
        assert initial_response.json().get("state") == "running"
        task_id = await get_current_task_id(
            authenticated_client, workspace_id, "token_frequencies"
        )
        assert task_id

        update_payload = {"token_limit": 30, "stop_words": ["alpha", "beta"]}
        update_response = await post_json(
            authenticated_client,
            f"/api/workspaces/token-frequencies/tasks/{task_id}/result",
            update_payload,
        )
        assert update_response.status_code == 200
        update_json = update_response.json()
        assert update_json == {"state": "successful", "message": "saved"}

        _simulate_token_frequency_completion(workspace_id)

        current_result_response = await get_json(
            authenticated_client,
            f"/api/workspaces/token-frequencies/tasks/{task_id}/result",
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

        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        assert record.request["token_limit"] == 30
        assert "limit" not in record.request
        assert record.request.get("stop_words") == ["alpha", "beta"]
        assert "artifacts" in record.result

        clear_response = await post_json(
            authenticated_client,
            f"/api/workspaces/token-frequencies/tasks/{task_id}/result",
            {"stop_words": []},
        )
        assert clear_response.status_code == 200

        clear_json = clear_response.json()
        assert clear_json == {"state": "successful", "message": "saved"}

        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        assert record.request["token_limit"] == 30  # limit unchanged
        assert record.request.get("stop_words") == []
        current_result = (
            await get_json(
                authenticated_client,
                f"/api/workspaces/token-frequencies/tasks/{task_id}/result",
            )
        ).json()
        assert current_result.get("token_limit") == 30
        assert current_result.get("stop_words") == []


@pytest.mark.anyio
class TestSequentialAnalysisPersistence:
    """Test sequential analysis persistence and presentation preferences."""

    async def _run_sequential_analysis(
        self,
        client: AsyncClient,
        workspace_id: str,
        node_id: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> dict:
        from ldaca_web_app_backend.api.workspaces.analyses import (
            sequential_analysis as sequential_module,
        )

        request_payload = {
            "time_column": "published_at",
            "group_by_columns": ["category"],
            "frequency": "daily",
            "sort_by_time": True,
        }

        dummy_df = pl.DataFrame({
            "published_at": [
                datetime(2024, 1, 1),
                datetime(2024, 1, 1),
                datetime(2024, 1, 2),
            ],
            "category": ["alpha", "alpha", "beta"],
        })
        dummy_node = SimpleNamespace(data=dummy_df.lazy())
        dummy_workspace = SimpleNamespace(nodes={node_id: dummy_node})

        monkeypatch.setattr(
            sequential_module.workspace_manager,
            "get_current_workspace_id",
            lambda *_args, **_kwargs: workspace_id,
        )
        monkeypatch.setattr(
            sequential_module.workspace_manager,
            "get_current_workspace",
            lambda *_args, **_kwargs: dummy_workspace,
        )

        response = await post_json(
            client,
            f"/api/workspaces/nodes/{node_id}/sequential-analysis",
            request_payload,
        )

        assert response.status_code == 200
        result_data = response.json()
        assert_successful_result(result_data)
        return result_data

    async def test_sequential_analysis_includes_chart_type(
        self,
        authenticated_client,
        workspace_id,
        timeline_node_id,
        test_user,
        monkeypatch,
    ):
        """Sequential analysis responses should include a default chart type."""

        result_data = await self._run_sequential_analysis(
            authenticated_client, workspace_id, timeline_node_id, monkeypatch
        )

        assert result_data.get("chart_type") == "line"

        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        task_id = await get_current_task_id(
            authenticated_client, workspace_id, "sequential_analysis"
        )
        assert task_id
        assert record.task_id == task_id
        assert record.result.get("chart_type") == "line"

        current_result_response = await post_json(
            authenticated_client,
            f"/api/workspaces/sequential-analysis/tasks/{task_id}/result",
            {},
        )
        assert current_result_response.status_code == 200
        current_payload = current_result_response.json()
        assert current_payload["data"]["chart_type"] == "line"

    async def test_sequential_analysis_chart_type_update_persists(
        self,
        authenticated_client,
        workspace_id,
        timeline_node_id,
        test_user,
        monkeypatch,
    ):
        """Updating the chart type should persist via current-result endpoint."""

        await self._run_sequential_analysis(
            authenticated_client, workspace_id, timeline_node_id, monkeypatch
        )

        task_id = await get_current_task_id(
            authenticated_client, workspace_id, "sequential_analysis"
        )
        assert task_id
        update_response = await post_json(
            authenticated_client,
            f"/api/workspaces/sequential-analysis/tasks/{task_id}/result",
            {"chart_type": "bar"},
        )
        assert update_response.status_code == 200
        update_json = update_response.json()
        assert update_json == {
            "state": "successful",
            "message": "saved",
            "data": {"chart_type": "bar"},
        }

        current_result_response = await post_json(
            authenticated_client,
            f"/api/workspaces/sequential-analysis/tasks/{task_id}/result",
            {},
        )
        assert current_result_response.status_code == 200
        current_payload = current_result_response.json()
        assert current_payload["data"]["chart_type"] == "bar"

        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1
        record = analyses[0]
        assert record.result.get("chart_type") == "bar"

    async def test_sequential_analysis_rejects_invalid_chart_type(
        self,
        authenticated_client,
        workspace_id,
        timeline_node_id,
        monkeypatch,
    ):
        """Invalid chart types should be rejected with clear feedback."""

        await self._run_sequential_analysis(
            authenticated_client, workspace_id, timeline_node_id, monkeypatch
        )

        task_id = await get_current_task_id(
            authenticated_client, workspace_id, "sequential_analysis"
        )
        assert task_id
        invalid_response = await post_json(
            authenticated_client,
            f"/api/workspaces/sequential-analysis/tasks/{task_id}/result",
            {"chart_type": "scatter"},
        )
        assert invalid_response.status_code == 400
        error_payload = invalid_response.json()
        assert "Invalid chart type" in error_payload["detail"]

    async def test_sequential_analysis_numeric_params(
        self,
        authenticated_client,
        workspace_id,
        timeline_node_id,
        monkeypatch,
    ):
        """Numeric sequential analysis should persist origin/interval inputs."""
        captured_kwargs: dict[str, object] = {}

        dummy_df = pl.DataFrame({"score": [0, 5, 10, 15]})
        dummy_node = SimpleNamespace(data=dummy_df.lazy())
        dummy_workspace = SimpleNamespace(nodes={timeline_node_id: dummy_node})

        from ldaca_web_app_backend.api.workspaces.analyses import (
            sequential_analysis as sequential_module,
        )

        monkeypatch.setattr(
            sequential_module.workspace_manager,
            "get_current_workspace_id",
            lambda *_args, **_kwargs: workspace_id,
        )
        monkeypatch.setattr(
            sequential_module.workspace_manager,
            "get_current_workspace",
            lambda *_args, **_kwargs: dummy_workspace,
        )

        original_run = sequential_module._run_sequential_analysis

        def _capture_run(*_args, **kwargs):
            captured_kwargs.update(kwargs)
            return original_run(*_args, **kwargs)

        monkeypatch.setattr(sequential_module, "_run_sequential_analysis", _capture_run)

        payload = {
            "time_column": "score",
            "column_type": "numeric",
            "numeric_origin": 0,
            "numeric_interval": 5,
            "sort_by_time": True,
        }

        response = await post_json(
            authenticated_client,
            f"/api/workspaces/nodes/{timeline_node_id}/sequential-analysis",
            payload,
        )

        assert response.status_code == 200
        assert captured_kwargs.get("column_type") == "numeric"
        assert captured_kwargs.get("numeric_interval") == 5

    async def test_sequential_analysis_numeric_requires_interval(
        self,
        authenticated_client,
        workspace_id,
        timeline_node_id,
        monkeypatch,
    ):
        """Missing numeric interval inputs should raise a validation error."""

        dummy_df = pl.DataFrame({"score": [0, 5, 10]})
        dummy_node = SimpleNamespace(data=dummy_df.lazy())
        dummy_workspace = SimpleNamespace(nodes={timeline_node_id: dummy_node})

        from ldaca_web_app_backend.api.workspaces.analyses import (
            sequential_analysis as sequential_module,
        )

        monkeypatch.setattr(
            sequential_module.workspace_manager,
            "get_current_workspace_id",
            lambda *_args, **_kwargs: workspace_id,
        )
        monkeypatch.setattr(
            sequential_module.workspace_manager,
            "get_current_workspace",
            lambda *_args, **_kwargs: dummy_workspace,
        )

        payload = {
            "time_column": "score",
            "column_type": "numeric",
            "sort_by_time": True,
        }

        response = await post_json(
            authenticated_client,
            f"/api/workspaces/nodes/{timeline_node_id}/sequential-analysis",
            payload,
        )

        assert response.status_code == 422
        detail = response.json().get("detail", "")
        if isinstance(detail, list):
            detail_text = " ".join(str(item) for item in detail)
        else:
            detail_text = str(detail)
        assert "interval" in detail_text.lower()


@pytest.mark.anyio
class TestWorkspaceGraphEnrichment:
    """Test workspace graph enrichment with analysis data."""

    async def test_graph_includes_latest_analysis_empty(
        self, authenticated_client, workspace_id
    ):
        """Test that workspace graph includes empty latest_analysis when no analyses exist."""
        # Given: A workspace with no analyses

        # When: We get the workspace graph
        response = await get_json(authenticated_client, "/api/workspaces/graph")

        # Then: The response includes latest_analysis as empty dict
        assert response.status_code == 200
        graph_data = response.json()
        assert "edges" in graph_data and "nodes" in graph_data
        assert "workspace_info" not in graph_data
        # latest_analysis is no longer provided by the graph endpoint
        assert "latest_analysis" not in graph_data

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
            "/api/workspaces/token-frequencies",
            request_payload,
        )

        # Simulate worker completion so graph shows populated results.
        _simulate_token_frequency_completion(workspace_id)

        # When: We get the workspace graph
        response = await get_json(authenticated_client, "/api/workspaces/graph")

        # Then: The response includes the analysis in latest_analysis
        assert response.status_code == 200
        graph_data = response.json()
        assert "edges" in graph_data and "nodes" in graph_data
        assert "workspace_info" not in graph_data
        # Graph no longer surfaces latest_analysis; rely on TaskManager queries instead

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
            "/api/workspaces/token-frequencies",
            tf_request,
        )

        # Note: We would add other analysis types here when available
        # For now, just verify the structure supports multiple analyses

        # When: We get the workspace graph
        response = await get_json(authenticated_client, "/api/workspaces/graph")

        # Then: The latest_analysis structure can hold multiple analysis types
        assert response.status_code == 200
        graph_data = response.json()
        assert "edges" in graph_data and "nodes" in graph_data
        assert "workspace_info" not in graph_data


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
            "/api/workspaces/token-frequencies",
            invalid_request,
        )

        # And: No analysis records were created
        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 0

    async def test_multiple_workspaces_isolated(
        self, authenticated_client, test_user, tiny_text_file
    ):
        """Test that analyses in different workspaces are isolated."""
        # Given: Two different workspaces
        ws1_response = await post_json(
            authenticated_client, "/api/workspaces/", {"name": "workspace_1"}
        )
        ws1_id = ws1_response.json()["id"]

        ws2_response = await post_json(
            authenticated_client, "/api/workspaces/", {"name": "workspace_2"}
        )
        ws2_id = ws2_response.json()["id"]

        # Explicitly switch active workspace to ws1 before adding/running ws1 analysis
        switch_ws1 = await authenticated_client.post(
            "/api/workspaces/current", params={"workspace_id": ws1_id}
        )
        assert switch_ws1.status_code == 200

        # Add nodes to both workspaces
        node1_response = await authenticated_client.post(
            "/api/workspaces/nodes", params={"filename": tiny_text_file.name}
        )
        node1_id = node1_response.json()["id"]  # Changed from node_id to id

        # Switch active workspace to ws2 before adding/running ws2 analysis
        switch_ws2 = await authenticated_client.post(
            "/api/workspaces/current", params={"workspace_id": ws2_id}
        )
        assert switch_ws2.status_code == 200

        node2_response = await authenticated_client.post(
            "/api/workspaces/nodes", params={"filename": tiny_text_file.name}
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

        # Switch back to ws1 before submitting ws1 analysis
        switch_ws1_again = await authenticated_client.post(
            "/api/workspaces/current", params={"workspace_id": ws1_id}
        )
        assert switch_ws1_again.status_code == 200

        ws1_response_payload = await post_json(
            authenticated_client,
            "/api/workspaces/token-frequencies",
            ws1_payload,
        )
        assert ws1_response_payload.status_code == 200
        ws1_result = ws1_response_payload.json()
        assert ws1_result.get("state") == "running"
        assert ws1_result.get("metadata", {}).get("task_id")

        # Switch to ws2 before submitting ws2 analysis
        switch_ws2_again = await authenticated_client.post(
            "/api/workspaces/current", params={"workspace_id": ws2_id}
        )
        assert switch_ws2_again.status_code == 200

        ws2_response_payload = await post_json(
            authenticated_client,
            "/api/workspaces/token-frequencies",
            ws2_payload,
        )
        assert ws2_response_payload.status_code == 200
        ws2_result = ws2_response_payload.json()
        assert ws2_result.get("state") == "running"
        assert ws2_result.get("metadata", {}).get("task_id")

        # Then: Under single-active-workspace semantics, only the currently active
        # workspace analysis remains in the per-user in-memory task manager.
        ws1_analyses = _list_analysis_records(test_user["id"], ws1_id)
        ws2_analyses = _list_analysis_records(test_user["id"], ws2_id)

        # Debug output if assertions fail
        if len(ws1_analyses) != 0 or len(ws2_analyses) != 1:
            print(f"\nDEBUG: ws1_analyses count: {len(ws1_analyses)}")
            print(f"DEBUG: ws2_analyses count: {len(ws2_analyses)}")
            print(f"DEBUG: ws1_id: {ws1_id}")
            print(f"DEBUG: ws2_id: {ws2_id}")
            print(f"DEBUG: test_user: {test_user}")

        assert len(ws1_analyses) == 0
        assert len(ws2_analyses) == 1

        # And: The active workspace analysis carries the expected request data
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
                "/api/workspaces/token-frequencies",
                request_payload,
            )

            # Then: Each analysis succeeds
            assert response.status_code == 200

        # And: Only the latest analysis is persisted (overwrites previous)
        analyses = _list_analysis_records(test_user["id"], workspace_id)
        assert len(analyses) == 1
        assert analyses[0].request["token_limit"] == DEFAULT_TOKEN_LIMIT
        assert analyses[0].request.get("stop_words") == ["delta", "epsilon"]
