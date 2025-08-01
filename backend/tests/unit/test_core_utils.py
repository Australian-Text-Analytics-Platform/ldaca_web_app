"""
Tests for core utilities
"""

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from core.utils import (
    detect_file_type,
    generate_node_id,
    generate_workspace_id,
    get_file_size_mb,
    get_folder_size_mb,
    get_user_data_folder,
    get_user_workspace_folder,
    load_data_file,
    serialize_dataframe_for_json,
    setup_user_folders,
    validate_file_path,
)


class TestUserFolders:
    """Test user folder management functions"""

    @patch("core.utils.config")
    def test_get_user_data_folder(self, mock_config, temp_dir):
        """Test getting user data folder"""
        mock_config.user_data_folder = temp_dir

        user_id = "test_user_123"
        folder = get_user_data_folder(user_id)

        expected_path = temp_dir / f"user_{user_id}" / "user_data"
        assert folder == expected_path
        assert folder.exists()

    @patch("core.utils.config")
    def test_get_user_workspace_folder(self, mock_config, temp_dir):
        """Test getting user workspace folder"""
        mock_config.user_data_folder = temp_dir

        user_id = "test_user_123"
        folder = get_user_workspace_folder(user_id)

        expected_path = temp_dir / f"user_{user_id}" / "user_workspaces"
        assert folder == expected_path
        assert folder.exists()

    @patch("core.utils.config")
    def test_setup_user_folders(self, mock_config, temp_dir):
        """Test setting up complete user folder structure"""
        mock_config.user_data_folder = temp_dir

        # Create sample data in the expected location
        sample_data_dir = temp_dir / "sample_data"
        sample_data_dir.mkdir()
        (sample_data_dir / "test_file.txt").write_text("test content")
        mock_config.sample_data_folder = str(sample_data_dir)

        user_id = "test_user_123"
        folders = setup_user_folders(user_id)

        # Check returned paths
        assert "user_folder" in folders
        assert "user_data" in folders
        assert "user_workspaces" in folders

        # Check actual folder structure
        user_folder = temp_dir / f"user_{user_id}"
        user_data = user_folder / "user_data"
        user_workspaces = user_folder / "user_workspaces"
        sample_data_copy = user_data / "sample_data"

        assert user_folder.exists()
        assert user_data.exists()
        assert user_workspaces.exists()
        assert sample_data_copy.exists()
        assert (sample_data_copy / "test_file.txt").exists()


