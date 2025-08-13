#!/usr/bin/env python3
"""Quick verification that our test fixtures work correctly"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add backend to Python path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))


def test_isolation():
    """Test that our mocking approach works"""
    print("Testing configuration isolation...")

    # First check production config
    from config import settings as prod_settings

    print(f"Production config: {prod_settings.single_user_id}")

    # Now test our mocking approach
    mock_settings = MagicMock()
    mock_settings.multi_user = False  # This is crucial!
    mock_settings.single_user_id = "test"
    mock_settings.single_user_email = "test@localhost"
    mock_settings.single_user_name = "Test User"

    with (
        patch("config.settings", mock_settings),
        patch("core.auth.settings", mock_settings),
    ):
        # Import and test
        import asyncio

        from core.auth import get_current_user

        result = asyncio.run(get_current_user(None))
        print(f"Mocked result: {result['id']} / {result['email']}")

        assert result["id"] == "test"
        assert result["email"] == "test@localhost"

    # Verify production config is unchanged
    print(f"Production config after mocking: {prod_settings.single_user_id}")
    print("✅ Test isolation working correctly!")


if __name__ == "__main__":
    test_isolation()
