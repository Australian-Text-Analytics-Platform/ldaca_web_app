"""
Tests for core utilities
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import polars as pl
import pytest
from ldaca_web_app_backend.core.utils import (
    detect_file_type,
    generate_workspace_id,
    get_user_data_folder,
    get_user_workspace_folder,
    load_data_file,
    read_zip_file,
    setup_user_folders,
    validate_file_path,
)


class TestUserFolders:
    """Test user folder management functions"""

    @patch("ldaca_web_app_backend.core.utils.settings")
    def test_get_user_data_folder(self, mock_settings, temp_dir):
        """Test getting user data folder"""
        # New path scheme: base under DATA_ROOT / user_data_folder
        mock_settings.get_data_root.return_value = temp_dir
        mock_settings.user_data_folder = "users"

        user_id = "test_user_123"
        folder = get_user_data_folder(user_id)

        expected_path = temp_dir / "users" / f"user_{user_id}" / "user_data"
        assert folder == expected_path
        assert folder.exists()

    @patch("ldaca_web_app_backend.core.utils.settings")
    def test_get_user_workspace_folder(self, mock_settings, temp_dir):
        """Test getting user workspace folder"""
        mock_settings.get_data_root.return_value = temp_dir
        mock_settings.user_data_folder = "users"

        user_id = "test_user_123"
        folder = get_user_workspace_folder(user_id)

        expected_path = temp_dir / "users" / f"user_{user_id}" / "user_workspaces"
        assert folder == expected_path
        assert folder.exists()

    @patch("ldaca_web_app_backend.core.utils.settings")
    def test_setup_user_folders(self, mock_settings, temp_dir):
        """Test setting up complete user folder structure (no auto sample copy)"""
        mock_settings.get_data_root.return_value = temp_dir
        mock_settings.user_data_folder = "users"
        # Previously sample data would be copied automatically; now it should NOT.
        sample_data_dir = temp_dir / "sample_data"
        sample_data_dir.mkdir()
        (sample_data_dir / "test_file.txt").write_text("test content")
        mock_settings.get_sample_data_folder.return_value = sample_data_dir

        user_id = "test_user_123"
        folders = setup_user_folders(user_id)

        # Check returned paths
        assert "user_folder" in folders
        assert "user_data" in folders
        assert "user_workspaces" in folders

        # Check actual folder structure
        user_folder = temp_dir / "users" / f"user_{user_id}"
        user_data = user_folder / "user_data"
        user_workspaces = user_folder / "user_workspaces"
        sample_data_copy = user_data / "sample_data"

        assert user_folder.exists()
        assert user_data.exists()
        assert user_workspaces.exists()
        # Sample data should NOT be auto copied now
        assert not sample_data_copy.exists()


class TestFileOperations:
    """Test file operation utilities"""

    def test_detect_file_type(self):
        """Test file type detection"""
        test_cases = [
            ("document.json", "json"),
            ("logs.jsonl", "jsonl"),
            ("table.parquet", "parquet"),
            ("spreadsheet.xlsx", "excel"),
            ("legacy.xls", "excel"),
            ("macro.xlsm", "excel"),
            ("binary.xlsb", "excel"),
            ("calc.ods", "excel"),
            ("notes.txt", "text"),
            ("readme.md", "text"),
            ("doc.rst", "text"),
            ("server.log", "text"),
            ("snippet.text", "text"),
            ("data.tsv", "tsv"),
            ("archive.zip", "zip"),
            ("unknown.xyz", "unknown"),
            ("file_without_extension", "unknown"),
        ]

        for filename, expected_type in test_cases:
            assert detect_file_type(filename) == expected_type

    def test_load_data_file_csv(self, sample_csv_file):
        """Test loading CSV file"""
        df = load_data_file(sample_csv_file)

        # Function returns polars LazyFrame by default for efficiency
        # Handle both LazyFrame and DataFrame cases
        try:
            # Try LazyFrame collect method
            actual_df = df.collect()
            assert actual_df.shape[0] == 3  # 3 rows
            assert actual_df.shape[1] == 3  # 3 columns
        except AttributeError:
            # Not a LazyFrame, should be a DataFrame with shape
            assert hasattr(df, "shape")
            assert df.shape[0] == 3  # 3 rows
            assert df.shape[1] == 3  # 3 columns

        # Check column names (handle LazyFrame vs DataFrame)
        try:
            # LazyFrame - use collect_schema() to get column names
            columns = list(df.collect_schema().names())
        except AttributeError:
            # DataFrame - use columns directly
            if hasattr(df, "columns"):
                columns = list(df.columns)
            else:
                columns = df.columns.tolist()
        assert "name" in columns
        assert "age" in columns
        assert "city" in columns

    @pytest.fixture()
    def sample_zip_file(self, temp_dir):
        """Provide a sample ZIP archive for tests."""
        from zipfile import ZipFile

        target = temp_dir / "sample.zip"
        with ZipFile(target, "w") as zf:
            zf.writestr("a.txt", "hello")
            zf.writestr("b.txt", "world")
        return target

    def test_read_zip_file_returns_legacy_text_schema(self, temp_dir):
        """ZIP text ingestion should expose legacy file metadata columns."""
        from zipfile import ZipFile

        target = temp_dir / "legacy.zip"
        with ZipFile(target, "w") as zf:
            zf.writestr("nested/alpha.txt", "hello alpha")
            zf.writestr("beta.md", "hello beta")

        df = read_zip_file(target)

        assert df.columns == ["file_path", "base_name", "extension", "document"]
        assert df.to_dicts() == [
            {
                "file_path": "beta.md",
                "base_name": "beta",
                "extension": ".md",
                "document": "hello beta",
            },
            {
                "file_path": "nested/alpha.txt",
                "base_name": "alpha",
                "extension": ".txt",
                "document": "hello alpha",
            },
        ]

    """Test data loading functionality"""

    def test_load_csv_file(self, sample_csv_file):
        """Test loading a CSV file"""
        df = load_data_file(sample_csv_file)

        # Handle both LazyFrame and DataFrame results
        if hasattr(df, "collect"):
            # It's a LazyFrame
            actual_df = df.collect()
            assert actual_df.shape[0] == 3  # 3 rows
            assert actual_df.shape[1] == 3  # 3 columns
        else:
            # It's a DataFrame
            assert df.shape[0] == 3  # 3 rows
            assert df.shape[1] == 3  # 3 columns

        # Check columns based on type
        if hasattr(df, "collect_schema"):
            columns = list(df.collect_schema().keys())
        elif hasattr(df, "columns"):
            if callable(df.columns):
                columns = df.columns()
            else:
                columns = list(df.columns)
        else:
            columns = []

        assert "name" in columns
        assert "age" in columns
        assert "city" in columns

    def test_load_json_file(self, sample_json_file):
        """Test loading a JSON file"""
        df = load_data_file(sample_json_file)

        # Handle both LazyFrame and DataFrame results
        if hasattr(df, "collect"):
            # It's a LazyFrame
            actual_df = df.collect()
            assert actual_df.shape[0] == 3  # 3 rows
        else:
            # It's a DataFrame
            assert df.shape[0] == 3  # 3 rows

        # Check columns based on type
        if hasattr(df, "collect_schema"):
            columns = list(df.collect_schema().keys())
        elif hasattr(df, "columns"):
            if callable(df.columns):
                columns = df.columns()
            else:
                columns = list(df.columns)
        else:
            columns = []

        assert "name" in columns
        assert "age" in columns
        assert "city" in columns

    def test_load_data_file_with_polars(self, sample_csv_file):
        """Test loading file - should use polars by default"""
        result = load_data_file(sample_csv_file)

        # Handle both LazyFrame and DataFrame results
        if hasattr(result, "collect"):
            # It's a LazyFrame
            actual_df = result.collect()
            assert actual_df.shape[0] == 3
        else:
            # It's a DataFrame
            assert result.shape[0] == 3

    def test_load_data_file_polars_fallback(self, sample_csv_file):
        """Test loading file with fallback behavior"""
        df = load_data_file(sample_csv_file)

        # Handle both LazyFrame and DataFrame results
        if hasattr(df, "collect"):
            # It's a LazyFrame
            actual_df = df.collect()
            assert actual_df.shape[0] == 3
        else:
            # It's a DataFrame
            assert df.shape[0] == 3

    @patch("ldaca_web_app_backend.core.utils.pl.read_excel")
    def test_load_excel_file_selects_requested_sheet(self, mock_read_excel, temp_dir):
        """load_data_file should request and return the selected Excel sheet."""

        target = temp_dir / "workbook.xlsx"
        target.write_bytes(b"placeholder")

        expected = pl.DataFrame({"text": ["a", "b"]})
        mock_read_excel.return_value = expected

        result = load_data_file(target, sheet_name="Sheet2")

        mock_read_excel.assert_called_once_with(target, sheet_name="Sheet2")
        assert isinstance(result, pl.DataFrame)
        assert result.to_dicts() == expected.to_dicts()

    @patch("ldaca_web_app_backend.core.utils.pl.read_excel")
    def test_load_excel_file_dict_result_uses_selected_sheet(
        self, mock_read_excel, temp_dir
    ):
        """load_data_file should coerce workbook dict responses to the requested sheet DataFrame."""

        target = temp_dir / "workbook.xlsx"
        target.write_bytes(b"placeholder")

        sheet1 = pl.DataFrame({"value": [1]})
        sheet2 = pl.DataFrame({"value": [2]})
        mock_read_excel.return_value = {"Sheet1": sheet1, "Sheet2": sheet2}

        result = load_data_file(target, sheet_name="Sheet2")

        assert isinstance(result, pl.DataFrame)
        assert result.to_dicts() == [{"value": 2}]


class TestUtilityFunctions:
    """Test general utility functions"""

    def test_generate_workspace_id(self):
        """Test workspace ID generation"""
        workspace_id = generate_workspace_id()

        assert isinstance(workspace_id, str)
        assert len(workspace_id) == 36  # UUID4 length
        assert workspace_id.count("-") == 4  # UUID4 format

    def test_generate_unique_workspace_ids(self):
        """Test that generated workspace IDs are unique"""
        ids = [generate_workspace_id() for _ in range(100)]
        assert len(set(ids)) == 100  # All should be unique

    def test_validate_file_path_valid(self, temp_dir):
        """Test file path validation with valid path"""
        user_folder = temp_dir / "user_data"
        user_folder.mkdir()

        valid_file = user_folder / "data.csv"
        valid_file.touch()

        assert validate_file_path(valid_file, user_folder) is True

    def test_validate_file_path_invalid(self, temp_dir):
        """Test file path validation with path outside user folder"""
        user_folder = temp_dir / "user_data"
        user_folder.mkdir()

        external_file = temp_dir / "external.csv"
        external_file.touch()

        assert validate_file_path(external_file, user_folder) is False

    def test_validate_file_path_traversal_attempt(self, temp_dir):
        """Test file path validation prevents path traversal"""
        user_folder = temp_dir / "user_data"
        user_folder.mkdir()

        # Attempt path traversal
        malicious_path = user_folder / ".." / "secret.txt"

        assert validate_file_path(malicious_path, user_folder) is False
