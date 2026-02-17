"""Tests for README citation metadata in the files listing endpoint."""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path):
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

        user_root = tmp_path / "users" / "user_test_user" / "user_data"
        user_root.mkdir(parents=True, exist_ok=True)

        yield TestClient(app)

        app.dependency_overrides.clear()


def test_list_files_embeds_readme_for_eligible_sample_rows(
    client: TestClient, tmp_path: Path
):

    user_root = tmp_path / "users" / "user_test_user" / "user_data"

    # Folder with README and a sample data file
    ado_folder = user_root / "sample_data" / "ADO"
    ado_folder.mkdir(parents=True, exist_ok=True)
    (ado_folder / "README.md").write_text(
        "# ADO Citation\n\nSample citation text.", encoding="utf-8"
    )
    (ado_folder / "documents.csv").write_text("text\nhello", encoding="utf-8")

    # Folder without README
    no_readme_folder = user_root / "sample_data" / "NoReadme"
    no_readme_folder.mkdir(parents=True, exist_ok=True)
    (no_readme_folder / "items.csv").write_text("text\nworld", encoding="utf-8")

    # User-uploaded (non-sample) file
    (user_root / "user_file.csv").write_text("text\nprivate", encoding="utf-8")

    response = client.get("/api/files/")
    assert response.status_code == 200

    payload = response.json()
    files = payload["files"]

    ado_data = next(
        item
        for item in files
        if item.get("display_name") == "documents.csv"
        and item.get("folder", "").endswith("sample_data/ADO")
    )
    assert ado_data["path_type"] == "sample"
    assert isinstance(ado_data.get("readme"), str)
    assert "ADO Citation" in ado_data["readme"]

    assert all(
        (item.get("display_name") or "").lower() != "readme.md" for item in files
    )

    no_readme_data = next(
        item
        for item in files
        if item.get("display_name") == "items.csv"
        and item.get("folder", "").endswith("sample_data/NoReadme")
    )
    assert no_readme_data["path_type"] == "sample"
    assert no_readme_data.get("readme") is None

    user_data = next(
        item for item in files if item.get("display_name") == "user_file.csv"
    )
    assert user_data["path_type"] == "user"
    assert user_data.get("readme") is None
