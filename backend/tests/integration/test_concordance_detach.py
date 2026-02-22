import polars as pl
import pytest
from docworkspace import Node
from ldaca_web_app_backend.core.workspace import workspace_manager


@pytest.mark.anyio
async def test_concordance_detach_starts_task(authenticated_client, workspace_id):
    """Ensure detaching concordance starts a background task."""
    df = pl.DataFrame({"text": ["alpha beta", "beta gamma", "alpha gamma"]})
    workspace = workspace_manager.get_workspace("test", workspace_id)
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
