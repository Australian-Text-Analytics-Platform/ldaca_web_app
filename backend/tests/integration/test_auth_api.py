"""
Authentication API endpoint tests
Tests all HTTP endpoints related to authentication: /api/auth/*, /api/auth/me, etc.
"""

import pytest

# Test user constants
TEST_USER_ID = "test"
TEST_USER_EMAIL = "test@localhost"
TEST_USER_NAME = "Test User"


class TestAuthenticationEndpoints:
    """Test all authentication API endpoints"""

    @pytest.fixture(autouse=True)
    def setup_client(self, test_client):
        """Set up test client"""
        self.client = test_client

    def test_auth_info_endpoint(self):
        """Test /api/auth/ endpoint returns correct structure"""
        response = self.client.get("/api/auth/")
        assert response.status_code == 200

        data = response.json()
        assert "authenticated" in data
        assert "multi_user_mode" in data
        assert "requires_authentication" in data
        assert "user" in data

        # In test mode, should be single-user mode
        assert data["authenticated"] is True
        assert data["multi_user_mode"] is False
        assert data["requires_authentication"] is False
        assert data["user"]["id"] == TEST_USER_ID
        assert data["user"]["email"] == TEST_USER_EMAIL

    def test_me_endpoint(self):
        """Test /api/auth/me endpoint returns user info"""
        response = self.client.get("/api/auth/me")
        assert response.status_code == 200

        data = response.json()
        assert data["id"] == TEST_USER_ID
        assert data["email"] == TEST_USER_EMAIL
        assert data["name"] == TEST_USER_NAME
        assert "picture" in data
        assert "is_active" in data

    def test_status_endpoint(self):
        """Test /api/auth/status endpoint"""
        response = self.client.get("/api/auth/status")
        assert response.status_code == 200

        data = response.json()
        assert data["authenticated"] is True
        assert data["user"]["id"] == TEST_USER_ID

    def test_logout_endpoint_single_user_mode(self):
        """Test /api/auth/logout in single-user mode"""
        response = self.client.post("/api/auth/logout")
        assert response.status_code == 200

        data = response.json()
        assert "message" in data
        assert "single-user mode" in data["message"].lower()

    def test_google_auth_disabled_in_single_user(self):
        """Test Google OAuth is disabled in single-user mode"""
        response = self.client.post("/api/auth/google", json={"id_token": "test-token"})
        assert response.status_code == 400

        data = response.json()
        assert "detail" in data
        assert "single-user mode" in data["detail"].lower()


class TestAuthenticatedEndpoints:
    """Test endpoints that require authentication"""

    @pytest.fixture(autouse=True)
    def setup_client(self, authenticated_client):
        """Set up authenticated test client"""
        self.client = authenticated_client

    def test_me_with_authenticated_client(self):
        """Test /api/auth/me with authenticated client"""
        response = self.client.get("/api/auth/me")
        assert response.status_code == 200

        data = response.json()
        assert data["id"] == TEST_USER_ID
        assert data["email"] == "test@example.com"  # From authenticated_client fixture
        assert data["name"] == TEST_USER_NAME

    def test_status_with_authenticated_client(self):
        """Test /api/auth/status with authenticated client"""
        response = self.client.get("/api/auth/status")
        assert response.status_code == 200

        data = response.json()
        assert data["authenticated"] is True
        assert data["user"]["id"] == TEST_USER_ID

    def test_logout_with_authenticated_client(self):
        """Test logout behavior with authenticated client"""
        response = self.client.post("/api/auth/logout")
        assert response.status_code == 200

        data = response.json()
        assert "message" in data


class TestAuthenticationMethods:
    """Test available authentication methods"""

    @pytest.fixture(autouse=True)
    def setup_client(self, test_client):
        """Set up test client"""
        self.client = test_client

    def test_available_auth_methods_single_user(self):
        """Test that no auth methods are available in single-user mode"""
        response = self.client.get("/api/auth/")
        assert response.status_code == 200

        data = response.json()
        assert "available_auth_methods" in data
        assert data["available_auth_methods"] == []
