import asyncio
import time
from types import SimpleNamespace

import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces.analyses.concordance import (
    DEFAULT_CONCORDANCE_PAGE_SIZE,
)
from ldaca_web_app_backend.core import analysis_store
from ldaca_web_app_backend.core.worker import concordance_task
from ldaca_web_app_backend.core.workspace import workspace_manager

try:
    from docframe import DocDataFrame  # type: ignore
except Exception:  # pragma: no cover
    DocDataFrame = None  # type: ignore


async def _wait_for_concordance_result(
    client,
    workspace_id: str,
    *,
    timeout: float = 20.0,
    poll_interval: float = 0.25,
):
    """Poll the current-result endpoint until concordance data is available."""

    deadline = time.monotonic() + timeout
    last_payload = None

    while time.monotonic() < deadline:
        resp = await client.get(
            f"/api/workspaces/{workspace_id}/concordance/current-result"
        )
        if resp.status_code != 200:
            await asyncio.sleep(poll_interval)
            continue

        payload = resp.json()
        if payload and payload.get("state") == "successful" and payload.get("data"):
            return payload

        last_payload = payload
        await asyncio.sleep(poll_interval)

    raise AssertionError(
        f"Concordance result not available after {timeout}s (last payload={last_payload})"
    )


def _simulate_concordance_completion(workspace_id: str, request_payload: dict):
    """Run concordance synchronously and persist the result like the worker would."""

    worker_result = concordance_task(
        user_id="test",
        workspace_id=workspace_id,
        node_ids=request_payload["node_ids"],
        node_columns=request_payload["node_columns"],
        search_word=request_payload.get("search_word", ""),
        num_left_tokens=request_payload.get("num_left_tokens", 5),
        num_right_tokens=request_payload.get("num_right_tokens", 5),
        regex=request_payload.get("regex", False),
        case_sensitive=request_payload.get("case_sensitive", False),
    )

    record = analysis_store.get_latest_analysis(
        "test", workspace_id, task="concordance"
    )
    assert record is not None

    analysis_store.save_analysis(
        user_id="test",
        workspace_id=workspace_id,
        task="concordance",
        request_dict=record.request,
        result_dict={
            "status": "successful",
            "message": "Concordance analysis complete",
            "data": worker_result,
        },
    )


@pytest.fixture(autouse=True)
def _stub_task_manager(monkeypatch):
    class ImmediateTaskManager:
        async def any_running(self, **_kwargs):  # pragma: no cover - trivial
            return False

        async def latest_by_type(self, *args, **_kwargs):  # pragma: no cover
            return None

        async def submit_task(self, **_kwargs):  # pragma: no cover
            return SimpleNamespace(id="test-task")

    def fake_get_task_manager(self, _user_id, _workspace_id):
        return ImmediateTaskManager()

    monkeypatch.setattr(
        workspace_manager.__class__, "get_task_manager", fake_get_task_manager
    )


