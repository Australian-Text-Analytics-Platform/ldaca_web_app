"""
Tests for unified file preview endpoint
"""

from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

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
    """ZIP archives should return legacy text-ingestion metadata columns."""

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
    assert payload["columns"] == ["file_path", "base_name", "extension", "document"]
    assert "LazyFrame" in payload["supported_types"]
    assert any(row["file_path"] == "a.txt" for row in payload["preview"])


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


def test_excel_preview_handles_dataframe_return_for_sheet_listing(client, tmp_path):
    """Excel preview should not fail when sheet_id=None returns a DataFrame."""

    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    excel_path = user_root / "single_sheet.xlsx"
    excel_path.write_bytes(b"placeholder")

    def fake_read_excel(file_path, sheet_id=None, sheet_name=None):
        if sheet_id is None:
            # Reproduces the bug case: `.keys()` is not available on DataFrame.
            return pl.DataFrame({"col_a": [1, 2], "col_b": ["x", "y"]})
        if sheet_id == 0:
            return pl.DataFrame({"col_a": [1, 2], "col_b": ["x", "y"]})
        if sheet_name is not None:
            return pl.DataFrame({"col_a": [1, 2], "col_b": ["x", "y"]})
        raise AssertionError("Unexpected read_excel call signature")

    with patch(
        "ldaca_web_app_backend.api.files.pl.read_excel", side_effect=fake_read_excel
    ):
        resp = client.post(
            "/api/files/preview",
            json={"filename": "single_sheet.xlsx", "page": 0, "page_size": 1},
        )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["file_type"] == "excel"
    assert payload["columns"] == ["col_a", "col_b"]
    assert payload["preview"] == [{"col_a": 1, "col_b": "x"}]
    assert payload["sheet_names"] == []
    assert payload["selected_sheet"] is None


def test_excel_preview_handles_dict_return_for_sheet_id_zero(client, tmp_path):
    """Excel preview should handle workbook dict returned for sheet_id=0."""

    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    excel_path = user_root / "sheet_id_zero_returns_dict.xlsx"
    excel_path.write_bytes(b"placeholder")

    sheet_df = pl.DataFrame({"col_a": [10, 20], "col_b": ["m", "n"]})

    def fake_read_excel(file_path, sheet_id=None, sheet_name=None):
        if sheet_id is None:
            # No sheet names available from this call path in some versions.
            return sheet_df
        if sheet_id == 0:
            # Reproduces the new bug: code assumed DataFrame and accessed .height.
            return {"Sheet1": sheet_df}
        if sheet_name is not None:
            return sheet_df
        raise AssertionError("Unexpected read_excel call signature")

    with patch(
        "ldaca_web_app_backend.api.files.pl.read_excel", side_effect=fake_read_excel
    ):
        resp = client.post(
            "/api/files/preview",
            json={
                "filename": "sheet_id_zero_returns_dict.xlsx",
                "page": 0,
                "page_size": 1,
            },
        )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["file_type"] == "excel"
    assert payload["columns"] == ["col_a", "col_b"]
    assert payload["preview"] == [{"col_a": 10, "col_b": "m"}]
    assert payload["sheet_names"] == []
    assert payload["selected_sheet"] is None


def test_excel_preview_returns_sheet_names_for_selector(client, tmp_path):
    """Excel preview should expose sheet names so Add File can offer a selector."""

    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    excel_path = user_root / "with_sheet_names.xlsx"
    excel_path.write_bytes(b"placeholder")

    base_df = pl.DataFrame({"col_a": [1, 2], "col_b": ["x", "y"]})

    def fake_read_excel(file_path, sheet_id=None, sheet_name=None):
        if sheet_name is not None:
            return base_df
        if sheet_id == 0:
            return base_df
        if sheet_id is None:
            return base_df
        raise AssertionError("Unexpected read_excel call signature")

    class FakeReader:
        sheet_names = ["Sheet1", "Sheet2"]

    class FakeFastExcel:
        @staticmethod
        def read_excel(_source):
            return FakeReader()

    with (
        patch("ldaca_web_app_backend.api.files.fastexcel", FakeFastExcel),
        patch(
            "ldaca_web_app_backend.api.files.pl.read_excel", side_effect=fake_read_excel
        ),
    ):
        resp = client.post(
            "/api/files/preview",
            json={"filename": "with_sheet_names.xlsx", "page": 0, "page_size": 1},
        )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["file_type"] == "excel"
    assert payload["sheet_names"] == ["Sheet1", "Sheet2"]
    assert payload["selected_sheet"] == "Sheet1"


def test_excel_preview_sheet_names_xml_fallback_without_fastexcel(client, tmp_path):
    """Sheet names should still be exposed via workbook.xml fallback when fastexcel is unavailable."""

    user_root = tmp_path / "users" / "user_test_user" / "user_data"
    excel_path = user_root / "xml_fallback.xlsx"

    # Minimal zipped workbook.xml payload for fallback parser.
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "<sheets>"
        '<sheet name="SheetA" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>'
        '<sheet name="SheetB" sheetId="2" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>'
        "</sheets>"
        "</workbook>"
    )
    with ZipFile(excel_path, "w") as zf:
        zf.writestr("xl/workbook.xml", workbook_xml)

    base_df = pl.DataFrame({"col_a": [1], "col_b": ["x"]})

    def fake_read_excel(file_path, sheet_id=None, sheet_name=None):
        if sheet_name is not None:
            return base_df
        if sheet_id == 0:
            return base_df
        if sheet_id is None:
            return base_df
        raise AssertionError("Unexpected read_excel call signature")

    with (
        patch("ldaca_web_app_backend.api.files.fastexcel", None),
        patch(
            "ldaca_web_app_backend.api.files.pl.read_excel", side_effect=fake_read_excel
        ),
    ):
        resp = client.post(
            "/api/files/preview",
            json={"filename": "xml_fallback.xlsx", "page": 0, "page_size": 1},
        )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["sheet_names"] == ["SheetA", "SheetB"]
    assert payload["selected_sheet"] == "SheetA"
