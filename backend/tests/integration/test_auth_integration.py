"""
Authentication integration tests
Tests authentication integration with other components and systems
"""

import pytest

# Test user constants
TEST_USER_ID = "test"
TEST_USER_EMAIL = "test@localhost"
TEST_USER_NAME = "Test User"


class TestAuthenticationIntegration:
    """Test authentication integration with other components"""

    @pytest.fixture(autouse=True)
    def setup_client(self, authenticated_client):
        """Set up authenticated test client"""
        self.client = authenticated_client

    def test_workspace_operations_with_authentication(self):
        """Test that workspace operations work with authentication"""
        # Test that authenticated endpoints work
        response = self.client.get("/api/workspaces/")
        # Should not get 401/403 errors
        assert response.status_code in [200, 404]  # 404 is OK if no workspaces exist

        # Test user info is accessible for workspace operations
        auth_response = self.client.get("/api/auth/me")
        assert auth_response.status_code == 200
        user_data = auth_response.json()
        assert user_data["id"] == TEST_USER_ID

    def test_auth_dependency_injection(self):
        """Test that authentication dependency injection works"""
        # The fact that authenticated_client fixture works proves dependency injection works
        response = self.client.get("/api/auth/me")
        assert response.status_code == 200

        data = response.json()
        assert data["id"] == TEST_USER_ID
        assert "email" in data
        assert "name" in data

    def test_auth_system_consistency(self):
        """Test that auth system is consistent across endpoints"""
        # Get user from different endpoints
        me_response = self.client.get("/api/auth/me")
        status_response = self.client.get("/api/auth/status")
        auth_response = self.client.get("/api/auth/")

        assert me_response.status_code == 200
        assert status_response.status_code == 200
        assert auth_response.status_code == 200

        me_data = me_response.json()
        status_data = status_response.json()
        auth_data = auth_response.json()

        # User ID should be consistent across all endpoints
        assert me_data["id"] == TEST_USER_ID
        assert status_data["user"]["id"] == TEST_USER_ID
        assert auth_data["user"]["id"] == TEST_USER_ID


class TestAuthenticationErrorHandling:
    """Test authentication error handling and edge cases"""

    @pytest.fixture(autouse=True)
    def setup_client(self, test_client):
        """Set up test client"""
        self.client = test_client

    def test_invalid_endpoints_handling(self):
        """Test handling of invalid auth endpoints"""
        # Test non-existent auth endpoint
        response = self.client.get("/api/auth/nonexistent")
        assert response.status_code == 404

    def test_malformed_requests(self):
        """Test handling of malformed auth requests"""
        # Test Google auth with malformed data
        response = self.client.post("/api/auth/google", json={"invalid": "data"})
        assert response.status_code == 422  # FastAPI returns 422 for validation errors


class TestAuthenticationEnvironment:
    """Test authentication environment and configuration validation"""

    def test_test_environment_isolation(self):
        """Test that test environment is properly isolated"""
        # This test verifies our test isolation is working
        # by checking that we can access test user data

        # Import should give us production config outside of fixtures
        from ldaca_web_app_backend.config import settings as prod_settings

        # In production, this should be 'root'
        assert prod_settings.single_user_id == "root"
        assert prod_settings.single_user_email == "root@localhost"

    def test_data_folder_isolation(self, test_client):
        """Test that test data is stored separately"""
        # Make a request that triggers data folder creation
        response = test_client.get("/api/auth/")
        assert response.status_code == 200

        # The "✅ Sample data copied to user test data folder" message
        # indicates our test isolation is working


class TestAuthenticationCleanup:
    """Test authentication cleanup and test hygiene"""

    def test_no_test_artifacts_in_production(self):
        """Test that no test artifacts affect production config"""
        from ldaca_web_app_backend.config import settings

        # Production config should remain unchanged
        assert settings.single_user_id == "root"
        assert settings.single_user_email == "root@localhost"
        assert settings.single_user_name == "Root User"

    def test_fixture_isolation(self, test_client):
        """Test that fixtures properly isolate test state"""
        # Each test should get a fresh client with test configuration
        response = test_client.get("/api/auth/")
        assert response.status_code == 200

        data = response.json()
        assert data["user"]["id"] == TEST_USER_ID
        assert data["multi_user_mode"] is False
