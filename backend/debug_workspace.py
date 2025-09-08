#!/usr/bin/env python3
"""Debug workspace creation"""

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx

# Add the source to the path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from ldaca_web_app_backend.core.auth import get_current_user
from ldaca_web_app_backend.main import app


async def test_workspace_creation():
    # Mock user
    mock_user = {
        "id": "test",
        "email": "test@example.com",
        "name": "Test User",
        "picture": "https://example.com/avatar.jpg",
        "is_active": True,
        "is_verified": True,
    }

    # Create mock settings
    mock_settings = MagicMock()
    mock_settings.cors_allowed_origins = ["http://localhost:3000"]
    mock_settings.cors_allow_credentials = True
    mock_settings.multi_user = False
    mock_settings.single_user_id = "test"
    mock_settings.single_user_name = "Test User"
    mock_settings.single_user_email = "test@localhost"
    mock_settings.google_client_id = ""
    mock_settings.database_url = "sqlite+aiosqlite:///:memory:"

    mock_data_folder = MagicMock()
    mock_data_folder.mkdir = MagicMock()
    mock_settings.get_user_data_folder = MagicMock(return_value=mock_data_folder)

    with (
        patch("ldaca_web_app_backend.config.settings", mock_settings),
        patch("ldaca_web_app_backend.main.settings", mock_settings),
        patch("ldaca_web_app_backend.api.auth.settings", mock_settings),
        patch("ldaca_web_app_backend.core.auth.settings", mock_settings),
        patch("ldaca_web_app_backend.db.init_db"),
        patch("ldaca_web_app_backend.db.cleanup_expired_sessions"),
    ):

        def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            try:
                # Test workspace creation
                response = await client.post(
                    "/api/workspaces/",
                    json={
                        "name": "test_workspace",
                        "description": "Test workspace for analysis",
                    },
                )
                print(f"Status: {response.status_code}")
                print(f"Response: {response.text}")
                if response.status_code == 200:
                    print("✅ Workspace creation successful!")
                    return response.json()["workspace_id"]
                else:
                    print("❌ Workspace creation failed")
                    return None
            except Exception as e:
                print(f"❌ Exception: {e}")
                import traceback

                traceback.print_exc()
                return None

        app.dependency_overrides.clear()


if __name__ == "__main__":
    asyncio.run(test_workspace_creation())
