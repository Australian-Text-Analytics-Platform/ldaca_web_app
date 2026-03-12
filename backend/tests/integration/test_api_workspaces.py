"""
Integration tests for workspace API endpoints
"""

import io
import json
import zipfile
from csv import DictReader
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import polars as pl
import pytest


@pytest.mark.integration
@pytest.mark.workspace
class TestWorkspaceAPI:
    """Test cases for workspace management endpoints"""

    async def test_list_workspaces_empty(self, authenticated_client):
        """Test listing workspaces when user has none"""
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.list_user_workspaces_summaries"
        ) as mock_get:
            mock_get.return_value = []
            response = await authenticated_client.get("/api/workspaces/")
            if response.status_code != 200:
                pytest.fail(response.text)
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 0

    async def test_list_workspaces_with_data(self, authenticated_client):
        """Test listing workspaces when user has workspaces"""
        mock_summaries = [
            {
                "id": "abc123",
                "name": "Test Workspace 1",
                "description": "Test description",
                "created_at": "2024-01-01T00:00:00Z",
                "modified_at": "2024-01-01T12:00:00Z",
                "total_nodes": 1,
                "root_nodes": 1,
                "leaf_nodes": 1,
                "node_types": {"DataFrame": 1},
            }
        ]
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.list_user_workspaces_summaries"
        ) as mock_get:
            mock_get.return_value = mock_summaries
            response = await authenticated_client.get("/api/workspaces/")
            assert response.status_code == 200
            data = response.json()
            assert len(data) == 1
            assert data[0]["id"] == "abc123"
            assert data[0]["total_nodes"] == 1

    async def test_create_workspace(self, authenticated_client):
        """Test creating a new workspace"""
        # Mock workspace_manager methods for create flow
        with (
            patch("docworkspace.workspace.core.Workspace.save") as mock_save,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.set_current_workspace"
            ) as mock_set_current,
        ):
            mock_save.return_value = None
            mock_set_current.return_value = True

            payload = {"name": "New Workspace", "description": "New test workspace"}

            response = await authenticated_client.post("/api/workspaces/", json=payload)

            assert response.status_code == 200
            data = response.json()
            assert isinstance(data["id"], str)
            assert data["id"]
            assert data["name"] == "New Workspace"
            assert data["description"] == "New test workspace"
            assert data["total_nodes"] == 0  # Use latest docworkspace terminology

    async def test_get_workspace_info(self, authenticated_client):
        """Test getting specific workspace information"""
        mock_workspace = Mock()
        mock_workspace.id = "workspace-123"
        mock_workspace.name = "Test Workspace"
        mock_workspace.description = "Test description"
        mock_workspace.created_at = "2024-01-01T00:00:00Z"
        mock_workspace.modified_at = "2024-01-01T12:00:00Z"
        mock_workspace.info_json.return_value = {
            "id": "workspace-123",
            "name": "Test Workspace",
            "total_nodes": 5,
            "root_nodes": 2,
            "leaf_nodes": 3,
            "node_types": {"DataFrame": 3, "LazyFrame": 2},
            "status_counts": {"lazy": 1, "materialized": 4},
            "metadata_keys": ["description", "created_at", "modified_at"],
        }

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_get,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
        ):
            mock_get.return_value = mock_workspace
            mock_current_entry.return_value = "workspace-123"

            # Active-workspace endpoint
            response = await authenticated_client.get("/api/workspaces/info")

            assert response.status_code == 200
            data = response.json()
            assert data["id"] == "workspace-123"
            assert data["name"] == "Test Workspace"
            assert data["total_nodes"] == 5  # Latest docworkspace terminology

    async def test_get_node_data_handles_lazy_relative_paths(
        self,
        authenticated_client,
        workspace_id,
        tiny_node_id,
    ):
        """Fetch node data to ensure lazy plans with relative parquet paths resolve."""

        # Page through the node's data
        resp = await authenticated_client.get(
            f"/api/workspaces/nodes/{tiny_node_id}/data",
            params={"page": 1, "page_size": 5},
        )

        assert resp.status_code == 200, resp.text
        payload = resp.json()

        assert "data" in payload and isinstance(payload["data"], list)
        assert len(payload["data"]) > 0
        assert "columns" in payload
        # Ensure pagination metadata present
        pagination = payload.get("pagination", {})
        assert pagination.get("page") == 1
        assert pagination.get("page_size") == 5

    async def test_get_workspace_not_found(self, authenticated_client):
        """Test getting non-existent workspace"""
        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_get,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
        ):
            mock_get.return_value = None
            mock_current_entry.return_value = "nonexistent-123"

            with pytest.raises(AttributeError):
                await authenticated_client.get("/api/workspaces/info")

    async def test_delete_workspace(self, authenticated_client):
        """Test deleting a workspace"""
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.delete_workspace"
        ) as mock_delete:
            mock_delete.return_value = True

            response = await authenticated_client.delete(
                "/api/workspaces/delete",
                params={"workspace_id": "workspace-123"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["state"] == "successful"
            assert data["message"] == "Workspace workspace-123 deleted successfully"
            assert data["id"] == "workspace-123"
            mock_delete.assert_called_once_with("test", "workspace-123")

    async def test_delete_workspace_not_found(self, authenticated_client):
        """Test deleting non-existent workspace"""
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.delete_workspace"
        ) as mock_delete:
            mock_delete.return_value = False

            response = await authenticated_client.delete(
                "/api/workspaces/delete",
                params={"workspace_id": "nonexistent-123"},
            )

            assert response.status_code == 404

    async def test_delete_workspace_requires_workspace_id(self, authenticated_client):
        """Delete endpoint requires explicit workspace_id."""
        response = await authenticated_client.delete("/api/workspaces/delete")
        assert response.status_code == 422

    async def test_delete_workspace_rejects_blank_workspace_id(
        self, authenticated_client
    ):
        """Delete endpoint rejects empty workspace_id values."""
        response = await authenticated_client.delete(
            "/api/workspaces/delete",
            params={"workspace_id": "   "},
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "workspace_id is required"

    async def test_delete_workspace_targets_explicit_id_not_current(
        self, authenticated_client
    ):
        """Deleting workspace B should target B even when A is loaded."""
        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.delete_workspace"
            ) as mock_delete,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
        ):
            mock_current_entry.return_value = "workspace-a"
            mock_delete.return_value = True

            response = await authenticated_client.delete(
                "/api/workspaces/delete",
                params={"workspace_id": "workspace-b"},
            )

            assert response.status_code == 200
            mock_delete.assert_called_once_with("test", "workspace-b")

    async def test_download_workspace_zip(self, authenticated_client, tmp_path):
        """Workspace download kickoff submits a running background task."""
        workspace_dir = tmp_path / "ws1"
        workspace_dir.mkdir(parents=True)
        (workspace_dir / "metadata.json").write_text(
            json.dumps({"workspace_metadata": {"id": "ws-1", "name": "WS One"}}),
            encoding="utf-8",
        )
        data_dir = workspace_dir / "data"
        data_dir.mkdir()
        (data_dir / "sample.parquet").write_bytes(b"parquet-bytes")

        mock_task_info = MagicMock()
        mock_task_info.id = "task-download-123"

        mock_tm = AsyncMock()
        mock_tm.submit_task = AsyncMock(return_value=mock_task_info)

        mock_ws = MagicMock()
        mock_ws.name = "WS One"

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_id,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_workspace_dir"
            ) as mock_get_dir,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_get_ws,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_task_manager"
            ) as mock_get_tm,
        ):
            mock_current_entry.return_value = "ws-1"
            mock_current_id.return_value = None
            mock_get_dir.return_value = workspace_dir
            mock_get_ws.return_value = mock_ws
            mock_get_tm.return_value = mock_tm

            response = await authenticated_client.post("/api/workspaces/download")

            assert response.status_code == 200
            body = response.json()
            assert body["state"] == "running"
            assert body["metadata"]["task_id"] == "task-download-123"
            mock_get_tm.assert_called_once_with("test")
            mock_tm.submit_task.assert_called_once()

    async def test_download_workspace_artifact(self, authenticated_client, tmp_path):
        """Workspace artifact endpoint streams ZIP and deletes after download."""
        from ldaca_web_app_backend.core.worker_task_manager import TaskStatus

        artifact = tmp_path / "artifact.zip"
        artifact.write_bytes(b"PK-fake-zip-content")

        mock_task_info = MagicMock()
        mock_task_info.status = TaskStatus.SUCCESSFUL
        mock_task_info.workspace_id = "ws-1"
        mock_task_info.task_type = "workspace_download"
        mock_task_info.result = {
            "artifact_path": str(artifact),
            "filename": "WS_One.zip",
        }

        mock_tm = AsyncMock()
        mock_tm.get_task = AsyncMock(return_value=mock_task_info)

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_task_manager"
            ) as mock_get_tm,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
        ):
            mock_get_tm.return_value = mock_tm
            mock_current_entry.return_value = "ws-1"

            response = await authenticated_client.get(
                "/api/workspaces/download/tasks/task-123/artifact"
            )

            assert response.status_code == 200
            assert response.headers.get("content-type") == "application/zip"
            assert 'attachment; filename="WS_One.zip"' in response.headers.get(
                "content-disposition", ""
            )
            assert response.content == b"PK-fake-zip-content"
            # Artifact deleted after download
            assert not artifact.exists()
            mock_get_tm.assert_called_once_with("test")

    async def test_download_workspace_artifact_already_deleted(
        self, authenticated_client, tmp_path
    ):
        """Second artifact fetch returns 410 after first download deletes it."""
        from ldaca_web_app_backend.core.worker_task_manager import TaskStatus

        mock_task_info = MagicMock()
        mock_task_info.status = TaskStatus.SUCCESSFUL
        mock_task_info.workspace_id = "ws-1"
        mock_task_info.task_type = "workspace_download"
        mock_task_info.result = {
            "artifact_path": str(tmp_path / "gone.zip"),
            "filename": "WS_One.zip",
        }

        mock_tm = AsyncMock()
        mock_tm.get_task = AsyncMock(return_value=mock_task_info)

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_task_manager"
            ) as mock_get_tm,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
        ):
            mock_get_tm.return_value = mock_tm
            mock_current_entry.return_value = "ws-1"

            response = await authenticated_client.get(
                "/api/workspaces/download/tasks/task-123/artifact"
            )

            assert response.status_code == 410
            mock_get_tm.assert_called_once_with("test")

    async def test_upload_workspace_zip(self, authenticated_client, tmp_path):
        """Workspace upload ingests ZIP and writes workspace folder contents."""
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "metadata.json",
                json.dumps({
                    "workspace_metadata": {
                        "id": "imported-id",
                        "name": "Imported Workspace",
                    }
                }),
            )
            zf.writestr("data/example.parquet", b"fake-bytes")
        zip_buffer.seek(0)

        target_dir = tmp_path / "imported_workspace"

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.list_user_workspaces_summaries"
            ) as mock_summaries,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager._resolve_workspace_dir"
            ) as mock_resolve,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager._refresh_user_workspace_paths"
            ) as mock_refresh,
        ):
            mock_summaries.side_effect = [
                [],
                [
                    {
                        "id": "imported-id",
                        "name": "Imported Workspace",
                    }
                ],
            ]
            mock_resolve.return_value = target_dir
            mock_refresh.return_value = None

            response = await authenticated_client.post(
                "/api/workspaces/upload",
                files={
                    "file": ("workspace.zip", zip_buffer.getvalue(), "application/zip"),
                },
            )

            assert response.status_code == 200, response.text
            payload = response.json()
            assert payload.get("state") == "successful"
            assert payload["workspace"]["id"] == "imported-id"
            assert (target_dir / "metadata.json").exists()
            assert (target_dir / "data" / "example.parquet").exists()

    async def test_export_single_node_as_parquet(
        self,
        authenticated_client,
        tiny_node_id,
    ):
        """Single-node export should produce parquet bytes when parquet is requested."""
        response = await authenticated_client.get(
            "/api/workspaces/export",
            params={"node_ids": tiny_node_id, "format": "parquet"},
        )

        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "application/octet-stream"
        assert response.headers["content-disposition"].endswith(".parquet")

        exported = pl.read_parquet(io.BytesIO(response.content))
        assert exported.shape == (2, 1)
        assert exported.columns == ["document"]
        assert exported["document"].to_list() == ["Hello world.", "Another sentence."]

    async def test_export_single_node_as_csv_stringifies_nested_columns(
        self,
        authenticated_client,
        tiny_node_id,
    ):
        """CSV export should stringify unsupported nested column values."""
        from ldaca_web_app_backend.core.workspace import workspace_manager

        workspace = workspace_manager.get_current_workspace("test")
        node = workspace.nodes[tiny_node_id]
        node.data = pl.DataFrame(
            {
                "document": ["alpha", "beta"],
                "tags": [["one", "two"], ["three"]],
                "meta": [{"rank": 1}, {"rank": 2}],
            }
        ).lazy()

        response = await authenticated_client.get(
            "/api/workspaces/export",
            params={"node_ids": tiny_node_id, "format": "csv"},
        )

        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "text/csv; charset=utf-8"
        assert response.headers["content-disposition"].endswith(".csv")

        rows = list(DictReader(io.StringIO(response.text)))
        assert rows == [
            {"document": "alpha", "tags": "['one', 'two']", "meta": "{'rank': 1}"},
            {"document": "beta", "tags": "['three']", "meta": "{'rank': 2}"},
        ]

    async def test_export_multiple_nodes_as_parquet_zip(
        self,
        authenticated_client,
        tiny_node_id,
        sample_node_id,
    ):
        """Multi-node export should zip parquet artifacts rather than csv output."""
        response = await authenticated_client.get(
            "/api/workspaces/export",
            params={
                "node_ids": f"{tiny_node_id},{sample_node_id}",
                "format": "parquet",
            },
        )

        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "application/zip"
        assert response.headers["content-disposition"].endswith(".zip")

        with zipfile.ZipFile(io.BytesIO(response.content), "r") as archive:
            names = sorted(archive.namelist())
            assert len(names) == 2
            assert all(name.endswith(".parquet") for name in names)
            assert not any(name.endswith(".csv") for name in names)

            exported_shapes = sorted(
                pl.read_parquet(io.BytesIO(archive.read(name))).shape for name in names
            )

        assert exported_shapes == [(2, 1), (4, 1)]

    async def test_unload_workspace(self, authenticated_client):
        """Test unloading an existing workspace"""
        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.unload_workspace"
            ) as mock_unload,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
        ):
            mock_unload.return_value = True
            mock_current_entry.return_value = "workspace-123"
            response = await authenticated_client.post("/api/workspaces/unload")
            assert response.status_code == 200
            data = response.json()
            assert data.get("state") == "successful"
            assert data["id"] == "workspace-123"
            mock_unload.assert_called_once_with("test", "workspace-123", save=True)

    async def test_unload_workspace_not_found(self, authenticated_client):
        """Test unloading non-existent workspace returns 404"""
        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.unload_workspace"
            ) as mock_unload,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
        ):
            mock_unload.return_value = False
            mock_current_entry.return_value = "missing-999"
            response = await authenticated_client.post("/api/workspaces/unload")
            assert response.status_code == 404

    async def test_cast_node_datetime(self, authenticated_client):
        """Test casting a column to datetime type"""
        import polars as pl

        # Create mock node with test data (use ISO format that Polars can auto-parse)
        mock_node = Mock()
        test_df = pl.DataFrame({
            "created_at": ["2024-01-01T10:30:15", "2024-01-02T14:45:30"],
            "name": ["Alice", "Bob"],
        })
        mock_node.data = test_df.lazy()

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
            patch("docworkspace.workspace.core.Workspace.save") as mock_save,
        ):
            mock_workspace = Mock()
            mock_workspace.name = "test-workspace"
            mock_workspace.nodes = {"test-node": mock_node}
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace

            # Test without format string (auto-detection)
            cast_data = {"column": "created_at", "target_type": "datetime"}

            response = await authenticated_client.post(
                "/api/workspaces/nodes/test-node/cast", json=cast_data
            )

            assert response.status_code == 200
            response_data = response.json()

            # Verify response structure
            assert response_data.get("state") == "successful"
            assert response_data["node_id"] == "test-node"
            assert "cast_info" in response_data

            cast_info = response_data["cast_info"]
            assert cast_info["column"] == "created_at"
            assert cast_info["target_type"] == "datetime"
            assert cast_info["format_used"] is None  # No format used for auto-detection
            assert "original_type" in cast_info
            assert "new_type" in cast_info
            # Ensure UTC timezone applied (schema string contains UTC)
            assert "UTC" in cast_info["new_type"], (
                "Datetime cast should be timezone-aware UTC"
            )

            # Verify the node data was updated (mock_node.data should be modified)
            assert mock_node.data is not None

    async def test_delete_node_column_delegates_to_node_drop(
        self, authenticated_client
    ):
        """Delete-column endpoint should delegate to Node.drop and return child info."""
        mock_node = Mock()
        dropped_node = Mock()
        dropped_node.info.return_value = {
            "id": "new-node-id",
            "name": "drop_original",
            "operation": "drop",
            "columns": ["text"],
        }
        mock_node.drop.return_value = dropped_node

        mock_workspace = Mock()
        mock_workspace.nodes = {"node-1": mock_node}

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
            patch(
                "ldaca_web_app_backend.api.workspaces.base.update_workspace"
            ) as mock_update,
        ):
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace
            mock_update.return_value = None

            response = await authenticated_client.delete(
                "/api/workspaces/nodes/node-1/columns/value"
            )

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == "new-node-id"
        mock_node.drop.assert_called_once_with("value")

    async def test_delete_node_column_missing_node_returns_404(
        self, authenticated_client
    ):
        """Delete-column endpoint should return 404 for unknown node id."""
        mock_workspace = Mock()
        mock_workspace.nodes = {}

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
        ):
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace

            response = await authenticated_client.delete(
                "/api/workspaces/nodes/missing-node/columns/value"
            )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    async def test_rename_node_column_delegates_to_node_rename(
        self, authenticated_client
    ):
        """Rename endpoint should delegate to in-place Node.rename and return node info."""
        mock_node = Mock()
        mock_node.info.return_value = {
            "id": "node-1",
            "name": "rename_original",
            "operation": "rename",
            "columns": ["renamed_col"],
        }
        mock_node.rename.return_value = mock_node

        mock_workspace = Mock()
        mock_workspace.nodes = {"node-1": mock_node}

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
            patch(
                "ldaca_web_app_backend.api.workspaces.base.update_workspace"
            ) as mock_update,
        ):
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace
            mock_update.return_value = None

            response = await authenticated_client.put(
                "/api/workspaces/nodes/node-1/columns/original_col",
                json={"new_name": "renamed_col"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == "node-1"
        mock_node.rename.assert_called_once_with({"original_col": "renamed_col"})

    async def test_rename_node_column_missing_node_returns_404(
        self, authenticated_client
    ):
        """Rename endpoint should return 404 for unknown node id."""
        mock_workspace = Mock()
        mock_workspace.nodes = {}

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
        ):
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace

            response = await authenticated_client.put(
                "/api/workspaces/nodes/missing-node/columns/original_col",
                json={"new_name": "renamed_col"},
            )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    async def test_cast_node_not_found(self, authenticated_client):
        """Test casting when node doesn't exist"""
        from fastapi import HTTPException

        class _NodesRaising404(dict):
            def __getitem__(self, key):
                raise HTTPException(status_code=404, detail="Node not found")

        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
        ) as mock_current_entry:
            mock_workspace = Mock()
            mock_workspace.nodes = _NodesRaising404()
            mock_current_entry.return_value = "workspace-123"
            with patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace",
                return_value=mock_workspace,
            ):
                cast_data = {"column": "test_column", "target_type": "string"}

                response = await authenticated_client.post(
                    "/api/workspaces/nodes/nonexistent-node/cast",
                    json=cast_data,
                )

                assert response.status_code == 404
                assert "Node not found" in response.json()["detail"]

    async def test_cast_node_invalid_column(self, authenticated_client):
        """Test casting when column doesn't exist"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"existing_col": [1, 2, 3]}).lazy()

        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
        ) as mock_current_entry:
            mock_workspace = Mock()
            mock_workspace.nodes = {"test-node": mock_node}
            mock_current_entry.return_value = "workspace-123"
            with patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace",
                return_value=mock_workspace,
            ):
                cast_data = {"column": "nonexistent_column", "target_type": "string"}

                response = await authenticated_client.post(
                    "/api/workspaces/nodes/test-node/cast", json=cast_data
                )

                assert response.status_code == 400
                assert (
                    "Column 'nonexistent_column' not found" in response.json()["detail"]
                )

    async def test_cast_node_invalid_request_data(self, authenticated_client):
        """Test casting with invalid request data"""
        # Test missing required fields
        response = await authenticated_client.post(
            "/api/workspaces/nodes/test-node/cast",
            json={"column": "test_col"},  # Missing target_type
        )

        assert response.status_code == 400
        assert (
            "must contain 'column' and 'target_type' keys" in response.json()["detail"]
        )

    async def test_cast_node_preserves_data_type(self, authenticated_client):
        """Test that casting preserves the original lazy data type."""
        import polars as pl

        # Test with LazyFrame
        mock_node_lazy = Mock()
        test_lazy_df = pl.DataFrame({
            "created_at": ["2024-01-01T10:30:15", "2024-01-02T14:45:30"],
            "name": ["Alice", "Bob"],
        }).lazy()
        mock_node_lazy.data = test_lazy_df

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
            patch("docworkspace.workspace.core.Workspace.save"),
        ):
            mock_workspace = Mock()
            mock_workspace.name = "test-workspace"
            mock_workspace.nodes = {"test-node": mock_node_lazy}
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace

            cast_data = {"column": "created_at", "target_type": "datetime"}

            response = await authenticated_client.post(
                "/api/workspaces/nodes/test-node/cast", json=cast_data
            )

            # Debug: print response if not 200
            if response.status_code != 200:
                print(f"Response status: {response.status_code}")
                print(f"Response data: {response.json()}")

            assert response.status_code == 200

            # Verify that the node's data is still a LazyFrame after casting
            # The implementation should preserve the original type
            assert hasattr(mock_node_lazy.data, "collect"), (
                "LazyFrame should be preserved"
            )
            assert hasattr(mock_node_lazy.data, "collect_schema"), (
                "LazyFrame should have collect_schema"
            )

            # Verify the cast was successful
            response_data = response.json()
            assert response_data.get("state") == "successful"
            assert response_data["cast_info"]["column"] == "created_at"

    async def test_cast_node_preserves_document_column(self, authenticated_client):
        """LazyFrame nodes preserve document column after casting."""
        import polars as pl

        mock_node = Mock()
        mock_node.document = "text"
        lazy_data = pl.DataFrame({
            "text": ["doc one", "doc two"],
            "score": ["1", "2"],
        }).lazy()
        mock_node.data = lazy_data

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
            patch("docworkspace.workspace.core.Workspace.save") as mock_save,
        ):
            mock_workspace = Mock()
            mock_workspace.name = "test-workspace"
            mock_workspace.nodes = {"test-node": mock_node}
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace

            cast_data = {"column": "score", "target_type": "integer"}
            response = await authenticated_client.post(
                "/api/workspaces/nodes/test-node/cast", json=cast_data
            )

            assert response.status_code == 200
            payload = response.json()
            assert payload.get("state") == "successful"
            assert getattr(mock_node, "document", None) == "text"

    async def test_cast_node_datetime_to_string(self, authenticated_client):
        """Test casting datetime column to string"""
        from datetime import datetime

        import polars as pl

        mock_node = Mock()
        test_df = pl.DataFrame({
            "created_at": [
                datetime(2024, 1, 1, 10, 30, 15),
                datetime(2024, 1, 2, 14, 45, 30),
            ],
            "name": ["Alice", "Bob"],
        })
        mock_node.data = test_df.lazy()

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
            patch("docworkspace.workspace.core.Workspace.save") as mock_save,
        ):
            mock_workspace = Mock()
            mock_workspace.name = "test-workspace"
            mock_workspace.nodes = {"test-node": mock_node}
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace

            cast_data = {"column": "created_at", "target_type": "string"}
            response = await authenticated_client.post(
                "/api/workspaces/nodes/test-node/cast", json=cast_data
            )
            assert response.status_code == 200
            data = response.json()
            assert data.get("state") == "successful"
            assert data["cast_info"]["target_type"] == "string"

    async def test_cast_node_integer_type(self, authenticated_client):
        """Test casting to integer type"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"test_col": ["1", "2", "3"]}).lazy()

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
            patch("docworkspace.workspace.core.Workspace.save") as mock_save,
        ):
            mock_workspace = Mock()
            mock_workspace.name = "test-workspace"
            mock_workspace.nodes = {"test-node": mock_node}
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace

            cast_data = {"column": "test_col", "target_type": "integer"}
            response = await authenticated_client.post(
                "/api/workspaces/nodes/test-node/cast", json=cast_data
            )

            if response.status_code != 200:
                print(f"Error response: {response.json()}")

            assert response.status_code == 200
            data = response.json()
            assert data.get("state") == "successful"
            assert data["cast_info"]["target_type"] == "integer"

    async def test_cast_node_float_type(self, authenticated_client):
        """Test casting to float type"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"test_col": ["1.5", "2.7", "3.14"]}).lazy()

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
            patch("docworkspace.workspace.core.Workspace.save") as mock_save,
        ):
            mock_workspace = Mock()
            mock_workspace.name = "test-workspace"
            mock_workspace.nodes = {"test-node": mock_node}
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace

            cast_data = {"column": "test_col", "target_type": "float"}
            response = await authenticated_client.post(
                "/api/workspaces/nodes/test-node/cast", json=cast_data
            )
            assert response.status_code == 200
            data = response.json()
            assert data["cast_info"]["target_type"] == "float"

    async def test_cast_node_categorical_type(self, authenticated_client):
        """Test casting to categorical type"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"label": ["A", "B", "A"]}).lazy()

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
            ) as mock_current_entry,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace"
            ) as mock_current_ws,
            patch("docworkspace.workspace.core.Workspace.save") as mock_save,
        ):
            mock_workspace = Mock()
            mock_workspace.name = "test-workspace"
            mock_workspace.nodes = {"test-node": mock_node}
            mock_current_entry.return_value = "workspace-123"
            mock_current_ws.return_value = mock_workspace

            cast_data = {"column": "label", "target_type": "categorical"}
            response = await authenticated_client.post(
                "/api/workspaces/nodes/test-node/cast", json=cast_data
            )

            assert response.status_code == 200
            data = response.json()
            assert data.get("state") == "successful"
            assert data["cast_info"]["target_type"] == "categorical"
            assert "Categorical" in data["cast_info"].get("new_type", "")

    async def test_unique_values_endpoint_returns_full_set(self, authenticated_client):
        """Unique values endpoint returns all values and null metadata"""
        import polars as pl

        source_df = pl.DataFrame({"category": ["alpha", "beta", "alpha", None]}).lazy()

        class DummyNode:
            def __init__(self):
                self.data = source_df

        with patch(
            "ldaca_web_app_backend.api.workspaces.nodes.workspace_manager.get_current_workspace"
        ) as mock_active_ws:
            mock_workspace = Mock()
            mock_workspace.nodes = {"test-node": DummyNode()}
            mock_active_ws.return_value = mock_workspace

            response = await authenticated_client.get(
                "/api/workspaces/nodes/test-node/columns/category/unique"
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["column_name"] == "category"
        assert payload["unique_count"] == 3
        assert sorted(payload["unique_values"]) == ["alpha", "beta"]
        assert payload["has_null"] is True

    async def test_unique_values_endpoint_flattens_list_string_values(
        self, authenticated_client
    ):
        """String-list columns return flattened unique string elements."""
        import polars as pl

        source_df = pl.DataFrame({
            "topic": [["a", "b"], ["b", "c"], None, [], ["d"]]
        }).lazy()

        class DummyNode:
            def __init__(self):
                self.data = source_df

        with patch(
            "ldaca_web_app_backend.api.workspaces.nodes.workspace_manager.get_current_workspace"
        ) as mock_active_ws:
            mock_workspace = Mock()
            mock_workspace.nodes = {"test-node": DummyNode()}
            mock_active_ws.return_value = mock_workspace

            response = await authenticated_client.get(
                "/api/workspaces/nodes/test-node/columns/topic/unique"
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["column_name"] == "topic"
        assert payload["unique_values"] == ["a", "b", "c", "d"]
        assert payload["has_null"] is True
        assert payload["unique_count"] == 5

    async def test_cast_node_unsupported_type(self, authenticated_client):
        """Test that unsupported casting types raise errors"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"test_col": [1, 2, 3]}).lazy()

        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace_id"
        ) as mock_current_entry:
            mock_workspace = Mock()
            mock_workspace.nodes = {"test-node": mock_node}
            mock_current_entry.return_value = "workspace-123"
            with patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace",
                return_value=mock_workspace,
            ):
                cast_data = {"column": "test_col", "target_type": "unsupported_type"}
                response = await authenticated_client.post(
                    "/api/workspaces/nodes/test-node/cast", json=cast_data
                )
                assert response.status_code == 400
                response_detail = response.json()["detail"]
                assert "not yet supported" in response_detail

    async def test_join_nodes_success(self, authenticated_client):
        """Test successful node joining with the updated parameter format"""
        import polars as pl

        # Create test nodes
        left_node = Mock()
        left_node.data = pl.DataFrame({
            "username": ["alice", "bob"],
            "left_data": [1, 2],
        }).lazy()
        left_node.name = "left_node"

        right_node = Mock()
        right_node.data = pl.DataFrame({
            "username": ["alice", "bob"],
            "right_data": [10, 20],
        }).lazy()
        right_node.name = "right_node"

        # Mock joined result node
        joined_node = Mock()
        joined_node.info.return_value = {
            "node_id": "joined-node-id",
            "name": "left_node_join_right_node",
            "type": "data",
        }

        mock_workspace = Mock()
        mock_workspace.nodes = {
            "left-node-id": left_node,
            "right-node-id": right_node,
        }
        mock_workspace.add_node = Mock()

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace",
                return_value=mock_workspace,
            ),
            patch(
                "ldaca_web_app_backend.api.workspaces.nodes.Node",
                return_value=joined_node,
            ),
            patch(
                "ldaca_web_app_backend.api.workspaces.nodes.update_workspace",
                return_value=None,
            ),
        ):
            # Test join with the new parameter format (matching frontend)
            response = await authenticated_client.post(
                "/api/workspaces/nodes/join",
                params={
                    "left_node_id": "left-node-id",
                    "right_node_id": "right-node-id",
                    "left_on": "username",
                    "right_on": "username",
                    "how": "inner",
                },
            )

            assert response.status_code == 200
            result = response.json()
            # Endpoint now returns node info directly (no {success,node} wrapper)
            assert isinstance(result, dict)
            assert result.get("name") == "left_node_join_right_node"

    async def test_join_nodes_missing_parameters(self, authenticated_client):
        """Test join endpoint validation with missing required parameters"""
        # Missing 'right_on' parameter - should get 422 validation error
        response = await authenticated_client.post(
            "/api/workspaces/nodes/join",
            params={
                "left_node_id": "left-node-id",
                "right_node_id": "right-node-id",
                "left_on": "username",
                "how": "inner",
                # Missing "right_on" parameter
            },
        )

        # Should get FastAPI validation error
        assert response.status_code == 422
        assert "field required" in response.json()["detail"][0]["msg"].lower()

    async def test_join_preview_handles_absolute_paths(
        self, authenticated_client, tmp_path
    ):
        """Join preview should work without relying on workspace cwd hacks."""

        import polars as pl

        workspace_dir = tmp_path / "workspace"
        data_dir = workspace_dir / "data"
        data_dir.mkdir(parents=True)

        left_df = pl.DataFrame({"user_id": [1, 2], "left_value": ["a", "b"]})
        right_df = pl.DataFrame({"user_id": [1, 2], "right_value": [10, 20]})

        left_df.write_parquet(data_dir / "left.parquet")
        right_df.write_parquet(data_dir / "right.parquet")

        left_lazy = pl.scan_parquet(data_dir / "left.parquet")
        right_lazy = pl.scan_parquet(data_dir / "right.parquet")

        class DummyNode:
            def __init__(self, data, name):
                self.data = data
                self.name = name

        left_node = DummyNode(left_lazy, "left_node")
        right_node = DummyNode(right_lazy, "right_node")
        mock_workspace = Mock()
        mock_workspace.nodes = {
            "left-node-id": left_node,
            "right-node-id": right_node,
        }

        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_current_workspace",
            return_value=mock_workspace,
        ):
            response = await authenticated_client.post(
                "/api/workspaces/nodes/join/preview",
                params={
                    "left_node_id": "left-node-id",
                    "right_node_id": "right-node-id",
                    "left_on": "user_id",
                    "right_on": "user_id",
                    "how": "inner",
                    "page": 1,
                    "page_size": 5,
                },
            )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["pagination"]["total_rows"] == 2
        assert [row["left_value"] for row in payload["data"]] == ["a", "b"]
