"""
Tests for unified file preview endpoint
"""

from pathlib import Path
from typing import Any
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
    assert "DocLazyFrame" in data["supported_types"]
    assert "DataFrame" in data["supported_types"]
    assert data["columns"] == ["a", "b"]
    assert len(data["preview"]) == 2


def test_excel_preview_sheet_names_and_selection(client, tmp_path):
    """Test Excel file preview with sheet selection"""
    pytest.importorskip("fastexcel")
    pytest.importorskip("xlsxwriter")

    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    xlsx_path = user_root / "book.xlsx"

    # Create Excel file with multiple sheets using Polars
    # Write first sheet and get the workbook object
    df_a = pl.DataFrame({"t": ["a", "b"]})
    workbook = df_a.write_excel(xlsx_path, worksheet="SheetA")

    # Add second sheet to the same workbook
    df_b = pl.DataFrame({"t": ["c", "d"]})
    df_b.write_excel(workbook=workbook, worksheet="SheetB")

    # Close the workbook to ensure data is written
    workbook.close()

    # Test 1: No payload -> should pick first sheet and return sheet_names
    resp1 = client.post("/api/files/preview", json={"filename": "book.xlsx"})
    assert resp1.status_code == 200
    j1 = resp1.json()
    assert j1["file_type"] == "excel"
    assert "DataFrame" in j1["supported_types"]
    assert isinstance(j1.get("sheet_names"), list)
    assert j1.get("selected_sheet")
    assert len(j1["preview"]) >= 1

    # Test 2: Select SheetB explicitly
    resp2 = client.post(
        "/api/files/preview",
        json={"filename": "book.xlsx", "payload": {"sheet_name": "SheetB"}},
    )
    assert resp2.status_code == 200
    j2 = resp2.json()
    assert j2["selected_sheet"] == "SheetB"
    assert len(j2["preview"]) >= 1


def test_excel_preview_uses_docframe_helpers(client, tmp_path, monkeypatch):
    """The backend should rely on docframe for sheet names and reading."""

    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    xlsx_path = user_root / "fallback.xlsx"
    xlsx_path.write_text("placeholder", encoding="utf-8")

    from ldaca_web_app_backend.api import files as files_api

    sheet_calls: list[str] = []
    read_kwargs: list[dict[str, Any]] = []

    def fake_sheet_names(path: Path) -> list[str]:
        sheet_calls.append(str(path))
        return ["Sheet1", "Sheet2"]

    def fake_read_excel(path: Path, *_, **kwargs):
        read_kwargs.append(kwargs.copy())
        assert kwargs.get("sheet_name") == "Sheet1"
        assert kwargs.get("document_column") is False
        return pl.DataFrame({"value": [1, 2, 3]})

    monkeypatch.setattr(files_api.docframe, "excel_sheet_names", fake_sheet_names)
    monkeypatch.setattr(files_api.docframe, "read_excel", fake_read_excel)

    resp = client.post("/api/files/preview", json={"filename": "fallback.xlsx"})

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["selected_sheet"] == "Sheet1"
    assert payload["sheet_names"] == ["Sheet1", "Sheet2"]
    assert payload["preview"]
    assert sheet_calls == [str(xlsx_path)]
    assert read_kwargs == [{"sheet_name": "Sheet1", "document_column": False}]


def test_zip_preview_uses_docframe(client, tmp_path):
    """Ensure ZIP archives are parsed with docframe.read_zip."""

    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    repo_root = next(
        parent
        for parent in Path(__file__).resolve().parents
        if (parent / "docframe" / "examples" / "data" / "zip_example").exists()
    )
    source = repo_root / "docframe" / "examples" / "data" / "zip_example" / "data.zip"
    target = user_root / "archive.zip"
    target.write_bytes(source.read_bytes())

    resp = client.post(
        "/api/files/preview",
        json={"filename": "archive.zip", "page": 0, "page_size": 10},
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["file_type"] == "zip"
    assert payload["columns"][:3] == ["file_path", "base_name", "extension"]
    assert payload["columns"][3] in {"text", "document"}
    assert "DocDataFrame" in payload["supported_types"]
    assert any(row["base_name"] == "1" for row in payload["preview"])


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
    assert payload["columns"] in (["text"], ["document"])
    text_key = payload["columns"][0]
    assert payload["preview"] == [{text_key: "Plain text document."}]
    assert payload["total_rows"] == 1
