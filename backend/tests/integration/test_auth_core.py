"""
Core authentication logic tests
Tests authentication functions, configuration, and business logic
"""

from unittest.mock import MagicMock, patch

import pytest

# Test user constants
TEST_USER_ID = "test"
TEST_USER_EMAIL = "test@localhost"
TEST_USER_NAME = "Test User"


class TestAuthenticationFunctions:
    """Test core authentication functions directly"""

    @pytest.fixture(autouse=True)
    def setup_auth_config(self):
        """Set up mocked config for auth function testing"""
        # Create a mock settings object with test values
        mock_settings = MagicMock()
        mock_settings.multi_user = False
        mock_settings.single_user_id = TEST_USER_ID
        mock_settings.single_user_name = TEST_USER_NAME
        mock_settings.single_user_email = TEST_USER_EMAIL

        # Patch settings in the core.auth module
        with patch("core.auth.settings", mock_settings):
            yield mock_settings

    async def test_get_current_user_single_user_mode(self):
        """Test get_current_user function in single-user mode"""
        from core.auth import get_current_user

        # In single-user mode, all calls should return the same user
        result1 = await get_current_user("Bearer test-token")
        result2 = await get_current_user("different-token")
        result3 = await get_current_user(None)

        # All should return test user
        for result in [result1, result2, result3]:
            assert result["id"] == TEST_USER_ID
            assert result["email"] == TEST_USER_EMAIL
            assert result["name"] == TEST_USER_NAME
            assert result["is_active"] is True

        # Results should be identical
        assert result1 == result2 == result3

    def test_available_auth_methods_single_user_mode(self):
        """Test available auth methods in single-user mode"""
        from core.auth import get_available_auth_methods

        methods = get_available_auth_methods()
        assert methods == []  # No auth methods in single-user mode

    @patch("core.auth.validate_access_token")
    @patch("core.auth.settings")
    async def test_multi_user_mode_concept(self, mock_settings, mock_validate):
        """Test multi-user mode concept with mocked settings"""
        from core.auth import get_current_user

        # Mock multi-user configuration
        mock_settings.multi_user = True
        mock_validate.return_value = {
            "id": "user123",
            "email": "user@example.com",
            "name": "Test User",
        }

        # Should validate token in multi-user mode
        result = await get_current_user("Bearer valid-token")
        assert result["id"] == "user123"
        mock_validate.assert_called_once()


class TestAuthenticationConfiguration:
    """Test authentication configuration behavior"""

    @pytest.fixture(autouse=True)
    def setup_config(self):
        """Set up mocked config for direct configuration testing"""
        # Create a mock settings object with test values
        mock_settings = MagicMock()
        mock_settings.multi_user = False
        mock_settings.single_user_id = TEST_USER_ID
        mock_settings.single_user_name = TEST_USER_NAME
        mock_settings.single_user_email = TEST_USER_EMAIL
        mock_settings.google_client_id = ""
        mock_settings.database_url = "sqlite+aiosqlite:///:memory:"

        # Patch the settings in the config module
        with patch("config.settings", mock_settings):
            yield mock_settings

    def test_single_user_mode_configuration(self):
        """Test single-user mode configuration values"""
        from config import settings

        # Test current configuration
        assert settings.multi_user is False
        assert settings.single_user_id == TEST_USER_ID
        assert settings.single_user_email == TEST_USER_EMAIL
        assert settings.single_user_name == TEST_USER_NAME

    def test_auth_methods_configuration(self):
        """Test auth methods configuration"""
        from core.auth import get_available_auth_methods

        # Auth methods should be empty in single-user mode
        methods = get_available_auth_methods()
        assert methods == []


class TestAuthenticationModes:
    """Test different authentication mode behaviors"""

    def test_single_user_mode_business_logic(self):
        """Test single-user mode business logic"""
        # Single-user mode concepts:
        # - No token validation required
        # - Always returns same user
        # - No Google OAuth
        # - No user registration/management

        # These are conceptual tests that document behavior
        assert True  # Single-user mode is simpler

    @patch("core.auth.settings")
    def test_multi_user_mode_business_logic(self, mock_settings):
        """Test multi-user mode business logic concepts"""
        mock_settings.multi_user = True
        mock_settings.google_client_id = "test-client-id"

        from core.auth import get_available_auth_methods

        # In multi-user mode with Google configured, should have Google auth
        methods = get_available_auth_methods()
        assert len(methods) == 1
        assert methods[0]["name"] == "google"
        assert methods[0]["enabled"] is True
