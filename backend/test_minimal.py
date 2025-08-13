#!/usr/bin/env python3
"""Minimal test to check if TestClient works"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add backend to Python path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))


def test_minimal():
    """Test basic TestClient functionality"""
    print("Starting minimal test...")

    from fastapi.testclient import TestClient

    print("Creating mocked config...")
    with patch("config.settings") as mock_config:
        mock_config.cors_allowed_origins = ["http://localhost:3000"]
        mock_config.allowed_origins = ["http://localhost:3000"]
        mock_config.cors_allow_credentials = True
        mock_config.multi_user = False
        mock_config.single_user_id = "test"
        mock_config.single_user_name = "Test User"
        mock_config.single_user_email = "test@localhost"
        mock_config.google_client_id = ""
        mock_config.database_url = "sqlite+aiosqlite:///:memory:"

        # Mock the data_folder
        mock_data_folder = MagicMock()
        mock_data_folder.mkdir = MagicMock()
        mock_config.data_folder = mock_data_folder

        print("Mocking database functions...")
        with (
            patch("db.init_db") as mock_init_db,
            patch("db.cleanup_expired_sessions") as mock_cleanup,
        ):
            print("Importing main app...")
            from main import app

            print("Creating TestClient...")
            client = TestClient(app)

            print("Making test request...")
            response = client.get("/api/auth/")
            print(f"Response status: {response.status_code}")
            print(f"Response data: {response.json()}")

            print("Test completed successfully!")


if __name__ == "__main__":
    test_minimal()
