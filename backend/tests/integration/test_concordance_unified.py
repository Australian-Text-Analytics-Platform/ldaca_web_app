import polars as pl
import pytest
from ldaca_web_app_backend.core.workspace import workspace_manager

try:
    from docframe import DocDataFrame  # type: ignore
except Exception:  # pragma: no cover
    DocDataFrame = None  # type: ignore


@pytest.mark.anyio
@pytest.mark.skipif(DocDataFrame is None, reason="docframe not available")
async def test_concordance_single_node_roundtrip(authenticated_client, workspace_id):
    """Single-node concordance should store results and expose current-request/result endpoints."""
    # Ensure clean state for this workspace/user
    from ldaca_web_app_backend.core import analysis_store

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
        "page": 1,
        "page_size": 2,
        "sort_by": "document_idx",
        "sort_order": "asc",
    }

    resp = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "successful"
    assert payload["analysis_params"]["node_ids"] == [node.id]
    assert payload.get("combinable") is False
    # Node label should be the node name
    assert "single_text_node" in payload["data"]
    node_result = payload["data"]["single_text_node"]
    assert node_result["total_matches"] >= 2
    assert node_result["metadata"]["concordance_columns"]
    assert node_result["metadata"]["metadata_columns"]
    assert len(node_result["data"]) <= request_payload["page_size"]

    # Current request should surface the persisted request
    current_req = await authenticated_client.get(
        f"/api/workspaces/{workspace_id}/concordance/current-request"
    )
    assert current_req.status_code == 200
    current_req_payload = current_req.json()
    assert current_req_payload["data"]["node_ids"] == [node.id]
    assert current_req_payload["data"]["node_columns"][node.id] == "text"

    # Current result (GET) should reuse stored results and preserve structure
    current_res = await authenticated_client.get(
        f"/api/workspaces/{workspace_id}/concordance/current-result"
    )
    assert current_res.status_code == 200
    current_data = current_res.json()
    assert current_data["state"] == "successful"
    assert "single_text_node" in current_data["data"]
    assert current_data.get("combinable") is False

    # POST current-result to request a smaller page size
    current_res_post = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"page_size": 1},
    )
    assert current_res_post.status_code == 200
    tailored = current_res_post.json()
    assert tailored["data"]["single_text_node"]["pagination"]["page_size"] == 1
    assert len(tailored["data"]["single_text_node"]["data"]) <= 1

    # Request the second page explicitly using node_id and page_number alias
    page_two = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"node_id": node.id, "page_number": 2, "page_size": 1},
    )
    assert page_two.status_code == 200
    page_two_payload = page_two.json()
    assert page_two_payload["data"]["single_text_node"]["pagination"]["page"] == 2
    assert (
        page_two_payload["data"]["single_text_node"]["total_matches"]
        == node_result["total_matches"]
    )


@pytest.mark.anyio
@pytest.mark.skipif(DocDataFrame is None, reason="docframe not available")
async def test_concordance_multi_node_combined(authenticated_client, workspace_id):
    """Two-node concordance with combined view should return both individual and merged results."""
    from ldaca_web_app_backend.core import analysis_store

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
        "page": 1,
        "page_size": 2,
    }

    resp = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["state"] == "successful"
    assert payload.get("combinable") is True
    assert set(payload["data"].keys()) >= {"left_docs", "right_docs", "__COMBINED__"}

    combined = payload["data"]["__COMBINED__"]
    assert combined["total_matches"] >= 3
    assert combined["pagination"]["page"] == 1
    assert combined["sorting"]["sort_order"] in {"asc", "desc"}
    assert len(combined["data"]) <= request_payload["page_size"]

    # Request only left node via current-result POST to ensure overrides work
    current_filtered = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"node_id": left_node.id, "page_size": 2},
    )
    assert current_filtered.status_code == 200
    filtered_payload = current_filtered.json()
    assert filtered_payload.get("combinable") is True
    assert list(filtered_payload["data"].keys()) == ["left_docs"]
    assert filtered_payload["data"]["left_docs"]["pagination"]["page_size"] == 2

    # Request combined view second page
    combined_page_two = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"combined": True, "page": 2, "page_size": 1},
    )
    assert combined_page_two.status_code == 200
    combined_two_payload = combined_page_two.json()
    assert combined_two_payload.get("combinable") is True
    assert "__COMBINED__" in combined_two_payload["data"]
    assert combined_two_payload["data"]["__COMBINED__"]["pagination"]["page"] == 2
    assert (
        combined_two_payload["data"]["__COMBINED__"]["total_matches"]
        == combined["total_matches"]
    )


@pytest.mark.anyio
@pytest.mark.skipif(DocDataFrame is None, reason="docframe not available")
async def test_concordance_combined_handles_mismatched_columns(
    authenticated_client, workspace_id
):
    """Combined concordance should include union of columns across nodes."""
    from ldaca_web_app_backend.core import analysis_store

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
        "page": 1,
        "page_size": 10,
    }

    resp = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance",
        json=request_payload,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload.get("combinable") is False
    assert "__COMBINED__" not in payload["data"]

    combined_attempt = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/concordance/current-result",
        json={"combined": True, "page": 1, "page_size": 1},
    )
    assert combined_attempt.status_code == 200
    combined_attempt_payload = combined_attempt.json()
    assert combined_attempt_payload["state"] == "failed"
    assert (
        combined_attempt_payload["message"] == "Combined concordance view not available"
    )
