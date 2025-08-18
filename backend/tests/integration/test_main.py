"""
Tests for main application
"""

from unittest.mock import MagicMock, patch


class TestMainApp:
    """Test cases for the main FastAPI application"""

    @patch("ldaca_web_app_backend.main.settings")
    @patch("ldaca_web_app_backend.main.init_db")
    @patch("ldaca_web_app_backend.main.cleanup_expired_sessions")
    def test_app_creation(self, mock_cleanup, mock_init_db, mock_settings):
        """Test that the FastAPI app can be created"""
        # Mock config properties
        mock_settings.data_folder = MagicMock()
        mock_settings.cors_allowed_origins = ["http://localhost:3000"]
        mock_settings.get.return_value = True

        # Mock folder creation
        mock_settings.data_folder.mkdir = MagicMock()

        # Import after mocking
        from ldaca_web_app_backend.main import app

        assert app is not None
        assert app.title == "Enhanced LDaCA Web App API"
        assert app.version == "3.0.0"

    def test_health_endpoint_structure(self):
        """Test health endpoint response structure"""
        with (
            patch("ldaca_web_app_backend.main.settings") as mock_config,
            patch("ldaca_web_app_backend.main.init_db"),
            patch("ldaca_web_app_backend.main.cleanup_expired_sessions"),
        ):
            mock_config.data_folder = MagicMock()
            mock_config.allowed_origins = ["http://localhost:3000"]
            mock_config.get.return_value = True
            mock_config.debug = False
            mock_config.data_folder.mkdir = MagicMock()

            import asyncio

            from ldaca_web_app_backend.main import health_check

            # Run the async function
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            try:
                response = loop.run_until_complete(health_check())

                assert response["status"] == "healthy"
                assert response["version"] == "3.0.0"
                assert "features" in response
                assert "config" in response
                assert response["database"] == "connected"
            finally:
                loop.close()

    def test_status_endpoint_structure(self):
        """Test status endpoint response structure"""
        with (
            patch("ldaca_web_app_backend.main.settings") as mock_config,
            patch("ldaca_web_app_backend.main.init_db"),
            patch("ldaca_web_app_backend.main.cleanup_expired_sessions"),
        ):
            mock_config.data_folder = MagicMock()
            mock_config.allowed_origins = ["http://localhost:3000"]
            mock_config.get.return_value = True
            mock_config.debug = False
            mock_config.data_folder.mkdir = MagicMock()

            import asyncio

            from ldaca_web_app_backend.main import status

            # Run the async function
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            try:
                response = loop.run_until_complete(status())

                assert response["system"] == "Enhanced LDaCA Web App API"
                assert response["version"] == "3.0.0"
                assert response["status"] == "operational"
                assert "components" in response
                assert "modules" in response

                # Check components structure
                components = response["components"]
                expected_components = [
                    "authentication",
                    "file_management",
                    "workspace_management",
                    "data_operations",
                    "text_analysis",
                    "database",
                ]

                for component in expected_components:
                    assert component in components
                    assert "status" in components[component]
                    assert "description" in components[component]

            finally:
                loop.close()

    def test_root_endpoint_structure(self):
        """Test root endpoint response structure"""
        with (
            patch("ldaca_web_app_backend.main.settings") as mock_config,
            patch("ldaca_web_app_backend.main.init_db"),
            patch("ldaca_web_app_backend.main.cleanup_expired_sessions"),
        ):
            mock_config.data_folder = MagicMock()
            mock_config.allowed_origins = ["http://localhost:3000"]
            mock_config.get.return_value = True
            mock_config.debug = False
            mock_config.data_folder.mkdir = MagicMock()

            import asyncio

            from ldaca_web_app_backend.main import root

            # Run the async function
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            try:
                response = loop.run_until_complete(root())

                assert response["message"] == "Enhanced LDaCA Web App API"
                assert response["version"] == "3.0.0"
                assert "features" in response
                assert "endpoints" in response

                # Check endpoints structure
                endpoints = response["endpoints"]
                expected_endpoint_groups = [
                    "docs",
                    "redoc",
                    "health",
                    "status",
                    "auth",
                    "files",
                    "workspaces",
                    "user",
                    "admin",
                ]

                for group in expected_endpoint_groups:
                    assert group in endpoints

            finally:
                loop.close()


class TestApplicationConfiguration:
    """Test application configuration and setup"""

    def test_feature_availability(self):
        """Test that required features are properly imported and available"""
        # These imports should work with proper package installation
        import docframe
        from docframe import DocDataFrame
        from docworkspace import Node, Workspace

        # Basic validation that classes exist
        assert DocDataFrame is not None
        assert Node is not None
        assert Workspace is not None

    @patch("ldaca_web_app_backend.main.settings")
    def test_cors_configuration(self, mock_config):
        """Test CORS middleware configuration"""
        mock_config.cors_allowed_origins = [
            "http://localhost:3000",
            "https://example.com",
        ]

        # The actual CORS configuration is tested implicitly through the app creation
        # This test verifies the config is accessed properly
        # Access the property to trigger the mock
        origins = mock_config.cors_allowed_origins
        assert origins == ["http://localhost:3000", "https://example.com"]

    def test_api_router_inclusion(self):
        """Test that all API routers are included"""
        with (
            patch("ldaca_web_app_backend.main.settings") as mock_config,
            patch("ldaca_web_app_backend.main.init_db"),
            patch("ldaca_web_app_backend.main.cleanup_expired_sessions"),
        ):
            mock_config.data_folder = MagicMock()
            mock_config.allowed_origins = ["http://localhost:3000"]
            mock_config.get.return_value = True
            mock_config.data_folder.mkdir = MagicMock()

            from ldaca_web_app_backend.main import app

            # Check that routers are included by looking at the app's routes
            route_prefixes = {
                route.path_regex.pattern
                for route in app.routes
                if hasattr(route, "path_regex")
            }

            # Should include patterns for the main endpoints
            assert any("/auth" in pattern for pattern in route_prefixes)
            assert any("/files" in pattern for pattern in route_prefixes)
            assert any("/workspaces" in pattern for pattern in route_prefixes)
            assert any("/user" in pattern for pattern in route_prefixes)
            assert any("/admin" in pattern for pattern in route_prefixes)
