"""Tests for sample data import endpoint"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Patch settings and db init similar to preview tests
    with (
        patch("ldaca_web_app_backend.main.settings") as mock_settings,
        patch("ldaca_web_app_backend.main.init_db"),
        patch("ldaca_web_app_backend.main.cleanup_expired_sessions"),
        patch("ldaca_web_app_backend.core.utils.settings") as mock_config,
    ):
        mock_settings.data_folder = tmp_path
        mock_settings.allowed_origins = ["http://localhost:3000"]
        mock_settings.get.return_value = True
        mock_settings.debug = False
        mock_config.get_data_root.return_value = tmp_path
        mock_config.user_data_folder = "users"
        mock_config.multi_user = True
        # Provide sample data folder path
        sample_source = tmp_path / "sample_data"
        sample_source.mkdir(parents=True, exist_ok=True)
        (sample_source / "example.txt").write_text("hello")
        mock_settings.get_sample_data_folder.return_value = sample_source
        mock_config.get_sample_data_folder.return_value = sample_source

        app = __import__("ldaca_web_app_backend.main", fromlist=["app"]).app

        # Fake user dependency
        def fake_user():
            return {"id": "test_user"}

        from ldaca_web_app_backend.api import files as files_api

        app.dependency_overrides[files_api.get_current_user] = fake_user

        # Ensure user data base exists
        user_data = tmp_path / "users" / "user_test_user" / "user_data"
        user_data.mkdir(parents=True, exist_ok=True)

        return TestClient(app)


def test_first_import(client, tmp_path):
    resp = client.post("/api/files/import-sample-data")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["removed_existing"] is False
    assert data["file_count"] >= 1


def test_reimport_replaces_existing(client, tmp_path):
    # First import
    client.post("/api/files/import-sample-data")
    # Modify a file inside sample_data to ensure replacement
    user_sample = (
        tmp_path
        / "users"
        / "user_test_user"
        / "user_data"
        / "sample_data"
        / "example.txt"
    )
    assert user_sample.exists()
    user_sample.write_text("modified")
    # Second import should replace
    resp2 = client.post("/api/files/import-sample-data")
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["removed_existing"] is True
    # Content restored
    assert user_sample.read_text() == "hello"


def test_missing_source_folder(client, monkeypatch, tmp_path):
    # Point source to missing folder
    from ldaca_web_app_backend.core import utils as core_utils

    missing = tmp_path / "does_not_exist"

    def fake_get_sample_data_folder():
        return missing

    monkeypatch.setattr(
        core_utils.settings,
        "get_sample_data_folder",
        fake_get_sample_data_folder,
        raising=False,
    )
    resp = client.post("/api/files/import-sample-data")
    assert resp.status_code == 404
    assert resp.status_code == 404
