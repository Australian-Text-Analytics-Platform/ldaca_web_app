"""
Tests for authentication API endpoints
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


class TestAuthAPI:
    """Test cases for authentication endpoints"""

    @pytest.fixture(autouse=True)
    def setup_client(self, test_client):
        """Set up test client for unauthenticated endpoints"""
        self.client = test_client

    @patch("api.auth.id_token.verify_oauth2_token")
    @patch("api.auth.get_or_create_user")
    @patch("api.auth.create_user_session")
    @patch("api.auth.setup_user_folders")
    async def test_google_auth_success(
        self, mock_setup_folders, mock_create_session, mock_get_user, mock_verify_token
    ):
        """Test successful Google OAuth authentication"""
        # Mock token verification
        mock_verify_token.return_value = {
            "email": "test@example.com",
            "email_verified": True,
            "name": "Test User",
            "picture": "https://example.com/avatar.jpg",
            "sub": "google-user-id-123",
        }

        # Mock user creation/retrieval
        mock_user = {
            "id": "12345678-1234-5678-9012-123456789abc",  # Valid UUID format
            "email": "test@example.com",
            "name": "Test User",
            "picture": "https://example.com/avatar.jpg",
        }
        mock_get_user.return_value = mock_user

        # Mock folder setup
        mock_setup_folders.return_value = {
            "user_folder": "/data/user_12345678-1234-5678-9012-123456789abc",
            "user_data": "/data/user_12345678-1234-5678-9012-123456789abc/user_data",
            "user_workspaces": "/data/user_12345678-1234-5678-9012-123456789abc/user_workspaces",
        }

        # Mock session creation
        mock_session = {
            "access_token": "access-token-123",
            "refresh_token": "refresh-token-123",
            "expires_in": 3600,
        }
        mock_create_session.return_value = mock_session

        # Make request
        response = self.client.post(
            "/api/auth/google", json={"id_token": "google-id-token-123"}
        )

        assert response.status_code == 200
        data = response.json()

        assert data["access_token"] == "access-token-123"
        assert data["refresh_token"] == "refresh-token-123"
        assert data["expires_in"] == 3600
        assert data["token_type"] == "Bearer"
        assert data["scope"] == "openid email profile"
        assert data["user"]["email"] == "test@example.com"

    @patch("api.auth.id_token.verify_oauth2_token")
    def test_google_auth_invalid_token(self, mock_verify_token):
        """Test Google OAuth with invalid token"""
        mock_verify_token.side_effect = ValueError("Invalid token")

        response = self.client.post("/api/auth/google", json={"id_token": "invalid-token"})

        assert response.status_code == 400
        assert "Invalid ID token" in response.json()["detail"]

    @patch("api.auth.id_token.verify_oauth2_token")
    def test_google_auth_unverified_email(self, mock_verify_token):
        """Test Google OAuth with unverified email"""
        mock_verify_token.return_value = {
            "email": "test@example.com",
            "email_verified": False,
            "name": "Test User",
        }

        response = self.client.post("/api/auth/google", json={"id_token": "valid-token"})

        assert response.status_code == 400
        assert "Email not verified" in response.json()["detail"]

    def test_get_current_user_info(self, authenticated_client):
        """Test getting current user information"""
        response = authenticated_client.get(
            "/api/auth/me"
        )

        assert response.status_code == 200
        data = response.json()

        assert data["id"] == "test-user-123"
        assert data["email"] == "test@example.com"
        assert data["name"] == "Test User"

    def test_get_current_user_info_no_auth(self):
        """Test getting user info without authentication"""
        response = self.client.get("/api/auth/me")

        assert response.status_code == 401

    @patch("api.auth.cleanup_expired_sessions")
    def test_logout(self, mock_cleanup, authenticated_client):
        """Test user logout"""
        mock_cleanup.return_value = None

        response = authenticated_client.post(
            "/api/auth/logout"
        )

        assert response.status_code == 200
        assert "message" in response.json()
        assert "logged out successfully" in response.json()["message"]
        mock_cleanup.assert_called_once()

    def test_auth_status(self, authenticated_client):
        """Test authentication status check"""
        response = authenticated_client.get(
            "/api/auth/status"
        )

        assert response.status_code == 200
        data = response.json()

        assert data["authenticated"] is True
        assert data["user"]["email"] == "test@example.com"

    def test_auth_status_no_auth(self):
        """Test authentication status without token"""
        response = self.client.get("/api/auth/status")

        assert response.status_code == 401


class TestAuthDependencies:
    """Test authentication dependency functions"""

    @patch("core.auth.validate_access_token")
    async def test_get_current_user_valid_token(self, mock_validate):
        """Test get_current_user with valid token"""
        from core.auth import get_current_user

        mock_user = {"id": "user-123", "email": "test@example.com"}
        mock_validate.return_value = mock_user

        result = await get_current_user("Bearer valid-token")

        assert result == mock_user
        mock_validate.assert_called_once_with("valid-token")

    @patch("core.auth.validate_access_token")
    async def test_get_current_user_invalid_token(self, mock_validate):
        """Test get_current_user with invalid token"""
        from core.auth import get_current_user
        from fastapi import HTTPException

        mock_validate.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user("Bearer invalid-token")

        assert exc_info.value.status_code == 401
        assert "Invalid or expired token" in str(exc_info.value.detail)

    async def test_get_current_user_no_header(self):
        """Test get_current_user without authorization header"""
        from core.auth import get_current_user
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user("")  # Empty string instead of None

        assert exc_info.value.status_code == 401
        assert "Authorization header required" in str(exc_info.value.detail)

    @patch("core.auth.validate_access_token")
    async def test_get_current_user_malformed_header(self, mock_validate):
        """Test get_current_user with malformed header"""
        from core.auth import get_current_user
        from fastapi import HTTPException

        # When the header doesn't start with "Bearer ", it uses the whole string as token
        # and validate_access_token returns None, resulting in "Invalid or expired token"
        mock_validate.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user("InvalidFormat")

        assert exc_info.value.status_code == 401
        assert "Invalid or expired token" in str(exc_info.value.detail)
