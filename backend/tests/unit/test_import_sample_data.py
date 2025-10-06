"""Tests for sample data import endpoint"""

from unittest.mock import MagicMock, patch

import pytest


def test_first_import(tmp_path):
    """Test first import returns removed_existing=False"""
    # Setup source and target
    source = tmp_path / "source"
    source.mkdir()
    (source / "example.txt").write_text("hello")

    target_base = tmp_path / "target"

    # Create a mock settings object with proper method returns
    mock_settings = MagicMock()
    mock_settings.get_sample_data_folder.return_value = source
    mock_settings.get_data_root.return_value = target_base
    mock_settings.user_data_folder = "users"
    mock_settings.multi_user = False

    # Import function and patch
    with patch("ldaca_web_app_backend.core.utils.settings", mock_settings):
        from ldaca_web_app_backend.core.utils import import_sample_data_for_user

        result = import_sample_data_for_user("test_user")

        assert result["removed_existing"] is False
        assert result["file_count"] == 1
        # In single-user mode, uses user_root folder
        expected_file = (
            target_base
            / "users"
            / "user_root"
            / "user_data"
            / "sample_data"
            / "example.txt"
        )
        assert expected_file.exists(), f"Expected file not found at {expected_file}"


def test_reimport_replaces_existing(tmp_path):
    """Test reimport returns removed_existing=True and replaces files"""
    # Setup source
    source = tmp_path / "source"
    source.mkdir()
    (source / "example.txt").write_text("hello")

    target_base = tmp_path / "target"

    mock_settings = MagicMock()
    mock_settings.get_sample_data_folder.return_value = source
    mock_settings.get_data_root.return_value = target_base
    mock_settings.user_data_folder = "users"
    mock_settings.multi_user = False

    with patch("ldaca_web_app_backend.core.utils.settings", mock_settings):
        from ldaca_web_app_backend.core.utils import import_sample_data_for_user

        # First import
        result1 = import_sample_data_for_user("test_user")
        assert result1["removed_existing"] is False

        # Modify file (single-user mode uses user_root)
        modified_file = (
            target_base
            / "users"
            / "user_root"
            / "user_data"
            / "sample_data"
            / "example.txt"
        )
        assert modified_file.exists(), "File should exist after first import"
        modified_file.write_text("modified")

        # Second import should replace
        result2 = import_sample_data_for_user("test_user")
        assert result2["removed_existing"] is True
        assert modified_file.read_text() == "hello"


def test_missing_source_folder(tmp_path):
    """Test missing source folder raises FileNotFoundError"""
    missing = tmp_path / "does_not_exist"
    target_base = tmp_path / "target"

    mock_settings = MagicMock()
    mock_settings.get_sample_data_folder.return_value = missing
    mock_settings.get_data_root.return_value = target_base
    mock_settings.user_data_folder = "users"
    mock_settings.multi_user = False

    with patch("ldaca_web_app_backend.core.utils.settings", mock_settings):
        from ldaca_web_app_backend.core.utils import import_sample_data_for_user

        with pytest.raises(FileNotFoundError):
            import_sample_data_for_user("test_user")
