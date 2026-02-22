"""
Configuration for pytest tests
Provides shared fixtures and setup for all tests
"""

import shutil
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from ldaca_web_app_backend import db


@pytest.fixture(scope="session", autouse=True)
async def init_test_db():
    """Initialize test database with tables for all tests"""
    # Import after setting up the path

    # Use in-memory database for tests without modifying the global config
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    # Create a test-specific database engine
    test_db_url = "sqlite+aiosqlite:///:memory:"
    test_engine = create_async_engine(test_db_url)
    test_session_maker = async_sessionmaker(test_engine, expire_on_commit=False)

    # Store the original for restoration
    original_engine = getattr(db, "engine", None)
    original_session_maker = getattr(db, "async_session_maker", None)

    # Replace with test versions
    db.engine = test_engine
    db.async_session_maker = test_session_maker

    # Create tables in the test database
    await db.create_db_and_tables()

    yield

    # Cleanup
    await test_engine.dispose()

    # Restore original if they existed
    if original_engine:
        db.engine = original_engine
    if original_session_maker:
        db.async_session_maker = original_session_maker


@pytest.fixture
def settings_override(tmp_path: Path):
    """Provide MagicMock settings pointing to a temporary data root.

    This isolates tests from the repository filesystem and avoids cleanup needs.
    """
    mock_settings = MagicMock()
    # Path helpers
    mock_settings.get_data_root.return_value = tmp_path
    mock_settings.get_user_data_folder.return_value = tmp_path / "users"
    mock_settings.get_sample_data_folder.return_value = tmp_path / "sample_data"
    mock_settings.get_database_backup_folder.return_value = tmp_path / "backups"
    # Back-compat attributes some code might read
    mock_settings.data_folder = tmp_path
    mock_settings.user_data_folder = "users"
    mock_settings.sample_data_folder = "sample_data"
    mock_settings.allowed_origins = ["http://localhost:3000"]
    # Core config
    mock_settings.cors_allowed_origins = ["http://localhost:3000"]
    mock_settings.cors_allow_credentials = True
    mock_settings.multi_user = False
    mock_settings.single_user_id = "test"
    mock_settings.single_user_name = "Test User"
    mock_settings.single_user_email = "test@localhost"
    mock_settings.google_client_id = ""
    mock_settings.database_url = "sqlite+aiosqlite:///:memory:"
    mock_settings.server_host = "127.0.0.1"
    mock_settings.server_port = 8001
    mock_settings.debug = True
    return mock_settings


@pytest.fixture
async def test_db_session():
    """Provide a test database session"""
    from ldaca_web_app_backend import db

    async with db.async_session_maker() as session:
        yield session


@pytest.fixture
def temp_data_root(test_user):
    """Ensure a temporary user data root exists for tests that write files.

    This creates the user's data directory used by get_user_data_folder so tests
    that write files without explicitly creating directories will work reliably.
    """
    from ldaca_web_app_backend.core.utils import get_user_data_folder

    user_data_dir = get_user_data_folder(test_user["id"])
    user_data_dir.mkdir(parents=True, exist_ok=True)
    return user_data_dir.parent


