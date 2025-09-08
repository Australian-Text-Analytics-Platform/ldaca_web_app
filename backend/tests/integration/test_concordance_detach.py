import pytest
import polars as pl

from ldaca_web_app_backend.core.workspace import workspace_manager

try:
    from docframe import DocDataFrame  # type: ignore
except Exception:  # pragma: no cover
    DocDataFrame = None  # type: ignore


@pytest.mark.anyio
@pytest.mark.skipif(DocDataFrame is None, reason="docframe not available")
async def test_concordance_detach_preserves_doc_dataframe(authenticated_client, workspace_id):
    """Ensure detaching concordance returns a DocDataFrame node preserving document column.

    This is the async/anyio version aligned with the rest of the integration tests.
    """
    # Arrange: create a DocDataFrame node in the workspace
    df = pl.DataFrame({"text": ["alpha beta", "beta gamma", "alpha gamma"]})
    doc_df = DocDataFrame(df, document_column="text")  # type: ignore

    node = workspace_manager.add_node_to_workspace(
        user_id="test",  # provided by authenticated_client fixture
        workspace_id=workspace_id,
        data=doc_df,
        node_name="text_node",
        operation="test_add",
        parents=[],
    )
    assert node is not None

    # Act: call detach endpoint
    resp = await authenticated_client.post(
        f"/api/workspaces/{workspace_id}/nodes/{node.id}/concordance/detach",
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
    assert payload.get("success") is True
    new_node_id = payload["new_node_id"]

    new_node = workspace_manager.get_node_from_workspace("test", workspace_id, new_node_id)
    assert new_node is not None
    assert isinstance(new_node.data, DocDataFrame), "Detached node should be DocDataFrame"
    assert getattr(new_node.data, "document_column", None) == "text"

