"""
Integration tests for workspace API endpoints
"""

from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.mark.integration
@pytest.mark.workspace
class TestWorkspaceAPI:
    """Test cases for workspace management endpoints"""

    @pytest.fixture(autouse=True)
    def setup_client(self, authenticated_client):
        """Set up test client with authentication"""
        self.client = authenticated_client

    def test_list_workspaces_empty(self):
        """Test listing workspaces when user has none"""
        with patch("api.workspaces.workspace_manager.list_user_workspaces") as mock_get:
            mock_get.return_value = {}

            response = self.client.get("/api/workspaces/")

            assert response.status_code == 200
            data = response.json()
            assert len(data["workspaces"]) == 0

    def test_list_workspaces_with_data(self):
        """Test listing workspaces when user has workspaces"""
        # Create mock workspace object that behaves like ATAPWorkspace
        mock_workspace = Mock()
        mock_workspace.name = "Test Workspace 1"
        mock_workspace.summary.return_value = {
            "total_nodes": 1,
            "root_nodes": 1,
            "leaf_nodes": 1,
            "node_types": {"DataFrame": 1},
        }
        mock_workspace.get_metadata.side_effect = lambda key: {
            "description": "Test description",
            "created_at": "2024-01-01T00:00:00Z",
            "modified_at": "2024-01-01T12:00:00Z",
        }.get(key, "")

        mock_workspaces = {"workspace-1": mock_workspace}

        with patch("api.workspaces.workspace_manager.list_user_workspaces") as mock_get:
            mock_get.return_value = mock_workspaces

            response = self.client.get("/api/workspaces/")

            assert response.status_code == 200
            data = response.json()
            assert len(data["workspaces"]) == 1
            workspace = data["workspaces"][0]
            assert workspace["workspace_id"] == "workspace-1"
            assert workspace["name"] == "Test Workspace 1"
            assert (
                workspace["node_count"] == 1
            )  # Updated to use latest ATAPWorkspace terminology

    def test_create_workspace(self):
        """Test creating a new workspace"""
        # Create mock workspace object that behaves like ATAPWorkspace
        mock_workspace = Mock()
        mock_workspace.get_metadata.side_effect = lambda key: {
            "id": "new-workspace-123",
            "description": "New test workspace",
            "created_at": "2024-01-01T00:00:00Z",
            "modified_at": "2024-01-01T00:00:00Z",
        }.get(key, "")

        # Mock workspace_manager methods for create flow
        with (
            patch("api.workspaces.workspace_manager.create_workspace") as mock_create,
            patch("api.workspaces.workspace_manager.get_workspace_info") as mock_info,
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

            response = self.client.post("/api/workspaces/", json=payload)

            assert response.status_code == 200
            data = response.json()
            assert data["workspace_id"] == "new-workspace-123"
            assert data["name"] == "New Workspace"
            assert data["description"] == "New test workspace"
            assert data["total_nodes"] == 0  # Use latest ATAPWorkspace terminology

    def test_get_workspace_info(self):
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

        with patch("api.workspaces.workspace_manager.get_workspace_info") as mock_get:
            mock_get.return_value = mock_workspace_info

            # Use the cleaner endpoint: GET /api/workspaces/{workspace_id}
            response = self.client.get("/api/workspaces/workspace-123")

            assert response.status_code == 200
            data = response.json()
            assert data["workspace_id"] == "workspace-123"
            assert data["name"] == "Test Workspace"
            assert data["total_nodes"] == 5  # Latest ATAPWorkspace terminology

    def test_get_workspace_not_found(self):
        """Test getting non-existent workspace"""
        with patch("api.workspaces.workspace_manager.get_workspace_info") as mock_get:
            mock_get.return_value = None

            # Use the cleaner endpoint: GET /api/workspaces/{workspace_id}
            response = self.client.get("/api/workspaces/nonexistent-123")

            assert response.status_code == 404

    def test_delete_workspace(self):
        """Test deleting a workspace"""
        with patch("api.workspaces.workspace_manager.delete_workspace") as mock_delete:
            mock_delete.return_value = True

            response = self.client.delete("/api/workspaces/workspace-123")

            assert response.status_code == 200
            data = response.json()
            assert data["message"] == "Workspace workspace-123 deleted successfully"
            assert data["success"] is True

    def test_delete_workspace_not_found(self):
        """Test deleting non-existent workspace"""
        with patch("api.workspaces.workspace_manager.delete_workspace") as mock_delete:
            mock_delete.return_value = False

            response = self.client.delete("/api/workspaces/nonexistent-123")

            assert response.status_code == 404

    def test_upload_data_file(self):
        """Test uploading and creating a node from a data file"""
        import os
        import tempfile

        # Create a real temporary CSV file for testing
        test_csv_content = """id,name,content
1,Document 1,This is the first document content for testing
2,Document 2,This is the second document with more content  
3,Document 3,A third document with different content for variety
"""

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as tmp_file:
            tmp_file.write(test_csv_content)
            tmp_file_path = tmp_file.name

        try:
            # Mock the workspace manager methods for the upload flow
            mock_node = Mock()
            mock_node.info.return_value = {
                "id": "uploaded-node-123",
                "name": "test_data",
                "dtype": "polars.DataFrame",
                "shape": (3, 3),
                "lazy": False,
                "columns": ["id", "name", "content"],
                "schema": {"id": "Int64", "name": "Utf8", "content": "Utf8"},
            }

            with patch(
                "api.workspaces.workspace_manager.add_node_to_workspace"
            ) as mock_add:
                mock_add.return_value = mock_node

                # Prepare the file upload
                with open(tmp_file_path, "rb") as test_file:
                    files = {"file": ("test_data.csv", test_file, "text/csv")}

                    # Use the correct upload endpoint with node_name as a query param
                    response = self.client.post(
                        "/api/workspaces/test-workspace-123/upload?node_name=test_data",
                        files=files,
                    )

                assert response.status_code == 200
                response_data = response.json()
                assert response_data["success"] is True
                assert "message" in response_data
                assert "node" in response_data
                assert response_data["node"]["name"] == "test_data"

                # Verify the workspace manager was called correctly
                mock_add.assert_called_once()
                call_args = mock_add.call_args
                # The API uses node_name if provided, otherwise defaults to filename
                expected_name = "test_data"  # We provide node_name in form data
                assert call_args[1]["node_name"] == expected_name
                assert call_args[1]["workspace_id"] == "test-workspace-123"

        finally:
            # Clean up the temporary file
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)

    def test_cast_node_datetime(self):
        """Test casting a column to datetime type"""
        import polars as pl

        # Create mock node with test data (use ISO format that Polars can auto-parse)
        mock_node = Mock()
        test_df = pl.DataFrame(
            {
                "created_at": ["2024-01-01T10:30:15", "2024-01-02T14:45:30"],
                "name": ["Alice", "Bob"],
            }
        )
        mock_node.data = test_df

        with (
            patch(
                "api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch(
                "api.workspaces.workspace_manager._save_workspace_to_disk"
            ) as mock_save,
            patch(
                "api.workspaces.workspace_manager.get_workspace"
            ) as mock_get_workspace,
        ):
            mock_get_node.return_value = mock_node
            mock_get_workspace.return_value = Mock()  # Mock workspace for saving

            # Test without format string (auto-detection)
            cast_data = {"column": "created_at", "target_type": "datetime"}

            response = self.client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
            )

            assert response.status_code == 200
            response_data = response.json()

            # Verify response structure
            assert response_data["success"] is True
            assert response_data["node_id"] == "test-node"
            assert "cast_info" in response_data

            cast_info = response_data["cast_info"]
            assert cast_info["column"] == "created_at"
            assert cast_info["target_type"] == "datetime"
            assert cast_info["format_used"] is None  # No format used for auto-detection
            assert "original_type" in cast_info
            assert "new_type" in cast_info

            # Verify the node data was updated (mock_node.data should be modified)
            assert mock_node.data is not None
            mock_save.assert_called_once()

    def test_cast_node_not_found(self):
        """Test casting when node doesn't exist"""
        with patch(
            "api.workspaces.workspace_manager.get_node_from_workspace"
        ) as mock_get_node:
            mock_get_node.return_value = None

            cast_data = {"column": "test_column", "target_type": "string"}

            response = self.client.post(
                "/api/workspaces/test-workspace/nodes/nonexistent-node/cast",
                json=cast_data,
            )

            assert response.status_code == 404
            assert "Node not found" in response.json()["detail"]

    def test_cast_node_invalid_column(self):
        """Test casting when column doesn't exist"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"existing_col": [1, 2, 3]})

        with patch(
            "api.workspaces.workspace_manager.get_node_from_workspace"
        ) as mock_get_node:
            mock_get_node.return_value = mock_node

            cast_data = {"column": "nonexistent_column", "target_type": "string"}

            response = self.client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
            )

            assert response.status_code == 400
            assert "Column 'nonexistent_column' not found" in response.json()["detail"]

    def test_cast_node_invalid_request_data(self):
        """Test casting with invalid request data"""
        # Test missing required fields
        response = self.client.post(
            "/api/workspaces/test-workspace/nodes/test-node/cast",
            json={"column": "test_col"},  # Missing target_type
        )

        assert response.status_code == 400
        assert (
            "must contain 'column' and 'target_type' keys" in response.json()["detail"]
        )

    def test_cast_node_preserves_data_type(self):
        """Test that casting preserves the original data type (DocDataFrame stays DocDataFrame, etc.)"""
        import polars as pl

        # Test with LazyFrame
        mock_node_lazy = Mock()
        test_lazy_df = pl.DataFrame(
            {
                "created_at": ["2024-01-01T10:30:15", "2024-01-02T14:45:30"],
                "name": ["Alice", "Bob"],
            }
        ).lazy()
        mock_node_lazy.data = test_lazy_df

        with (
            patch(
                "api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch("api.workspaces.workspace_manager._save_workspace_to_disk"),
            patch(
                "api.workspaces.workspace_manager.get_workspace"
            ) as mock_get_workspace,
        ):
            mock_get_node.return_value = mock_node_lazy
            mock_get_workspace.return_value = Mock()

            cast_data = {"column": "created_at", "target_type": "datetime"}

            response = self.client.post(
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
            assert response_data["success"] is True
            assert response_data["cast_info"]["column"] == "created_at"

    def test_cast_node_unsupported_type(self):
        """Test that unsupported casting types raise appropriate errors"""
        import polars as pl

        mock_node = Mock()
        mock_node.data = pl.DataFrame({"test_col": [1, 2, 3]})

        with patch(
            "api.workspaces.workspace_manager.get_node_from_workspace"
        ) as mock_get_node:
            mock_get_node.return_value = mock_node

            # Test unsupported casting type
            cast_data = {
                "column": "test_col",
                "target_type": "string",  # This should now be unsupported
            }

            response = self.client.post(
                "/api/workspaces/test-workspace/nodes/test-node/cast", json=cast_data
            )

            assert response.status_code == 400
            response_detail = response.json()["detail"]
            assert "not yet supported" in response_detail
            assert "Currently only 'datetime' casting is implemented" in response_detail

    def test_join_nodes_success(self):
        """Test successful node joining with the updated parameter format"""
        import polars as pl

        # Create test nodes
        left_node = Mock()
        left_node.data = pl.DataFrame(
            {"username": ["alice", "bob"], "left_data": [1, 2]}
        )
        left_node.name = "left_node"

        right_node = Mock()
        right_node.data = pl.DataFrame(
            {"username": ["alice", "bob"], "right_data": [10, 20]}
        )
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
                "api.workspaces.workspace_manager.get_node_from_workspace"
            ) as mock_get_node,
            patch(
                "api.workspaces.workspace_manager.add_node_to_workspace",
                return_value=joined_node,
            ),
            patch(
                "api.workspaces.workspace_manager.execute_safe_operation"
            ) as mock_safe_op,
        ):
            # Configure node retrieval
            def get_node_side_effect(use_id, workspace_id, node_id):
                if node_id == "left-node-id":
                    return left_node
                elif node_id == "right-node-id":
                    return right_node
                return None

            mock_get_node.side_effect = get_node_side_effect
            mock_safe_op.return_value = {"success": True, "node": joined_node.info()}

            # Test join with the new parameter format (matching frontend)
            response = self.client.post(
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
            assert result["success"] is True
            assert "node" in result

    def test_join_nodes_missing_parameters(self):
        """Test join endpoint validation with missing required parameters"""
        # Missing 'right_on' parameter - should get 422 validation error
        response = self.client.post(
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
