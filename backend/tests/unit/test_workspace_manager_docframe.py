"""Regression tests for workspace_manager document metadata handling."""

from datetime import datetime
from unittest.mock import patch

import polars as pl
from docworkspace import Node, Workspace
from ldaca_web_app_backend.core.utils import generate_workspace_id
from ldaca_web_app_backend.core.workspace import workspace_manager


def test_add_node_preserves_document_metadata(settings_override):
    """Ensure document column metadata persists for lazy nodes."""

    with patch("ldaca_web_app_backend.core.utils.settings", settings_override):
        workspace = Workspace(name="docdf_ws")
        workspace.id = generate_workspace_id()
        workspace.description = "LazyFrame workspace"
        workspace.modified_at = datetime.now().isoformat()
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
        current_ws = workspace_manager.get_current_workspace("test")
        assert current_ws is not None
        node = Node(
            data=lazy_df,
            name="lazy_node",
            workspace=current_ws,
            operation="test_add",
            parents=[],
        )
        current_ws.add_node(node)

        assert node is not None, "Node creation with LazyFrame should succeed"
        node.document = "text"
        current_ws.modified_at = datetime.now().isoformat()
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
            fetched = current_ws.nodes.get(node.id)
            assert fetched is not None
            assert fetched.document == "text"
        finally:
            workspace_manager.delete_workspace("test", workspace_id)
            workspace_manager.set_current_workspace("test", None)
