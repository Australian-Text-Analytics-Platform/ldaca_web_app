import polars as pl
import pytest
from fastapi.testclient import TestClient
from ldaca_web_app_backend.core.auth import get_current_user
from ldaca_web_app_backend.core.workspace import workspace_manager
from ldaca_web_app_backend.main import app

try:
    from docframe import DocDataFrame
except Exception:  # pragma: no cover
    DocDataFrame = None  # type: ignore


def _mock_user():
    return {"id": "test"}


@pytest.mark.parametrize(
    "search_word", ["alpha"]
)  # simple param for potential expansion
def test_concordance_detach_preserves_doc_dataframe(search_word, monkeypatch):
    if DocDataFrame is None:
        pytest.skip("docframe not available")

    # Override auth to return mock user
    app.dependency_overrides[get_current_user] = _mock_user
    client = TestClient(app)

    workspace_id = None  # Initialize for cleanup
    try:
        # Create workspace
        ws_resp = client.post("/api/workspaces/", json={"name": "test_ws"})
        assert ws_resp.status_code == 200
        workspace_id = ws_resp.json()["workspace_id"]

        df = pl.DataFrame({"text": ["alpha beta", "beta gamma", "alpha gamma"]})
        doc_df = DocDataFrame(df, document_column="text")  # type: ignore

        node = workspace_manager.add_node_to_workspace(
            user_id="test",
            workspace_id=workspace_id,
            data=doc_df,
            node_name="text_node",
            operation="test_add",
            parents=[],
        )
        assert node is not None

        detach_resp = client.post(
            f"/api/workspaces/{workspace_id}/nodes/{node.id}/concordance/detach",
            json={
                "node_id": node.id,
                "column": "text",
                "search_word": search_word,
                "num_left_tokens": 2,
                "num_right_tokens": 2,
                "regex": False,
                "case_sensitive": False,
            },
        )
        assert detach_resp.status_code == 200, detach_resp.text
        new_node_id = detach_resp.json()["new_node_id"]

        new_node = workspace_manager.get_node_from_workspace(
            "test", workspace_id, new_node_id
        )
        assert new_node is not None
        assert isinstance(new_node.data, DocDataFrame), (
            "Detached node should be DocDataFrame"
        )
        assert getattr(new_node.data, "document_column", None) == "text"

    finally:
        # Cleanup: Delete the workspace that was created
        if workspace_id:
            try:
                workspace_manager.delete_workspace("test", workspace_id)
            except Exception:
                pass  # Ignore cleanup errors

        # Cleanup override
        app.dependency_overrides.clear()
