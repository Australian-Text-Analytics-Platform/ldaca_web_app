"""
Tests for configuration module
"""

import os
from pathlib import Path
from unittest.mock import patch

from config import Settings, settings


class TestSettings:
    """Test cases for the Settings class"""

    def test_default_settings(self):
        """Test default settings values"""
        test_settings = Settings()

        assert test_settings.server_host == "0.0.0.0"
        assert test_settings.server_port == 8001
        assert not test_settings.debug
        assert test_settings.database_url == "sqlite+aiosqlite:///./data/users.db"
        assert test_settings.user_data_folder == "./data"
        assert test_settings.sample_data_folder == "./data/sample_data"

    def test_environment_override(self):
        """Test environment variable override"""
        with patch.dict(
            os.environ,
            {
                "SERVER_HOST": "127.0.0.1",
                "SERVER_PORT": "9000",
                "DEBUG": "true",
                "DATABASE_URL": "postgresql://test",
            },
        ):
            test_settings = Settings()
            assert test_settings.server_host == "127.0.0.1"
            assert test_settings.server_port == 9000
            assert test_settings.debug
            assert test_settings.database_url == "postgresql://test"

    def test_cors_allowed_origins_parsing(self):
        """Test CORS allowed origins parsing"""
        test_settings = Settings()
        origins = test_settings.cors_allowed_origins

        assert isinstance(origins, list)
        assert "http://localhost:3000" in origins
        assert "https://atap.sguo.org" in origins

    def test_path_methods(self):
        """Test path convenience methods"""
        test_settings = Settings()

        assert isinstance(test_settings.get_user_data_folder(), Path)
        assert isinstance(test_settings.get_sample_data_folder(), Path)
        assert isinstance(test_settings.get_database_backup_folder(), Path)

    def test_backward_compatibility(self):
        """Test backward compatibility properties"""
        test_settings = Settings()

        # Test data_folder property (Path object should normalize properly)
        assert isinstance(test_settings.data_folder, Path)
        assert test_settings.data_folder == Path(test_settings.user_data_folder)

        # Test allowed_origins property
        assert test_settings.allowed_origins == test_settings.cors_allowed_origins

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

    def test_config_backward_compatibility(self):
        """Test that config alias works"""
        from config import config

        assert config is settings
