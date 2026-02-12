"""
Tests for unified file preview endpoint
"""

from pathlib import Path
from unittest.mock import patch

import polars as pl
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path):
    """Create test client with mocked settings and user authentication"""
    # Patch settings and DB init to keep app lightweight
    with (
        patch("ldaca_web_app_backend.main.settings") as mock_settings,
        patch("ldaca_web_app_backend.main.init_db"),
        patch("ldaca_web_app_backend.main.cleanup_expired_sessions"),
        patch("ldaca_web_app_backend.core.utils.settings") as mock_utils_settings,
    ):
        # Configure main settings
        mock_settings.debug = False
        mock_settings.cors_allow_origin_regex = r"http://localhost(:\d+)?"
        mock_settings.cors_allow_credentials = True
        mock_settings.multi_user = True
        mock_settings.get_data_root.return_value = tmp_path
        mock_settings.get_user_data_folder.return_value = tmp_path / "users"
        mock_settings.get_sample_data_folder.return_value = tmp_path / "sample_data"
        mock_settings.get_database_backup_folder.return_value = tmp_path / "backups"
        mock_settings.user_data_folder = "users"

        # Configure utils settings (same instance)
        mock_utils_settings.get_data_root.return_value = tmp_path
        mock_utils_settings.user_data_folder = "users"
        mock_utils_settings.multi_user = True

        # Ensure required folders exist
        tmp_path.mkdir(parents=True, exist_ok=True)
        (tmp_path / "users").mkdir(parents=True, exist_ok=True)
        (tmp_path / "sample_data").mkdir(parents=True, exist_ok=True)
        (tmp_path / "backups").mkdir(parents=True, exist_ok=True)

        # Import app after settings are patched
        app = __import__("ldaca_web_app_backend.main", fromlist=["app"]).app

        # Mock auth dependency to return a fixed user
        def fake_user():
            return {"id": "test_user"}

        from ldaca_web_app_backend.api import files as files_api

        app.dependency_overrides[files_api.get_current_user] = fake_user

        # Ensure user data folder exists
        user_root = tmp_path / "users" / "user_test_user" / "user_data"
        user_root.mkdir(parents=True, exist_ok=True)

        yield TestClient(app)

        # Cleanup
        app.dependency_overrides.clear()


def test_csv_preview_supported_types_and_preview(client, tmp_path):
    """Test CSV file preview with pagination"""
    # Arrange: create CSV in user data
    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    csv_path = user_root / "sample.csv"
    pl.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]}).write_csv(csv_path)

    # Act
    resp = client.post(
        "/api/files/preview",
        json={"filename": "sample.csv", "page": 0, "page_size": 2},
    )

    # Assert
    assert resp.status_code == 200
    data = resp.json()
    assert data["file_type"] == "csv"
    assert "LazyFrame" in data["supported_types"]
    assert data["columns"] == ["a", "b"]
    assert len(data["preview"]) == 2


def test_zip_preview_returns_file_listing(client, tmp_path):
    """ZIP archives should return a file listing when multiple entries exist."""

    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    zip_path = user_root / "archive.zip"
    from zipfile import ZipFile

    with ZipFile(zip_path, "w") as zf:
        zf.writestr("a.txt", "hello")
        zf.writestr("b.txt", "world")

    resp = client.post(
        "/api/files/preview",
        json={"filename": "archive.zip", "page": 0, "page_size": 10},
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["file_type"] == "zip"
    assert payload["columns"] == ["filename", "size"]
    assert "LazyFrame" in payload["supported_types"]
    assert any(row["filename"] == "a.txt" for row in payload["preview"])


def test_text_preview_returns_single_cell(client, tmp_path):
    """Plain text files should produce a 1x1 preview table."""

    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    text_path = user_root / "example.txt"
    text_path.write_text("Plain text document.", encoding="utf-8")

    resp = client.post(
        "/api/files/preview",
        json={"filename": "example.txt", "page": 0, "page_size": 5},
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["file_type"] == "text"
    assert payload["columns"] == ["text"]
    assert payload["preview"] == [{"text": "Plain text document."}]
    assert payload["total_rows"] == 1
