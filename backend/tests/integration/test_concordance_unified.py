import asyncio
import time

import polars as pl
import pytest
from docworkspace import Node
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.api.workspaces.analyses.concordance import (
    DEFAULT_CONCORDANCE_PAGE_SIZE,
)
from ldaca_web_app_backend.core.workspace import workspace_manager


async def _wait_for_concordance_result(
    client,
    workspace_id: str,
    task_id: str,
    *,
    timeout: float = 20.0,
    poll_interval: float = 0.25,
):
    """Poll the current-result endpoint until concordance data is available."""

    deadline = time.monotonic() + timeout
    last_payload = None

    while time.monotonic() < deadline:
        resp = await client.get(f"/api/workspaces/concordance/tasks/{task_id}/result")
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


def _clear_concordance_state(user_id: str, workspace_id: str):
    task_manager = get_task_manager(user_id)
    task_manager.clear_all()


def _add_node(workspace_id: str, data: pl.LazyFrame, node_name: str):
    workspace = workspace_manager.get_current_workspace("test")
    assert workspace is not None
    node = Node(
        data=data,
        name=node_name,
        workspace=workspace,
        operation="test_setup",
        parents=[],
    )
    workspace.add_node(node)
    return node


async def _get_current_task_id(client, workspace_id: str, analysis: str):
    slug = analysis.replace("_", "-")
    response = await client.get(f"/api/workspaces/{slug}/tasks/current")
    if response.status_code != 200:
        return None
    payload = response.json()
    task_ids = payload.get("task_ids") or []
    return task_ids[0] if task_ids else None


@pytest.mark.anyio
async def test_concordance_single_node_roundtrip(authenticated_client, workspace_id):
    """Single-node concordance should store results and expose current-request/result endpoints."""
    # Ensure clean state for this workspace/user
    _clear_concordance_state("test", workspace_id)

    df = pl.DataFrame({
        "text": [
            "alpha beta alpha",
            "beta gamma",
            "Alpha beta",  # Mixed case to test case sensitivity flag
        ],
        "speaker": ["A", "B", "C"],
    })
    node = _add_node(workspace_id, df.lazy(), "single_text_node")
    node.document = "text"
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
    }

    resp = await authenticated_client.post(
        "/api/workspaces/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "successful"
    assert payload.get("metadata", {}).get("task_id")

    task_id = await _get_current_task_id(
        authenticated_client, workspace_id, "concordance"
    )
    assert task_id

    result_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id, task_id
    )
    assert result_payload["state"] == "successful"
    assert result_payload.get("combinable") is False
    assert node.id in result_payload["data"]
    node_result = result_payload["data"][node.id]
    assert node_result["metadata"]["concordance_columns"]
    assert len(node_result["data"]) <= DEFAULT_CONCORDANCE_PAGE_SIZE
    assert node_result["pagination"]["page_size"] == DEFAULT_CONCORDANCE_PAGE_SIZE
    assert result_payload["analysis_params"]["node_ids"] == [node.id]
    assert (
        result_payload["analysis_params"].get(
            "page_size", DEFAULT_CONCORDANCE_PAGE_SIZE
        )
        == DEFAULT_CONCORDANCE_PAGE_SIZE
    )
    assert result_payload["analysis_params"].get("descending", True) is True

    # Current request should surface the persisted request
    current_req = await authenticated_client.get(
        f"/api/workspaces/concordance/tasks/{task_id}/request"
    )
    assert current_req.status_code == 200
    current_req_payload = current_req.json()
    assert current_req_payload["node_ids"] == [node.id]
    assert current_req_payload["node_columns"][node.id] == "text"
    assert "page" not in current_req_payload
    assert "page_size" not in current_req_payload
    assert "sort_by" not in current_req_payload
    assert "descending" not in current_req_payload
    assert "pagination" not in current_req_payload

    task_manager = get_task_manager("test")
    current_task = task_manager.get_task(task_id)
    stored_request = (
        current_task.request.model_dump()
        if current_task and hasattr(current_task.request, "model_dump")
        else {}
    )
    assert "page" not in stored_request
    assert "page_size" not in stored_request
    assert "pagination" not in stored_request

    task = task_manager.get_task(task_id)
    assert task is not None
    stored_result = task.result.to_json() if task.result else {}
    assert isinstance(stored_result, dict)
    assert stored_result.get("ready") is True

    # Request a smaller page size via POST (non-persistent override)
    current_res_post = await authenticated_client.post(
        f"/api/workspaces/concordance/tasks/{task_id}/result",
        json={"node_id": node.id, "page_size": 1},
    )
    assert current_res_post.status_code == 200
    tailored = current_res_post.json()
    assert tailored["state"] == "successful"
    assert node.id in tailored["data"]
    node_fetch = tailored["data"][node.id]
    assert node_fetch["pagination"]["page_size"] == 1
    # Source-row pagination: page_size=1 means 1 source document, which may
    # produce multiple concordance rows after explode.
    assert len(node_fetch["data"]) >= 1
    assert tailored["analysis_params"].get("page_size") == 1

    # Request the second page explicitly using node_id and page_number alias
    page_two = await authenticated_client.post(
        f"/api/workspaces/concordance/tasks/{task_id}/result",
        json={"node_id": node.id, "page_number": 2, "page_size": 1},
    )
    assert page_two.status_code == 200
    page_two_payload = page_two.json()
    assert page_two_payload["state"] == "successful"
    assert page_two_payload["data"][node.id]["pagination"]["page"] == 2

    # GET again should return default pagination (no persisted overrides)
    refreshed_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id, task_id
    )
    assert (
        refreshed_payload["data"][node.id]["pagination"]["page_size"]
        == DEFAULT_CONCORDANCE_PAGE_SIZE
    )


