"""Tests for files-root LDaCA background task endpoints."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path):
    """Create a lightweight test client with mocked auth and settings."""
    with (
        patch("ldaca_web_app_backend.main.settings") as mock_settings,
        patch("ldaca_web_app_backend.main.init_db"),
        patch("ldaca_web_app_backend.main.cleanup_expired_sessions"),
        patch("ldaca_web_app_backend.core.utils.settings") as mock_utils_settings,
    ):
        mock_settings.debug = False
        mock_settings.cors_allow_origin_regex = r"http://localhost(:\\d+)?"
        mock_settings.cors_allow_credentials = True
        mock_settings.multi_user = True
        mock_settings.get_data_root.return_value = tmp_path
        mock_settings.get_user_data_folder.return_value = tmp_path / "users"
        mock_settings.get_sample_data_folder.return_value = tmp_path / "sample_data"
        mock_settings.get_database_backup_folder.return_value = tmp_path / "backups"
        mock_settings.user_data_folder = "users"

        mock_utils_settings.get_data_root.return_value = tmp_path
        mock_utils_settings.user_data_folder = "users"
        mock_utils_settings.multi_user = True

        (tmp_path / "users").mkdir(parents=True, exist_ok=True)
        (tmp_path / "sample_data").mkdir(parents=True, exist_ok=True)
        (tmp_path / "backups").mkdir(parents=True, exist_ok=True)

        app = __import__("ldaca_web_app_backend.main", fromlist=["app"]).app

        def fake_user():
            return {"id": "test_user"}

        from ldaca_web_app_backend.api import files as files_api

        app.dependency_overrides[files_api.get_current_user] = fake_user

        yield TestClient(app)

        app.dependency_overrides.clear()


def test_import_ldaca_starts_background_task_under_user_scope(client: TestClient):
    """Import should return running state and task metadata without blocking."""
    from ldaca_web_app_backend.api import files as files_api

    mock_tm = MagicMock()
    mock_tm.submit_task = AsyncMock(return_value=MagicMock(id="task-123"))

    with (
        patch.object(
            files_api.workspace_manager,
            "get_current_workspace_id",
            return_value=None,
        ),
        patch.object(
            files_api.workspace_manager,
            "get_task_manager",
            return_value=mock_tm,
        ) as get_task_manager,
    ):
        response = client.post(
            "/api/files/import-ldaca",
            json={"url": "https://example.org/dataset.zip"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["state"] == "running"
    assert payload["metadata"]["task_id"] == "task-123"
    get_task_manager.assert_called_once_with("test_user")
    mock_tm.submit_task.assert_awaited_once()


def test_import_ldaca_ignores_current_workspace_for_task_scope(client: TestClient):
    """LDaCA import must remain user-scoped even when a workspace is active."""
    from ldaca_web_app_backend.api import files as files_api

    mock_tm = MagicMock()
    mock_tm.submit_task = AsyncMock(return_value=MagicMock(id="task-456"))

    with (
        patch.object(
            files_api.workspace_manager,
            "get_current_workspace_id",
            return_value="workspace-should-not-be-used",
        ),
        patch.object(
            files_api.workspace_manager,
            "get_task_manager",
            return_value=mock_tm,
        ) as get_task_manager,
    ):
        response = client.post(
            "/api/files/import-ldaca",
            json={"url": "https://example.org/dataset.zip"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["state"] == "running"
    assert payload["metadata"]["task_id"] == "task-456"
    get_task_manager.assert_called_once_with("test_user")


def test_list_files_tasks_returns_user_scope_tasks(client: TestClient):
    """Files task listing should be filtered to user scope for the current user."""
    from ldaca_web_app_backend.api import files as files_api

    mock_user_tm = MagicMock()
    mock_user_tm.list = AsyncMock(
        return_value=[
            {
                "task_id": "task-abc",
                "state": "running",
                "task_type": "ldaca_import",
            }
        ]
    )
    with patch.object(
        files_api.workspace_manager,
        "get_task_manager",
        return_value=mock_user_tm,
    ):
        response = client.get("/api/files/tasks")

    assert response.status_code == 200
    payload = response.json()
    assert payload["state"] == "successful"
    assert payload["data"][0]["task_id"] == "task-abc"
    mock_user_tm.list.assert_awaited_once_with(user_id="test_user")
