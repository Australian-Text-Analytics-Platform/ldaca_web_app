import polars as pl
import pytest
from docworkspace import Node
from ldaca_web_app_backend.core.workspace import workspace_manager


@pytest.mark.anyio
async def test_concordance_detach_starts_task(authenticated_client, workspace_id):
    """Ensure detaching concordance starts a background task."""
    df = pl.DataFrame({"text": ["alpha beta", "beta gamma", "alpha gamma"]})
    workspace = workspace_manager.get_current_workspace("test")
    assert workspace is not None

    node = Node(
        data=df.lazy(),
        name="text_node",
        workspace=workspace,
        operation="test_add",
        parents=[],
    )
    workspace.add_node(node)
    assert node is not None

    # Act: call detach endpoint
    resp = await authenticated_client.post(
        f"/api/workspaces/nodes/{node.id}/concordance/detach",
        json={
            "node_id": node.id,
            "column": "text",
            "search_word": "alpha",
            "num_left_tokens": 2,
            "num_right_tokens": 2,
            "regex": False,
            "case_sensitive": False,
        },
    )

    # Assert
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload.get("state") == "running"
    assert payload.get("metadata", {}).get("task_id")


@pytest.mark.anyio
async def test_concordance_detach_options_include_mandatory_and_optional_columns(
    authenticated_client, workspace_id
):
    df = pl.DataFrame({
        "text": ["alpha beta", "beta gamma", "alpha gamma"],
        "speaker": ["a", "b", "c"],
    })
    workspace = workspace_manager.get_current_workspace("test")
    assert workspace is not None

    node = Node(
        data=df.lazy(),
        name="text_node",
        workspace=workspace,
        operation="test_add",
        parents=[],
    )
    workspace.add_node(node)

    resp = await authenticated_client.get(
        f"/api/workspaces/nodes/{node.id}/concordance/detach-options",
        params={"column": "text"},
    )

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    node_option = payload["data"]["nodes"][0]

    assert node_option["node_id"] == node.id
    assert node_option["text_column"] == "text"
    assert node_option["available_columns"] == [
        "text",
        "CONC_left_context",
        "CONC_matched_text",
        "CONC_right_context",
        "CONC_start_idx",
        "CONC_end_idx",
        "CONC_l1",
        "CONC_r1",
        "speaker",
    ]
    assert node_option["disabled_columns"] == [
        "CONC_left_context",
        "CONC_matched_text",
        "CONC_right_context",
        "CONC_start_idx",
        "CONC_end_idx",
        "CONC_l1",
        "CONC_r1",
    ]