@pytest.mark.anyio
async def test_concordance_multi_node_combined(authenticated_client, workspace_id):
    """Two-node concordance returns per-node results via async workflow."""
    _clear_concordance_state("test", workspace_id)

    df_left = pl.DataFrame({
        "text": ["alpha beta", "beta alpha", "gamma alpha"],
        "speaker": ["L1", "L2", "L3"],
    })
    df_right = pl.DataFrame({
        "text": ["alpha delta", "epsilon alpha", "alpha"],
        "speaker": ["R1", "R2", "R3"],
    })

    left_node = _add_node(workspace_id, df_left.lazy(), "left_docs")
    left_node.document = "text"
    right_node = _add_node(workspace_id, df_right.lazy(), "right_docs")
    right_node.document = "text"

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
        "/api/workspaces/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "successful"
    task_id = await _get_current_task_id(
        authenticated_client, workspace_id, "concordance"
    )
    assert task_id

    result_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id, task_id
    )
    assert result_payload["state"] == "successful"
    assert result_payload.get("combinable") is True
    assert "__COMBINED__" in result_payload["data"]

    combined_result = result_payload["data"]["__COMBINED__"]
    assert combined_result["pagination"]["page_size"] == DEFAULT_CONCORDANCE_PAGE_SIZE

    # Request both nodes with a smaller page size override
    narrowed = await authenticated_client.post(
        f"/api/workspaces/concordance/tasks/{task_id}/result",
        json={"page_size": 1, "page": 1},
    )
    assert narrowed.status_code == 200
    narrowed_payload = narrowed.json()
    assert narrowed_payload["state"] == "successful"
    assert narrowed_payload["data"]["__COMBINED__"]["pagination"]["page_size"] == 1

    # Second page request applies to both nodes equally
    paged = await authenticated_client.post(
        f"/api/workspaces/concordance/tasks/{task_id}/result",
        json={"page": 2, "page_size": 1},
    )
    assert paged.status_code == 200
    paged_payload = paged.json()
    assert paged_payload["data"]["__COMBINED__"]["pagination"]["page"] == 2


@pytest.mark.anyio
async def test_concordance_combined_toggle_after_separated_request(
    authenticated_client, workspace_id
):
    """Combined toggle requests should still return successful per-node data."""
    _clear_concordance_state("test", workspace_id)

    df_left = pl.DataFrame({
        "text": ["alpha beta", "beta alpha", "alpha gamma"],
        "speaker": ["L1", "L2", "L3"],
    })
    df_right = pl.DataFrame({
        "text": ["alpha delta", "epsilon alpha", "zeta"],
        "speaker": ["R1", "R2", "R3"],
    })

    left_node = _add_node(workspace_id, df_left.lazy(), "left_docs")
    left_node.document = "text"
    right_node = _add_node(workspace_id, df_right.lazy(), "right_docs")
    right_node.document = "text"

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
        "/api/workspaces/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "successful"
    task_id = await _get_current_task_id(
        authenticated_client, workspace_id, "concordance"
    )
    assert task_id

    result_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id, task_id
    )
    assert result_payload["state"] == "successful"
    assert result_payload.get("combinable") is True

    combined_toggle = await authenticated_client.post(
        f"/api/workspaces/concordance/tasks/{task_id}/result",
        json={"combined": True, "page": 1, "page_size": 2},
    )
    assert combined_toggle.status_code == 200
    combined_payload = combined_toggle.json()
    assert combined_payload["state"] == "successful"
    assert combined_payload.get("combinable") is True
    assert "__COMBINED__" in combined_payload["data"]
    assert combined_payload["data"]["__COMBINED__"]["pagination"]["page_size"] == 2


@pytest.mark.anyio
async def test_concordance_combined_handles_mismatched_columns(
    authenticated_client, workspace_id
):
    """Mismatched node schemas still return per-node concordance data."""
    _clear_concordance_state("test", workspace_id)

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

    left_node = _add_node(workspace_id, left_df.lazy(), "left_docs")
    left_node.document = "text"
    right_node = _add_node(workspace_id, right_df.lazy(), "right_docs")
    right_node.document = "text"

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
        "/api/workspaces/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "successful"
    task_id = await _get_current_task_id(
        authenticated_client, workspace_id, "concordance"
    )
    assert task_id

    result_payload = await _wait_for_concordance_result(
        authenticated_client, workspace_id, task_id
    )
    assert result_payload["state"] == "successful"
    assert result_payload.get("combinable") is True
    assert "__COMBINED__" in result_payload["data"]

    combined_attempt = await authenticated_client.post(
        f"/api/workspaces/concordance/tasks/{task_id}/result",
        json={"combined": True, "page": 1, "page_size": 1},
    )
    assert combined_attempt.status_code == 200
    combined_attempt_payload = combined_attempt.json()
    assert combined_attempt_payload["state"] == "successful"
    assert combined_attempt_payload.get("combinable") is True
    assert "__COMBINED__" in combined_attempt_payload["data"]
