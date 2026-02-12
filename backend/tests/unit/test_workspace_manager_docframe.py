"""Regression tests for workspace_manager document metadata handling."""

from unittest.mock import patch

import polars as pl
from ldaca_web_app_backend.core.workspace import workspace_manager


def test_add_node_preserves_document_metadata(settings_override):
    """Ensure document column metadata persists for lazy nodes."""

    with patch("ldaca_web_app_backend.core.utils.settings", settings_override):
        workspace = workspace_manager.create_workspace(
            user_id="test", name="docdf_ws", description="LazyFrame workspace"
        )
        workspace_id = workspace.id

        df = pl.DataFrame({"text": ["alpha", "beta"], "speaker": ["a", "b"]})
        lazy_df = df.lazy()
        node = workspace_manager.add_node_to_workspace(
            user_id="test",
            workspace_id=workspace_id,
            data=lazy_df,
            node_name="lazy_node",
            operation="test_add",
            parents=[],
        )

        assert node is not None, "Node creation with LazyFrame should succeed"
        node.document = "text"
        workspace_manager.persist("test", workspace_id)
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
