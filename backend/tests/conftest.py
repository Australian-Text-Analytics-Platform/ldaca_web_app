"""
Configuration for pytest tests
Provides shared fixtures and setup for all tests
"""

import asyncio
import glob
import shutil
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add backend to Python path for imports
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session", autouse=True)
async def init_test_db():
    """Initialize test database with tables for all tests"""
    # Import after setting up the path
    import config
    import db

    # Use in-memory database for tests
    original_url = config.config.database_url
    config.config.database_url = "sqlite+aiosqlite:///:memory:"

    # Recreate engine with test database
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    db.engine = create_async_engine(config.config.database_url)
    db.async_session_maker = async_sessionmaker(db.engine, expire_on_commit=False)

    # Create tables
    await db.create_db_and_tables()

    yield

    # Cleanup
    await db.engine.dispose()
    config.config.database_url = original_url


@pytest.fixture
async def test_db_session():
    """Provide a test database session"""
    import db

    async with db.async_session_maker() as session:
        yield session


@pytest.fixture
def authenticated_client():
    """Provide a test client with mocked authentication"""
    # Mock user that will be returned by the authentication dependency
    from datetime import datetime
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    mock_user = {
        "id": "test-user-123",
        "email": "test@example.com",
        "name": "Test User",
        "picture": "https://example.com/avatar.jpg",
        "created_at": datetime(2024, 1, 1, 0, 0, 0),
        "last_login": datetime(2024, 1, 1, 12, 0, 0),
        "is_active": True,
        "is_verified": True,
    }

    # Import and setup the app with mocked config
    with patch("config.settings") as mock_config:
        mock_config.cors_allowed_origins = ["http://localhost:3000"]
        mock_config.allowed_origins = ["http://localhost:3000"]
        mock_config.cors_allow_credentials = True
        mock_config.google_client_id = "test-client-id"
        mock_config.database_url = "sqlite+aiosqlite:///:memory:"

        # Mock the data_folder as a MagicMock that has mkdir
        mock_data_folder = MagicMock()
        mock_data_folder.mkdir = MagicMock()
        mock_config.data_folder = mock_data_folder

        # Mock database functions to avoid initialization issues
        with patch("db.init_db"), patch("db.cleanup_expired_sessions"):
            from core.auth import get_current_user

            from main import app

            # Override the dependency with our mock user
            def mock_get_current_user():
                return mock_user

            app.dependency_overrides[get_current_user] = mock_get_current_user

            client = TestClient(app)
            yield client

            # Clean up the override after the test
            app.dependency_overrides.clear()


@pytest.fixture
def test_client():
    """Provide a test client without authentication"""
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    with patch("config.settings") as mock_config:
        mock_config.cors_allowed_origins = ["http://localhost:3000"]
        mock_config.allowed_origins = ["http://localhost:3000"]
        mock_config.cors_allow_credentials = True
        mock_config.google_client_id = "test-client-id"
        mock_config.database_url = "sqlite+aiosqlite:///:memory:"

        # Mock the data_folder as a MagicMock that has mkdir
        mock_data_folder = MagicMock()
        mock_data_folder.mkdir = MagicMock()
        mock_config.data_folder = mock_data_folder

        # Mock database functions to avoid initialization issues
        with patch("db.init_db"), patch("db.cleanup_expired_sessions"):
            from main import app

            client = TestClient(app)
            yield client


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files"""
    temp_path = tempfile.mkdtemp()
    yield Path(temp_path)
    shutil.rmtree(temp_path)


@pytest.fixture
def mock_settings():
    """Mock the config module with test configuration"""
    with patch("config.config") as mock_config:
        # Core settings
        mock_config.database_url = "sqlite+aiosqlite:///:memory:"
        mock_config.user_data_folder = "./test_data"
        mock_config.sample_data_folder = "./test_data/sample_data"
        mock_config.server_host = "127.0.0.1"
        mock_config.server_port = 8000
        mock_config.debug = True
        mock_config.cors_allowed_origins = ["http://localhost:3000"]
        mock_config.cors_allow_credentials = True
        mock_config.google_client_id = "test-client-id"
        mock_config.token_expire_hours = 1
        mock_config.secret_key = "test-secret-key"
        mock_config.log_level = "DEBUG"
        mock_config.log_file = "./test_logs/test.log"

        # Backward compatibility properties
        mock_config.data_folder = Path("./test_data")
        mock_config.allowed_origins = ["http://localhost:3000"]

        # Path methods
        mock_config.get_user_data_folder.return_value = Path("./test_data")
        mock_config.get_sample_data_folder.return_value = Path(
            "./test_data/sample_data"
        )
        mock_config.get_database_backup_folder.return_value = Path(
            "./test_data/backups"
        )

        yield mock_config


@pytest.fixture
def mock_workspace_manager():
    """Mock workspace manager for testing"""
    with patch("core.workspace.workspace_manager") as mock_manager:
        mock_manager.get_user_workspaces.return_value = {}
        mock_manager.create_workspace.return_value = {
            "id": "test-workspace-123",
            "name": "Test Workspace",
            "description": "Test description",
            "created_at": "2024-01-01T00:00:00Z",
            "modified_at": "2024-01-01T00:00:00Z",
            "nodes": {},
        }
        yield mock_manager


@pytest.fixture
def sample_dataframe_data():
    """Sample data for DataFrame testing"""
    return [
        {"name": "Alice", "age": 25, "city": "New York"},
        {"name": "Bob", "age": 30, "city": "London"},
        {"name": "Charlie", "age": 35, "city": "Tokyo"},
    ]


@pytest.fixture
def sample_user_data():
    """Sample user data for testing"""
    return {
        "id": "test-user-123",
        "email": "test@example.com",
        "name": "Test User",
        "picture": "https://example.com/avatar.jpg",
        "created_at": "2024-01-01T00:00:00Z",
        "last_login": "2024-01-01T12:00:00Z",
    }


# Deprecated fixture name for backward compatibility
@pytest.fixture
def mock_config(mock_settings):
    """Deprecated: Use mock_settings instead"""
    return mock_settings


@pytest.fixture
def sample_csv_file(temp_dir):
    """Create a sample CSV file for testing"""
    csv_content = """name,age,city
