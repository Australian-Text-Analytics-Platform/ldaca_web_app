"""Authentication tests adjusted for standardized single-user 'test' identity."""

import pytest

TEST_USER_ID = "test"
TEST_USER_EMAIL = "test@localhost"
TEST_USER_NAME = "Test User"


class TestCurrentAuthConfiguration:
    @pytest.fixture(autouse=True)
    def setup_client(self, test_client):
        self.client = test_client

    def test_auth_info_shows_single_user_mode(self):
        response = self.client.get("/api/auth/")
        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True
        assert data["multi_user_mode"] is False
        assert data["requires_authentication"] is False
        assert data["user"]["id"] == TEST_USER_ID
        assert data["user"]["email"] == TEST_USER_EMAIL

    def test_me_endpoint_returns_single_user(self):
        response = self.client.get("/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == TEST_USER_ID
        assert data["email"] == TEST_USER_EMAIL
        assert data["name"] == TEST_USER_NAME

    def test_status_endpoint_shows_authenticated(self):
        response = self.client.get("/api/auth/status")
        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True
        assert data["user"]["id"] == TEST_USER_ID

    def test_logout_not_applicable_single_user(self):
        response = self.client.post("/api/auth/logout")
        assert response.status_code == 200
        data = response.json()
        assert "single-user mode" in data["message"].lower()

    def test_google_auth_disabled_single_user(self):
        response = self.client.post("/api/auth/google", json={"id_token": "test-token"})
        assert response.status_code == 400
        data = response.json()
        assert "single-user mode" in data["detail"].lower()


class TestAuthenticatedClientBehavior:
    def test_authenticated_client_overrides_auth(self, authenticated_client):
        response = authenticated_client.get("/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == TEST_USER_ID
        assert data["email"] == "test@example.com"  # fixture uses this email
        assert data["name"] == TEST_USER_NAME

    def test_authenticated_client_status(self, authenticated_client):
        response = authenticated_client.get("/api/auth/status")
        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True
        assert data["user"]["email"] == "test@example.com"

    def test_authenticated_client_logout(self, authenticated_client):
        response = authenticated_client.post("/api/auth/logout")
        assert response.status_code == 200


class TestAuthFunctionBehavior:
    @pytest.fixture(autouse=True)
    def setup_auth_config(self):
        """Set up mocked config for auth function testing"""
        from unittest.mock import MagicMock, patch

        # Create a mock settings object with test values
        mock_settings = MagicMock()
        mock_settings.multi_user = False
        mock_settings.single_user_id = TEST_USER_ID
        mock_settings.single_user_name = TEST_USER_NAME
        mock_settings.single_user_email = TEST_USER_EMAIL

        # Patch settings in the core.auth module
        with patch("ldaca_web_app_backend.core.auth.settings", mock_settings):
            yield mock_settings

    async def test_get_current_user_single_user_mode(self):
        from ldaca_web_app_backend.core.auth import get_current_user

        result1 = await get_current_user("Bearer test-token")
        result2 = await get_current_user("different-token")
        result3 = await get_current_user(None)
        for result in [result1, result2, result3]:
            assert result["id"] == TEST_USER_ID
            assert result["email"] == TEST_USER_EMAIL
            assert result["name"] == TEST_USER_NAME

    def test_available_auth_methods_single_user(self):
        from ldaca_web_app_backend.core.auth import get_available_auth_methods

        methods = get_available_auth_methods()
        assert methods == []
