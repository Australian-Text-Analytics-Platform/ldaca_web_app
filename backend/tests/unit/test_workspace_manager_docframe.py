"""Regression tests for workspace_manager handling DocDataFrame inputs."""

from unittest.mock import patch

import polars as pl
from ldaca_web_app_backend.core.workspace import workspace_manager

from docframe import DocDataFrame, DocLazyFrame


def test_add_node_accepts_docdataframe(settings_override):
    """Ensure DocDataFrame inputs become DocLazyFrame nodes when added."""

    with patch("ldaca_web_app_backend.core.utils.settings", settings_override):
        workspace = workspace_manager.create_workspace(
            user_id="test", name="docdf_ws", description="DocDataFrame workspace"
        )
        workspace_id = workspace.id

        doc_df = DocDataFrame(
            pl.DataFrame({"text": ["alpha", "beta"], "speaker": ["a", "b"]}),
            document_column="text",
        )

        node = workspace_manager.add_node_to_workspace(
            user_id="test",
            workspace_id=workspace_id,
            data=doc_df,
            node_name="docdf_node",
            operation="test_add",
            parents=[],
        )

        assert node is not None, "Node creation with DocDataFrame should succeed"
        assert isinstance(node.data, DocLazyFrame)
        assert node.document == "text"

        try:
            fetched = workspace_manager.get_node_from_workspace(
                "test", workspace_id, node.id
            )
            assert fetched is not None
            assert fetched.document == "text"
        finally:
            workspace_manager.delete_workspace("test", workspace_id)
            workspace_manager.set_current_workspace("test", None)