@pytest.mark.anyio
@pytest.mark.skipif(DocDataFrame is None, reason="docframe not available")
async def test_concordance_single_node_roundtrip(authenticated_client, workspace_id):
    """Single-node concordance should store results and expose current-request/result endpoints."""
    # Ensure clean state for this workspace/user
    analysis_store.clear_analyses("test", workspace_id, task="concordance")
    analysis_store.clear_analyses("test", workspace_id, task="multi_concordance")

    df = pl.DataFrame({
        "text": [
            "alpha beta alpha",
            "beta gamma",
            "Alpha beta",  # Mixed case to test case sensitivity flag
        ],
        "speaker": ["A", "B", "C"],
    })
    doc_df = DocDataFrame(df, document_column="text")  # type: ignore

    node = workspace_manager.add_node_to_workspace(
        user_id="test",
        workspace_id=workspace_id,
        data=doc_df,
        node_name="single_text_node",
        operation="test_setup",
        parents=[],
    )
    assert node is not None

    request_payload = {
        "node_ids": [node.id],
        "node_columns": {node.id: "text"},
        "search_word": "alpha",
        "num_left_tokens": 2,
        "num_right_tokens": 2,
        "regex": False,
        "case_sensitive": False,
        "combined": False,
        "sort_by": "document_idx",
    }

    resp = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "running"
    assert payload.get("metadata", {}).get("task_id")

    _simulate_concordance_completion(workspace_id, request_payload)

    result_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id
    )
    assert result_payload["state"] == "successful"
    assert result_payload.get("combinable") is False
    assert node.id in result_payload["data"]
    node_result = result_payload["data"][node.id]
    assert node_result["total_matches"] >= 2
    assert node_result["metadata"]["concordance_columns"]
    assert node_result["metadata"]["metadata_columns"]
    assert len(node_result["data"]) <= DEFAULT_CONCORDANCE_PAGE_SIZE
    assert node_result["pagination"]["page_size"] == DEFAULT_CONCORDANCE_PAGE_SIZE
    assert result_payload["analysis_params"]["node_ids"] == [node.id]
    assert (
        result_payload["analysis_params"].get(
            "page_size", DEFAULT_CONCORDANCE_PAGE_SIZE
        )
        == DEFAULT_CONCORDANCE_PAGE_SIZE
    )
    assert result_payload["analysis_params"].get("sort_order", "asc") == "asc"

    # Current request should surface the persisted request
    current_req = await authenticated_client.get(
        f"/api/workspaces/{workspace_id}/concordance/current-request"
    )
    assert current_req.status_code == 200
    current_req_payload = current_req.json()
    assert current_req_payload["data"]["node_ids"] == [node.id]
    assert current_req_payload["data"]["node_columns"][node.id] == "text"
    assert "page" not in current_req_payload["data"]
    assert "page_size" not in current_req_payload["data"]
    assert "sort_by" not in current_req_payload["data"]
    assert "sort_order" not in current_req_payload["data"]
    assert "pagination" not in current_req_payload["data"]

    record = analysis_store.get_latest_analysis(
        "test", workspace_id, task="concordance"
    )
    assert record is not None
    assert "page" not in record.request
    assert "page_size" not in record.request
    assert "pagination" not in record.request
    stored_data = (
        record.result.get("data", {}) if isinstance(record.result, dict) else {}
    )
    assert "node_results" in stored_data

    # Request a smaller page size via POST (non-persistent override)
    current_res_post = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"node_id": node.id, "page_size": 1},
    )
    assert current_res_post.status_code == 200
    tailored = current_res_post.json()
    assert tailored["state"] == "successful"
    assert node.id in tailored["data"]
    node_fetch = tailored["data"][node.id]
    assert node_fetch["pagination"]["page_size"] == 1
    assert len(node_fetch["data"]) <= 1
    assert tailored["analysis_params"].get("page_size") == 1

    # Request the second page explicitly using node_id and page_number alias
    page_two = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"node_id": node.id, "page_number": 2, "page_size": 1},
    )
    assert page_two.status_code == 200
    page_two_payload = page_two.json()
    assert page_two_payload["state"] == "successful"
    assert page_two_payload["data"][node.id]["pagination"]["page"] == 2
    assert (
        page_two_payload["data"][node.id]["total_matches"]
        == node_result["total_matches"]
    )

    # GET again should return default pagination (no persisted overrides)
    refreshed_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id
    )
    assert (
        refreshed_payload["data"][node.id]["pagination"]["page_size"]
        == DEFAULT_CONCORDANCE_PAGE_SIZE
    )


@pytest.mark.anyio
@pytest.mark.skipif(DocDataFrame is None, reason="docframe not available")
async def test_concordance_multi_node_combined(authenticated_client, workspace_id):
    """Two-node concordance returns per-node results via async workflow."""
    analysis_store.clear_analyses("test", workspace_id, task="concordance")
    analysis_store.clear_analyses("test", workspace_id, task="multi_concordance")

    df_left = pl.DataFrame({
        "text": ["alpha beta", "beta alpha", "gamma alpha"],
        "speaker": ["L1", "L2", "L3"],
    })
    df_right = pl.DataFrame({
        "text": ["alpha delta", "epsilon alpha", "alpha"],
        "speaker": ["R1", "R2", "R3"],
    })

    left_node = workspace_manager.add_node_to_workspace(
        user_id="test",
        workspace_id=workspace_id,
        data=DocDataFrame(df_left, document_column="text"),  # type: ignore
        node_name="left_docs",
        operation="test_setup",
        parents=[],
    )
    right_node = workspace_manager.add_node_to_workspace(
        user_id="test",
        workspace_id=workspace_id,
        data=DocDataFrame(df_right, document_column="text"),  # type: ignore
        node_name="right_docs",
        operation="test_setup",
        parents=[],
    )

    request_payload = {
        "node_ids": [left_node.id, right_node.id],
        "node_columns": {left_node.id: "text", right_node.id: "text"},
        "search_word": "alpha",
        "num_left_tokens": 2,
        "num_right_tokens": 2,
        "regex": False,
        "case_sensitive": False,
        "combined": True,
    }

    resp = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "running"

    _simulate_concordance_completion(workspace_id, request_payload)

    result_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id
    )
    assert result_payload["state"] == "successful"
    assert result_payload.get("combinable") is False
    assert left_node.id in result_payload["data"]
    assert right_node.id in result_payload["data"]

    left_result = result_payload["data"][left_node.id]
    right_result = result_payload["data"][right_node.id]
    assert left_result["pagination"]["page_size"] == DEFAULT_CONCORDANCE_PAGE_SIZE
    assert right_result["pagination"]["page_size"] == DEFAULT_CONCORDANCE_PAGE_SIZE

    # Request both nodes with a smaller page size override
    narrowed = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"page_size": 1, "page": 1},
    )
    assert narrowed.status_code == 200
    narrowed_payload = narrowed.json()
    assert narrowed_payload["state"] == "successful"
    assert narrowed_payload["data"][left_node.id]["pagination"]["page_size"] == 1
    assert narrowed_payload["data"][right_node.id]["pagination"]["page_size"] == 1

    # Second page request applies to both nodes equally
    paged = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"page": 2, "page_size": 1},
    )
    assert paged.status_code == 200
    paged_payload = paged.json()
    assert paged_payload["data"][left_node.id]["pagination"]["page"] == 2
    assert paged_payload["data"][right_node.id]["pagination"]["page"] == 2