class TestFileOperations:
    """Test file operation utilities"""

    def test_get_file_size_mb(self, temp_dir):
        """Test getting file size in MB"""
        test_file = temp_dir / "test.txt"
        test_content = "x" * 1024 * 1024  # 1MB of content
        test_file.write_text(test_content)

        size_mb = get_file_size_mb(test_file)
        assert abs(size_mb - 1.0) < 0.1  # Should be approximately 1MB

    def test_get_file_size_mb_nonexistent(self, temp_dir):
        """Test getting size of non-existent file"""
        nonexistent_file = temp_dir / "nonexistent.txt"
        size_mb = get_file_size_mb(nonexistent_file)
        assert size_mb == 0.0

    def test_get_folder_size_mb(self, temp_dir):
        """Test getting folder size in MB"""
        # Create multiple files
        for i in range(3):
            test_file = temp_dir / f"test_{i}.txt"
            test_file.write_text("x" * (512 * 1024))  # 0.5MB each

        total_size = get_folder_size_mb(temp_dir)
        assert abs(total_size - 1.5) < 0.1  # Should be approximately 1.5MB

    def test_detect_file_type(self):
        """Test file type detection"""
        test_cases = [
            ("data.csv", "csv"),
            ("document.json", "json"),
            ("logs.jsonl", "jsonl"),
            ("table.parquet", "parquet"),
            ("spreadsheet.xlsx", "excel"),
            ("notes.txt", "text"),
            ("data.tsv", "tsv"),
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

    def test_load_data_file_json(self, sample_json_file):
        """Test loading JSON file"""
        df = load_data_file(sample_json_file)

        # Should return polars DataFrame by default
        assert hasattr(df, "shape")  # Both polars and pandas have shape
        assert df.shape[0] == 3  # 3 rows
        assert df.shape[1] == 3  # 3 columns

        # Check column names
        if hasattr(df, "columns"):
            columns = list(df.columns)
        else:
            columns = df.columns.tolist()
        assert "name" in columns
        assert "age" in columns
        assert "city" in columns

    def test_load_data_file_unsupported(self, temp_dir):
        """Test loading unsupported file type"""
        unsupported_file = temp_dir / "test.xyz"
        unsupported_file.write_text("some content")

        with pytest.raises(ValueError, match="Unsupported file type"):
            load_data_file(unsupported_file)


class TestLoadDataFile:
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

    def test_load_data_file_with_docframe(self, sample_csv_file):
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

    def test_load_data_file_docframe_fallback(self, sample_csv_file):
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

        # Handle both LazyFrame and DataFrame results
        if hasattr(df, "collect"):
            # It's a LazyFrame
            actual_df = df.collect()
            assert actual_df.shape[0] == 3
        else:
            # It's a DataFrame
            assert df.shape[0] == 3


class TestDataFrameUtils:
    """Test DataFrame utility functions"""

    def test_serialize_dataframe_for_json(self):
        """Test DataFrame serialization for JSON"""
        df = pd.DataFrame(
            {
                "name": ["Alice", "Bob", "Charlie"],
                "age": [25, 30, 35],
                "score": [95.5, 87.2, 92.1],
            }
        )

        result = serialize_dataframe_for_json(df)

        assert result["shape"] == (3, 3)
        assert result["columns"] == ["name", "age", "score"]
        assert "dtypes" in result
        assert "preview" in result
        assert len(result["preview"]) == 3
        assert result["is_text_data"] is False

    def test_serialize_dataframe_with_nulls(self):
        """Test DataFrame serialization with null values"""
        df = pd.DataFrame({"name": ["Alice", None, "Charlie"], "age": [25, 30, None]})

        result = serialize_dataframe_for_json(df)

        assert result["shape"] == (3, 2)
        assert len(result["preview"]) == 3
        # Check that nulls are handled
        assert any("None" in str(row) for row in result["preview"])

    def test_serialize_invalid_dataframe(self):
        """Test serialization of invalid DataFrame-like object"""
        fake_df = object()  # Not a DataFrame

        result = serialize_dataframe_for_json(fake_df)

        assert result["shape"] == (0, 0)
        assert result["columns"] == []
        assert result["preview"] == []

    @patch("core.utils.DOCFRAME_AVAILABLE", True)
    def test_serialize_docframe_dataframe(self):
        """Test serialization detects DocDataFrame"""
        # Mock DocDataFrame with dataframe attribute
        mock_df = MagicMock()
        mock_df.shape = (10, 5)
        mock_df.columns = ["doc_id", "text", "metadata"]
        mock_df.dtypes = {"doc_id": "int64", "text": "object"}
        mock_df.head.return_value.fillna.return_value.to_dict.return_value = []
        mock_df.__class__.__name__ = "DocDataFrame"

        # Mock the underlying dataframe attribute (what DocDataFrame uses)
        mock_underlying_df = MagicMock()
        mock_underlying_df.shape = (10, 5)
        mock_underlying_df.columns = ["doc_id", "text", "metadata"]
        mock_underlying_df.schema = {
            "doc_id": "int64",
            "text": "str",
            "metadata": "str",
        }
        mock_underlying_df.head.return_value.to_pandas.return_value.fillna.return_value.to_dict.return_value = []
        mock_df.dataframe = mock_underlying_df

        result = serialize_dataframe_for_json(mock_df)
        assert result["is_text_data"] is True


class TestUtilityFunctions:
    """Test general utility functions"""

    def test_generate_node_id(self):
        """Test node ID generation"""
        node_id = generate_node_id()

        assert isinstance(node_id, str)
        assert len(node_id) == 36  # UUID4 length
        assert node_id.count("-") == 4  # UUID4 format

    def test_generate_workspace_id(self):
        """Test workspace ID generation"""
        workspace_id = generate_workspace_id()

        assert isinstance(workspace_id, str)
        assert len(workspace_id) == 36  # UUID4 length
        assert workspace_id.count("-") == 4  # UUID4 format

    def test_generate_unique_ids(self):
        """Test that generated IDs are unique"""
        ids = [generate_node_id() for _ in range(100)]
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