@pytest.fixture
async def authenticated_client(settings_override):
    """Async test client with mocked authentication and isolated temp data root."""
    from datetime import datetime

    import httpx
    from ldaca_web_app_backend.core.auth import get_current_user
    from ldaca_web_app_backend.main import app

    mock_user = {
        "id": "test",
        "email": "test@example.com",
        "name": "Test User",
        "picture": "https://example.com/avatar.jpg",
        "created_at": datetime(2024, 1, 1, 0, 0, 0),
        "last_login": datetime(2024, 1, 1, 12, 0, 0),
        "is_active": True,
        "is_verified": True,
    }

    def mock_get_current_user():
        return mock_user

    patches = [
        patch("ldaca_web_app_backend.settings.settings", settings_override),
        patch("ldaca_web_app_backend.main.settings", settings_override),
        patch("ldaca_web_app_backend.api.auth.settings", settings_override),
        patch("ldaca_web_app_backend.core.auth.settings", settings_override),
        patch("ldaca_web_app_backend.core.utils.settings", settings_override),
        patch("ldaca_web_app_backend.db.init_db"),
        patch("ldaca_web_app_backend.db.cleanup_expired_sessions"),
    ]

    for p in patches:
        p.start()

    app.dependency_overrides[get_current_user] = mock_get_current_user

    try:
        transport = httpx.ASGITransport(app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        for p in patches:
            p.stop()


@pytest.fixture
async def test_client(settings_override):
    """Provide an async test client without authentication (single-user mode)."""
    import httpx
    from ldaca_web_app_backend.main import app

    patches = [
        patch("ldaca_web_app_backend.settings.settings", settings_override),
        patch("ldaca_web_app_backend.main.settings", settings_override),
        patch("ldaca_web_app_backend.api.auth.settings", settings_override),
        patch("ldaca_web_app_backend.core.auth.settings", settings_override),
        patch("ldaca_web_app_backend.core.utils.settings", settings_override),
        patch("ldaca_web_app_backend.db.init_db"),
        patch("ldaca_web_app_backend.db.cleanup_expired_sessions"),
    ]

    for p in patches:
        p.start()

    try:
        transport = httpx.ASGITransport(app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            yield client
    finally:
        for p in patches:
            p.stop()


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files"""
    temp_path = tempfile.mkdtemp()
    yield Path(temp_path)
    shutil.rmtree(temp_path)


@pytest.fixture
def mock_settings():
    """Mock the config module with test configuration"""
    with patch("ldaca_web_app_backend.settings.settings") as mock_config:
        # Core settings
        mock_config.database_url = "sqlite+aiosqlite:///:memory:"
        mock_config.user_data_folder = "./test_data"
        mock_config.sample_data_folder = "./test_data/sample_data"
        mock_config.server_host = "127.0.0.1"
        mock_config.server_port = 8000
        mock_config.debug = True
        mock_config.cors_allowed_origins = ["http://localhost:3000"]
        mock_config.cors_allow_credentials = True
        mock_config.multi_user = False
        mock_config.single_user_id = "test"
        mock_config.single_user_name = "Test User"
        mock_config.single_user_email = "test@localhost"
        mock_config.google_client_id = ""  # Empty for single-user mode
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
    with patch(
        "ldaca_web_app_backend.core.workspace.workspace_manager"
    ) as mock_manager:
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
        "id": "test",
        "email": "test@example.com",
        "name": "Test User",
        "picture": "https://example.com/avatar.jpg",
        "created_at": "2024-01-01T00:00:00Z",
        "last_login": "2024-01-01T12:00:00Z",
    }


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
def sample_plain_text_file(temp_dir):
    """Create a sample plain-text file for testing"""

    text_file = temp_dir / "sample.txt"
    text_file.write_text("Plain text upload support", encoding="utf-8")
    return text_file


@pytest.fixture
def mock_user():
    """Mock user data for testing"""
    return {
        "id": "test",
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


# Analysis persistence test fixtures


@pytest.fixture
def test_user():
    """Provide consistent test user data for analysis tests."""
    return {
        "id": "test",
        "email": "test@example.com",
        "name": "Test User",
        "picture": "https://example.com/avatar.jpg",
        "is_active": True,
        "is_verified": True,
    }


@pytest.fixture
async def workspace_id(authenticated_client):
    """Create a test workspace and ensure it's deleted after the test."""
    response = await authenticated_client.post(
        "/api/workspaces/",
        json={"name": "test_workspace", "description": "Test workspace for analysis"},
    )
    assert response.status_code == 200
    workspace_id = response.json()["id"]

    try:
        yield workspace_id
    finally:
        cleanup_response = await authenticated_client.delete(
            f"/api/workspaces/{workspace_id}"
        )
        if cleanup_response.status_code not in (200, 404):
            raise AssertionError(
                f"Failed to delete test workspace {workspace_id}: "
                f"status={cleanup_response.status_code} body={cleanup_response.text}"
            )


@pytest.fixture
def tiny_text_file(test_user):
    """Create a tiny CSV file for testing."""
    import csv

    from ldaca_web_app_backend.core.utils import get_user_data_folder

    user_data_dir = get_user_data_folder(test_user["id"])
    user_data_dir.mkdir(parents=True, exist_ok=True)

    # Create a tiny CSV file
    tiny_file = user_data_dir / "tiny.csv"
    with open(tiny_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["document"])
        writer.writerow(["Hello world."])
        writer.writerow(["Another sentence."])

    return tiny_file


@pytest.fixture
def sample_text_file(test_user):
    """Create a sample CSV file for testing."""
    import csv

    from ldaca_web_app_backend.core.utils import get_user_data_folder

    user_data_dir = get_user_data_folder(test_user["id"])
    user_data_dir.mkdir(parents=True, exist_ok=True)

    # Create a sample CSV file
    sample_file = user_data_dir / "sample.csv"
    with open(sample_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["document"])
        writer.writerow(["This is a sample document."])
        writer.writerow(["Another sample text for analysis."])
        writer.writerow(["More text content for testing."])
        writer.writerow(["Final sample sentence."])

    return sample_file


@pytest.fixture
def timeline_csv_file(test_user):
    """Create a CSV file with timestamped records for frequency analysis tests."""
    import csv

    from ldaca_web_app_backend.core.utils import get_user_data_folder

    user_data_dir = get_user_data_folder(test_user["id"])
    user_data_dir.mkdir(parents=True, exist_ok=True)

    timeline_file = user_data_dir / "timeline.csv"
    with open(timeline_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["document", "published_at", "category"])
        writer.writerow(["Entry one", "2024-01-01T08:15:00Z", "alpha"])
        writer.writerow(["Entry two", "2024-01-02T09:00:00Z", "beta"])
        writer.writerow(["Entry three", "2024-01-02T11:30:00Z", "alpha"])
        writer.writerow(["Entry four", "2024-01-03T14:45:00Z", "beta"])
        writer.writerow(["Entry five", "2024-01-03T16:00:00Z", "gamma"])

    return timeline_file


@pytest.fixture
async def tiny_node_id(authenticated_client, workspace_id, tiny_text_file):
    """Add a tiny node to the workspace and return its ID."""
    response = await authenticated_client.post(
        "/api/workspaces/nodes",
        params={"filename": tiny_text_file.name},
    )
    assert response.status_code == 200
    result = response.json()
    # The API returns 'id', not 'node_id'
    return result["id"]


@pytest.fixture
async def sample_node_id(authenticated_client, workspace_id, sample_text_file):
    """Add a sample node to the workspace and return its ID."""
    response = await authenticated_client.post(
        "/api/workspaces/nodes",
        params={"filename": sample_text_file.name},
    )
    assert response.status_code == 200
    result = response.json()
    # The API returns 'id', not 'node_id'
    return result["id"]


@pytest.fixture
async def timeline_node_id(authenticated_client, workspace_id, timeline_csv_file):
    """Add a timeline-friendly node to the workspace and return its ID."""
    response = await authenticated_client.post(
        "/api/workspaces/nodes",
        params={"filename": timeline_csv_file.name},
    )
    assert response.status_code == 200
    result = response.json()
    return result["id"]
