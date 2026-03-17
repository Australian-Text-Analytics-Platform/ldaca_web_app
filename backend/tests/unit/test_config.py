"""
Tests for configuration module
"""

import os
from pathlib import Path
from unittest.mock import patch

from ldaca_web_app_backend.settings import Settings, settings


class TestSettings:
    """Test cases for the Settings class"""

    def test_default_settings(self):
        """Test default settings values"""
        test_settings = Settings()

        assert test_settings.server_host == "0.0.0.0"
        assert test_settings.backend_port == 8001
        # debug may be overridden by environment/.env; just ensure it's a boolean
        assert isinstance(test_settings.debug, bool)
        # database_url is derived only when accessed via method; default field may be None
        assert test_settings.database_file == "users.db"
        assert test_settings.user_data_folder == "users"
        # sample_data is optional unless explicitly configured
        assert test_settings.sample_data is None

    def test_environment_override(self):
        """Test environment variable override"""
        with patch.dict(
            os.environ,
            {
                "SERVER_HOST": "127.0.0.1",
                "backend_port": "9000",
                "DEBUG": "true",
                "DATABASE_URL": "postgresql://test",
            },
        ):
            test_settings = Settings()
            assert test_settings.server_host == "127.0.0.1"
            assert test_settings.backend_port == 9000
            assert test_settings.debug
            assert test_settings.database_url == "postgresql://test"

    def test_path_methods(self):
        """Test path convenience methods"""
        test_settings = Settings()

        assert isinstance(test_settings.get_user_data_folder(), Path)
        assert test_settings.get_sample_data_folder() is None
        assert isinstance(test_settings.get_database_backup_folder(), Path)

    def test_boolean_field_validation(self):
        """Test boolean field validation from strings"""
        with patch.dict(
            os.environ,
            {
                "DEBUG": "true",
                "CORS_ALLOW_CREDENTIALS": "false",
            },
        ):
            test_settings = Settings()
            assert test_settings.debug
            assert not test_settings.cors_allow_credentials

        with patch.dict(
            os.environ,
            {
                "DEBUG": "release",
            },
        ):
            test_settings = Settings()
            assert test_settings.debug is False

        with patch.dict(
            os.environ,
            {
                "DEBUG": "1",
                "CORS_ALLOW_CREDENTIALS": "0",
            },
        ):
            test_settings = Settings()
            assert test_settings.debug
            assert not test_settings.cors_allow_credentials


class TestGlobalSettings:
    """Test cases for the global settings instance"""

    def test_global_settings_accessible(self):
        """Test that global settings instance is accessible"""
        assert settings is not None
        assert isinstance(settings, Settings)
