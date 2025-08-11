import pathlib
import sys

import polars as pl
import pytest
from core.auth import get_current_user
from core.workspace import workspace_manager
from fastapi.testclient import TestClient
from main import app

# Ensure backend package path (after initial imports for linter friendliness)
backend_dir = pathlib.Path(__file__).parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

try:
    from docframe import DocDataFrame
except Exception:  # pragma: no cover
    DocDataFrame = None  # type: ignore


def _mock_user():
    return {"id": "test-user-123"}


@pytest.mark.parametrize(
    "search_word", ["alpha"]
)  # simple param for potential expansion
def test_concordance_detach_preserves_doc_dataframe(search_word, monkeypatch):
    if DocDataFrame is None:
        pytest.skip("docframe not available")

    # Override auth to return mock user
    app.dependency_overrides[get_current_user] = _mock_user
    client = TestClient(app)

    # Create workspace
    ws_resp = client.post("/api/workspaces/", json={"name": "test_ws"})
    assert ws_resp.status_code == 200
    workspace_id = ws_resp.json()["workspace_id"]

    df = pl.DataFrame({"text": ["alpha beta", "beta gamma", "alpha gamma"]})
    doc_df = DocDataFrame(df, document_column="text")  # type: ignore

    node = workspace_manager.add_node_to_workspace(
        user_id="test-user-123",
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
        "test-user-123", workspace_id, new_node_id
    )
    assert new_node is not None
    assert isinstance(new_node.data, DocDataFrame), (
        "Detached node should be DocDataFrame"
    )
    assert getattr(new_node.data, "document_column", None) == "text"

    # Cleanup override
    app.dependency_overrides.clear()
