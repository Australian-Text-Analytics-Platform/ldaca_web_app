"""
Integration tests for workspace API endpoints
"""

from pathlib import Path
from unittest.mock import Mock, patch

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
            mock_get.return_value = {}
            response = await authenticated_client.get("/api/workspaces/")
            if response.status_code != 200:
                pytest.fail(response.text)
            data = response.json()
            assert data["workspaces"] == []

    async def test_list_workspaces_with_data(self, authenticated_client):
        """Test listing workspaces when user has workspaces"""
        mock_summaries = {
            "abc123": {
                "workspace_id": "abc123",
                "name": "Test Workspace 1",
                "description": "Test description",
                "created_at": "2024-01-01T00:00:00Z",
                "modified_at": "2024-01-01T12:00:00Z",
                "node_count": 1,
                "root_nodes": 1,
                "leaf_nodes": 1,
                "node_types": {"DataFrame": 1},
            }
        }
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.list_user_workspaces_summaries"
        ) as mock_get:
            mock_get.return_value = mock_summaries
            response = await authenticated_client.get("/api/workspaces/")
            assert response.status_code == 200
            data = response.json()
            assert len(data["workspaces"]) == 1
            workspace = data["workspaces"][0]
            assert workspace["workspace_id"] == "abc123"
            assert workspace["node_count"] == 1

    async def test_create_workspace(self, authenticated_client):
        """Test creating a new workspace"""
        # Create mock workspace object that behaves like docworkspace
        mock_workspace = Mock()
        mock_workspace.get_metadata.side_effect = lambda key: {
            "id": "new-workspace-123",
            "description": "New test workspace",
            "created_at": "2024-01-01T00:00:00Z",
            "modified_at": "2024-01-01T00:00:00Z",
        }.get(key, "")
        mock_workspace.id = "new-workspace-123"

        # Mock workspace_manager methods for create flow
        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.create_workspace"
            ) as mock_create,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_workspace_info"
            ) as mock_info,
        ):
            mock_create.return_value = mock_workspace
            mock_info.return_value = {
                "workspace_id": "new-workspace-123",
                "name": "New Workspace",
                "description": "New test workspace",
                "created_at": "2024-01-01T00:00:00Z",
                "modified_at": "2024-01-01T00:00:00Z",
                "total_nodes": 0,
            }

            payload = {"name": "New Workspace", "description": "New test workspace"}

            response = await authenticated_client.post("/api/workspaces/", json=payload)

            assert response.status_code == 200
            data = response.json()
            assert data["workspace_id"] == "new-workspace-123"
            assert data["name"] == "New Workspace"
            assert data["description"] == "New test workspace"
            assert data["total_nodes"] == 0  # Use latest docworkspace terminology

    async def test_get_workspace_info(self, authenticated_client):
        """Test getting specific workspace information"""
        # Mock workspace_manager.get_workspace_info to return proper data
        mock_workspace_info = {
            "workspace_id": "workspace-123",
            "name": "Test Workspace",
            "description": "Test description",
            "created_at": "2024-01-01T00:00:00Z",
            "modified_at": "2024-01-01T12:00:00Z",
            "total_nodes": 5,
            "root_nodes": 2,
            "leaf_nodes": 3,
            "node_types": {"DataFrame": 3, "LazyFrame": 2},
            "status_counts": {"lazy": 1, "materialized": 4},
        }

        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_workspace_info"
        ) as mock_get:
            mock_get.return_value = mock_workspace_info

            # Use the cleaner endpoint: GET /api/workspaces/{workspace_id}
            response = await authenticated_client.get("/api/workspaces/workspace-123")

            assert response.status_code == 200
            data = response.json()
            assert data["workspace_id"] == "workspace-123"
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
            f"/api/workspaces/{workspace_id}/nodes/{tiny_node_id}/data",
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
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_workspace_info"
        ) as mock_get:
            mock_get.return_value = None

            # Use the cleaner endpoint: GET /api/workspaces/{workspace_id}
            response = await authenticated_client.get("/api/workspaces/nonexistent-123")

            assert response.status_code == 404

    async def test_delete_workspace(self, authenticated_client):
        """Test deleting a workspace"""
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.delete_workspace"
        ) as mock_delete:
            mock_delete.return_value = True

            response = await authenticated_client.delete(
                "/api/workspaces/workspace-123"
            )

            assert response.status_code == 200
            data = response.json()
            assert data["message"] == "Workspace workspace-123 deleted successfully"
            # Contract: success removed; deletion returns message only

    async def test_delete_workspace_not_found(self, authenticated_client):
        """Test deleting non-existent workspace"""
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.delete_workspace"
        ) as mock_delete:
            mock_delete.return_value = False

            response = await authenticated_client.delete(
                "/api/workspaces/nonexistent-123"
            )

            assert response.status_code == 404

    async def test_unload_workspace(self, authenticated_client):
        """Test unloading an existing workspace"""
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.unload_workspace"
        ) as mock_unload:
            mock_unload.return_value = True
            response = await authenticated_client.post(
                "/api/workspaces/workspace-123/unload"
            )
            assert response.status_code == 200
            data = response.json()
            assert data.get("state") == "successful"
            assert data["workspace_id"] == "workspace-123"
            mock_unload.assert_called_once_with("test", "workspace-123", save=True)

    async def test_unload_workspace_not_found(self, authenticated_client):
        """Test unloading non-existent workspace returns 404"""
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.unload_workspace"
        ) as mock_unload:
            mock_unload.return_value = False
            response = await authenticated_client.post(
                "/api/workspaces/missing-999/unload"
            )
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
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.persist"
            ) as mock_save,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_workspace"
            ) as mock_get_workspace,
        ):
            mock_get_node.return_value = mock_node
            mock_get_workspace.return_value = Mock()  # Mock workspace for saving

            # Test without format string (auto-detection)
            cast_data = {"column": "created_at", "target_type": "datetime"}

            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
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
            mock_save.assert_called_once()

    async def test_cast_node_not_found(self, authenticated_client):
        """Test casting when node doesn't exist"""
        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
        ) as mock_get_node:
            mock_get_node.return_value = None

            cast_data = {"column": "test_column", "target_type": "string"}

            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/nonexistent-node/cast",
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
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
        ) as mock_get_node:
            mock_get_node.return_value = mock_node

            cast_data = {"column": "nonexistent_column", "target_type": "string"}

            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
            )

            assert response.status_code == 400
            assert "Column 'nonexistent_column' not found" in response.json()["detail"]

    async def test_cast_node_invalid_request_data(self, authenticated_client):
        """Test casting with invalid request data"""
        # Test missing required fields
        response = await authenticated_client.post(
            "/api/workspaces/test-workspace/nodes/test-node/cast",
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
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch("ldaca_web_app_backend.api.workspaces.workspace_manager.persist"),
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_workspace"
            ) as mock_get_workspace,
        ):
            mock_get_node.return_value = mock_node_lazy
            mock_get_workspace.return_value = Mock()

            cast_data = {"column": "created_at", "target_type": "datetime"}

            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
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

    async def test_cast_node_preserves_text_column_metadata(self, authenticated_client):
        """LazyFrame nodes preserve text_column metadata after casting."""
        import polars as pl

        mock_node = Mock()
        mock_node.metadata = {"text_column": "text"}
        lazy_data = pl.DataFrame({
            "text": ["doc one", "doc two"],
            "score": ["1", "2"],
        }).lazy()
        mock_node.data = lazy_data

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.persist"
            ) as mock_save,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_workspace"
            ) as mock_get_workspace,
        ):
            mock_get_node.return_value = mock_node
            mock_get_workspace.return_value = Mock()

            cast_data = {"column": "score", "target_type": "integer"}
            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
            )

            assert response.status_code == 200
            payload = response.json()
            assert payload.get("state") == "successful"
            assert getattr(mock_node, "metadata", {}).get("text_column") == "text"
            mock_save.assert_called_once()

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
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.persist"
            ) as mock_save,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_workspace"
            ) as mock_get_workspace,
        ):
            mock_get_node.return_value = mock_node
            mock_get_workspace.return_value = Mock()

            cast_data = {"column": "created_at", "target_type": "string"}
            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
            )
            assert response.status_code == 200
            data = response.json()
            assert data.get("state") == "successful"
            assert data["cast_info"]["target_type"] == "string"
            mock_save.assert_called_once()

    async def test_cast_node_integer_type(self, authenticated_client):
        """Test casting to integer type"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"test_col": ["1", "2", "3"]}).lazy()

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.persist"
            ) as mock_save,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_workspace"
            ) as mock_get_workspace,
        ):
            mock_get_node.return_value = mock_node
            mock_get_workspace.return_value = Mock()  # Mock workspace for persist call

            cast_data = {"column": "test_col", "target_type": "integer"}
            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
            )

            if response.status_code != 200:
                print(f"Error response: {response.json()}")

            assert response.status_code == 200
            data = response.json()
            assert data.get("state") == "successful"
            assert data["cast_info"]["target_type"] == "integer"
            mock_save.assert_called_once()

    async def test_cast_node_float_type(self, authenticated_client):
        """Test casting to float type"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"test_col": ["1.5", "2.7", "3.14"]}).lazy()

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.persist"
            ) as mock_save,
        ):
            mock_get_node.return_value = mock_node

            cast_data = {"column": "test_col", "target_type": "float"}
            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
            )
            assert response.status_code == 200
            data = response.json()
            assert data["cast_info"]["target_type"] == "float"
            mock_save.assert_called_once()

    async def test_cast_node_categorical_type(self, authenticated_client):
        """Test casting to categorical type"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"label": ["A", "B", "A"]}).lazy()

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.persist"
            ) as mock_save,
        ):
            mock_get_node.return_value = mock_node

            cast_data = {"column": "label", "target_type": "categorical"}
            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
            )

            assert response.status_code == 200
            data = response.json()
            assert data.get("state") == "successful"
            assert data["cast_info"]["target_type"] == "categorical"
            assert "Categorical" in data["cast_info"].get("new_type", "")
            mock_save.assert_called_once()

    async def test_unique_values_endpoint_returns_full_set(self, authenticated_client):
        """Unique values endpoint returns all values and null metadata"""
        import polars as pl

        source_df = pl.DataFrame({"category": ["alpha", "beta", "alpha", None]}).lazy()

        class DummyNode:
            def __init__(self):
                self.data = source_df

        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
        ) as mock_get_node:
            mock_get_node.return_value = DummyNode()

            response = await authenticated_client.get(
                "/api/workspaces/test-workspace/nodes/test-node/columns/category/unique"
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["column_name"] == "category"
        assert payload["unique_count"] == 3
        assert sorted(payload["unique_values"]) == ["alpha", "beta"]
        assert payload["has_null"] is True

    async def test_cast_node_unsupported_type(self, authenticated_client):
        """Test that unsupported casting types raise errors"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"test_col": [1, 2, 3]}).lazy()

        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
        ) as mock_get_node:
            mock_get_node.return_value = mock_node

            cast_data = {"column": "test_col", "target_type": "unsupported_type"}
            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
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

        with (
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch(
                "ldaca_web_app_backend.api.workspaces.workspace_manager.add_node_to_workspace",
                return_value=joined_node,
            ),
        ):
            # Configure node retrieval
            def get_node_side_effect(use_id, workspace_id, node_id):
                if node_id == "left-node-id":
                    return left_node
                elif node_id == "right-node-id":
                    return right_node
                return None

            mock_get_node.side_effect = get_node_side_effect

            # Test join with the new parameter format (matching frontend)
            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/join",
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
            "/api/workspaces/test-workspace/nodes/join",
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

        with patch(
            "ldaca_web_app_backend.api.workspaces.workspace_manager.get_node_from_workspace"
        ) as mock_get_node:

            def _side_effect(_, __, node_id):
                if node_id == "left-node-id":
                    return left_node
                if node_id == "right-node-id":
                    return right_node
                return None

            mock_get_node.side_effect = _side_effect

            response = await authenticated_client.post(
                "/api/workspaces/test-workspace/nodes/join/preview",
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