@pytest.mark.anyio
@pytest.mark.skipif(DocDataFrame is None, reason="docframe not available")
async def test_concordance_combined_toggle_after_separated_request(
    authenticated_client, workspace_id
):
    """Combined toggle requests should still return successful per-node data."""
    analysis_store.clear_analyses("test", workspace_id, task="concordance")
    analysis_store.clear_analyses("test", workspace_id, task="multi_concordance")

    df_left = pl.DataFrame({
        "text": ["alpha beta", "beta alpha", "alpha gamma"],
        "speaker": ["L1", "L2", "L3"],
    })
    df_right = pl.DataFrame({
        "text": ["alpha delta", "epsilon alpha", "zeta"],
        "speaker": ["R1", "R2", "R3"],
    })

    left_node = workspace_manager.add_node_to_workspace(
        user_id="test",
        workspace_id=workspace_id,
        data=DocDataFrame(df_left, document_column="text"),  # type: ignore
        node_name="left_docs",
        operation="test_setup",
        parents=[],
    )
    right_node = workspace_manager.add_node_to_workspace(
        user_id="test",
        workspace_id=workspace_id,
        data=DocDataFrame(df_right, document_column="text"),  # type: ignore
        node_name="right_docs",
        operation="test_setup",
        parents=[],
    )

    request_payload = {
        "node_ids": [left_node.id, right_node.id],
        "node_columns": {left_node.id: "text", right_node.id: "text"},
        "search_word": "alpha",
        "num_left_tokens": 2,
        "num_right_tokens": 2,
        "regex": False,
        "case_sensitive": False,
        "combined": False,
    }

    resp = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "running"

    _simulate_concordance_completion(workspace_id, request_payload)

    result_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id
    )
    assert result_payload["state"] == "successful"
    assert result_payload.get("combinable") is False

    combined_toggle = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"combined": True, "page": 1, "page_size": 2},
    )
    assert combined_toggle.status_code == 200
    combined_payload = combined_toggle.json()
    assert combined_payload["state"] == "successful"
    assert combined_payload.get("combinable") is False
    assert left_node.id in combined_payload["data"]
    assert right_node.id in combined_payload["data"]
    for node_id in (left_node.id, right_node.id):
        assert combined_payload["data"][node_id]["pagination"]["page_size"] == 2


@pytest.mark.anyio
@pytest.mark.skipif(DocDataFrame is None, reason="docframe not available")
async def test_concordance_combined_handles_mismatched_columns(
    authenticated_client, workspace_id
):
    """Mismatched node schemas still return per-node concordance data."""
    analysis_store.clear_analyses("test", workspace_id, task="concordance")
    analysis_store.clear_analyses("test", workspace_id, task="multi_concordance")

    left_df = pl.DataFrame({
        "text": ["alpha beta", "beta alpha"],
        "speaker": ["L1", "L2"],
        "topic": ["economy", "housing"],
    })
    right_df = pl.DataFrame({
        "text": ["alpha delta", "alpha"],
        "speaker": ["R1", "R2"],
        "word_count": [200, 150],
    })

    left_node = workspace_manager.add_node_to_workspace(
        user_id="test",
        workspace_id=workspace_id,
        data=DocDataFrame(left_df, document_column="text"),  # type: ignore
        node_name="left_docs",
        operation="test_setup",
        parents=[],
    )
    right_node = workspace_manager.add_node_to_workspace(
        user_id="test",
        workspace_id=workspace_id,
        data=DocDataFrame(right_df, document_column="text"),  # type: ignore
        node_name="right_docs",
        operation="test_setup",
        parents=[],
    )

    request_payload = {
        "node_ids": [left_node.id, right_node.id],
        "node_columns": {left_node.id: "text", right_node.id: "text"},
        "search_word": "alpha",
        "num_left_tokens": 2,
        "num_right_tokens": 2,
        "regex": False,
        "case_sensitive": False,
        "combined": True,
    }

    resp = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "running"

    _simulate_concordance_completion(workspace_id, request_payload)

    result_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id
    )
    assert result_payload["state"] == "successful"
    assert result_payload.get("combinable") is False
    assert left_node.id in result_payload["data"]
    assert right_node.id in result_payload["data"]

    combined_attempt = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"combined": True, "page": 1, "page_size": 1},
    )
    assert combined_attempt.status_code == 200
    combined_attempt_payload = combined_attempt.json()
    assert combined_attempt_payload["state"] == "successful"
    assert combined_attempt_payload.get("combinable") is False
    assert left_node.id in combined_attempt_payload["data"]
    assert right_node.id in combined_attempt_payload["data"]
