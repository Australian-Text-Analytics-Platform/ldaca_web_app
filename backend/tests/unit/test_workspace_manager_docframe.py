"""Regression tests for workspace_manager document metadata handling."""

from datetime import datetime
from unittest.mock import patch

import polars as pl
from docworkspace import Workspace
from ldaca_web_app_backend.core.utils import generate_workspace_id
from ldaca_web_app_backend.core.workspace import workspace_manager


def test_add_node_preserves_document_metadata(settings_override):
    """Ensure document column metadata persists for lazy nodes."""

    with patch("ldaca_web_app_backend.core.utils.settings", settings_override):
        workspace = Workspace(name="docdf_ws")
        workspace.id = generate_workspace_id()
        workspace.set_metadata("description", "LazyFrame workspace")
        workspace.set_metadata("modified_at", datetime.now().isoformat())
        target_dir = workspace_manager._resolve_workspace_dir(
            user_id="test",
            workspace_id=workspace.id,
            workspace_name=workspace.name,
        )
        workspace_manager._attach_workspace_dir(workspace, target_dir)
        workspace.save(target_dir)
        workspace_manager._set_cached_path("test", workspace.id, target_dir)
        workspace_manager.set_current_workspace("test", workspace.id)
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
        current_ws = workspace_manager.get_workspace("test", workspace_id)
        assert current_ws is not None
        current_ws.set_metadata("modified_at", datetime.now().isoformat())
        target_dir = workspace_manager._resolve_workspace_dir(
            user_id="test",
            workspace_id=workspace_id,
            workspace_name=current_ws.name,
        )
        workspace_manager._attach_workspace_dir(current_ws, target_dir)
        current_ws.save(target_dir)
        workspace_manager._set_cached_path("test", workspace_id, target_dir)
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