Alice,25,New York
Bob,30,London
Charlie,35,Tokyo"""

    csv_file = temp_dir / "sample.csv"
    csv_file.write_text(csv_content)
    return csv_file


@pytest.fixture
def sample_json_file(temp_dir):
    """Create a sample JSON file for testing"""
    json_content = """[
    {"name": "Alice", "age": 25, "city": "New York"},
    {"name": "Bob", "age": 30, "city": "London"},
    {"name": "Charlie", "age": 35, "city": "Tokyo"}
]"""

    json_file = temp_dir / "sample.json"
    json_file.write_text(json_content)
    return json_file


@pytest.fixture
def mock_user():
    """Mock user data for testing"""
    return {
        "id": "test-user-123",
        "email": "test@example.com",
        "name": "Test User",
        "picture": "https://example.com/avatar.jpg",
        "created_at": "2024-01-01T00:00:00Z",
        "last_login": "2024-01-01T12:00:00Z",
    }


@pytest.fixture
def mock_google_token():
    """Mock Google OAuth token data"""
    return {
        "iss": "accounts.google.com",
        "sub": "test-google-id-123",
        "email": "test@example.com",
        "email_verified": True,
        "name": "Test User",
        "picture": "https://example.com/avatar.jpg",
    }


# Test data constants
SAMPLE_DATAFRAME_DATA = [
    {"name": "Alice", "age": 25, "city": "New York"},
    {"name": "Bob", "age": 30, "city": "London"},
    {"name": "Charlie", "age": 35, "city": "Tokyo"},
]

SAMPLE_TEXT_DATA = [
    {"document_id": 1, "text": "This is a sample document about machine learning."},
    {
        "document_id": 2,
        "text": "Another document discussing natural language processing.",
    },
    {"document_id": 3, "text": "A third document on artificial intelligence topics."},
]


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_user_folders():
    """Automatically clean up test user folders after test session"""
    yield  # Let tests run first

    # Cleanup after all tests are done
    backend_root = Path(__file__).parent.parent
    data_folder = backend_root / "data"

    if not data_folder.exists():
        return

    # List of test user folder patterns to clean up
    test_patterns = [
        "user_fresh_user_*",
        "user_test_user*",
        "user_test-user-*",
        "user_new_user_*",
        "user_user1_*",
        "user_user2_*",
        "user_12345678-1234-5678-*",  # Test UUID pattern
    ]

    for pattern in test_patterns:
        pattern_path = data_folder / pattern
        for folder in glob.glob(str(pattern_path)):
            folder_path = Path(folder)
            if folder_path.is_dir():
                try:
                    shutil.rmtree(folder_path)
                    print(f"Cleaned up test folder: {folder_path.name}")
                except Exception as e:
                    print(f"Warning: Could not remove {folder_path}: {e}")


@pytest.fixture
def test_user_cleanup():
    """Clean up specific test user folders created during individual tests"""
    created_folders = []

    def track_folder(user_id: str):
        """Track a user folder for cleanup"""
        backend_root = Path(__file__).parent.parent
        data_folder = backend_root / "data"
        user_folder = data_folder / f"user_{user_id}"
        created_folders.append(user_folder)
        return user_folder

    yield track_folder

    # Cleanup tracked folders
    for folder_path in created_folders:
        if folder_path.exists() and folder_path.is_dir():
            try:
                shutil.rmtree(folder_path)
            except Exception as e:
                print(f"Warning: Could not remove {folder_path}: {e}")
