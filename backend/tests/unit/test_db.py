"""
Tests for database operations
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch


class TestDatabaseOperations:
    """Test database operation functions"""

    @patch('db.async_session_maker')
    async def test_get_or_create_user_new_user(self, mock_session_maker):
        """Test creating a new user"""
        from db import get_or_create_user

        # Mock session and result
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        
        # Mock empty result (user doesn't exist)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session.execute.return_value = mock_result
        
        # Mock user creation
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.email = "test@example.com"
        mock_user.name = "Test User"
        mock_user.picture = "https://example.com/avatar.jpg"
        mock_user.created_at = datetime.utcnow()
        mock_user.last_login = datetime.utcnow()
        
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()
        
        # Mock the user creation in the session
        def mock_refresh(user):
            # Simulate database auto-generated fields
            user.id = 1
            user.created_at = datetime.utcnow()
            user.last_login = datetime.utcnow()
        
        mock_session.refresh.side_effect = mock_refresh
        
        # Call function
        await get_or_create_user(
            email="test@example.com",
            name="Test User",
            picture="https://example.com/avatar.jpg",
            google_id="google-123"
        )
        
        # Verify session operations
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        mock_session.refresh.assert_called_once()

    @patch('db.async_session_maker')
    async def test_get_or_create_user_existing_user(self, mock_session_maker):
        """Test retrieving an existing user"""
        from db import get_or_create_user

        # Mock session
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        
        # Mock existing user
        mock_user = MagicMock()
        mock_user.id = 1
        mock_user.email = "test@example.com"
        mock_user.name = "Test User"
        mock_user.picture = "https://example.com/avatar.jpg"
        mock_user.created_at = datetime.utcnow()
        mock_user.last_login = datetime.utcnow()
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_user
        mock_session.execute.return_value = mock_result
        
        mock_session.commit = AsyncMock()
        
        # Call function
        await get_or_create_user(
            email="test@example.com",
            name="Test User Updated",
            picture="https://example.com/new-avatar.jpg",
            google_id="google-123"
        )
        
        # Should update existing user
        assert mock_user.name == "Test User Updated"
        assert mock_user.picture == "https://example.com/new-avatar.jpg"
        mock_session.commit.assert_called_once()

    @patch('db.async_session_maker')
    @patch('config.config')
    async def test_create_user_session(self, mock_config, mock_session_maker):
        """Test creating a user session"""
        from db import create_user_session

        # Mock config with actual values
        mock_config.token_expire_hours = 24
        
        # Mock session
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        
        # Mock the user query result (for cleanup of old sessions)
        mock_old_sessions = []
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = mock_old_sessions
        mock_session.execute.return_value = mock_result
        
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        
        # Call function
        result = await create_user_session(
            user_id="550e8400-e29b-41d4-a716-446655440000",
            google_token="google-token-123"
        )
        
        # Verify operations
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        
        # Verify return format
        assert 'access_token' in result
        assert 'refresh_token' in result
        assert 'expires_in' in result
        assert 'expires_at' in result

    @patch('db.async_session_maker')
    async def test_validate_access_token_valid(self, mock_session_maker):
        """Test validating a valid access token"""
        from db import validate_access_token

        # Mock session
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        
        # Mock valid user and session data
        mock_user = MagicMock()
        mock_user.id = "550e8400-e29b-41d4-a716-446655440000"
        mock_user.email = "test@example.com"
        mock_user.name = "Test User"
        mock_user.picture = "https://example.com/avatar.jpg"
        mock_user.created_at = datetime.utcnow()
        mock_user.last_login = datetime.utcnow()
        mock_user.is_active = True
        mock_user.is_superuser = False
        mock_user.is_verified = True
        mock_user.google_id = "google-123"
        mock_user.user_folder_path = "/test/path"
        
        mock_session_obj = MagicMock()
        mock_session_obj.access_token = "valid-token"
        mock_session_obj.expires_at = datetime.utcnow() + timedelta(hours=1)
        
        # Mock the result row (user, session tuple)
        mock_row = (mock_user, mock_session_obj)
        mock_result = MagicMock()
        mock_result.first.return_value = mock_row
        mock_session.execute.return_value = mock_result
        
        # Call function
        result = await validate_access_token("valid-token")
        
        # Should return user data
        assert result is not None
        assert result['email'] == "test@example.com"
        assert result['id'] == "550e8400-e29b-41d4-a716-446655440000"
        assert 'access_token' in result
        assert 'expires_at' in result

    @patch('db.async_session_maker')
    async def test_validate_access_token_expired(self, mock_session_maker):
        """Test validating an expired access token"""
        from db import validate_access_token

        # Mock session
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        
        # Mock no result for expired token (handled by WHERE clause in query)
        mock_result = MagicMock()
        mock_result.first.return_value = None
        mock_session.execute.return_value = mock_result
        
        # Call function
        result = await validate_access_token("expired-token")
        
        # Should return None for expired token
        assert result is None

    @patch('db.async_session_maker')
    async def test_validate_access_token_invalid(self, mock_session_maker):
        """Test validating an invalid access token"""
        from db import validate_access_token

        # Mock session
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        
        # Mock no session found
        mock_result = MagicMock()
        mock_result.first.return_value = None
        mock_session.execute.return_value = mock_result
        
        # Call function
        result = await validate_access_token("invalid-token")
        
        # Should return None for invalid token
        assert result is None

    @patch('db.async_session_maker')
    async def test_cleanup_expired_sessions(self, mock_session_maker):
        """Test cleaning up expired sessions"""
        from db import cleanup_expired_sessions

        # Mock session
        mock_session = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        
        # Mock expired sessions
        mock_expired_session1 = MagicMock()
        mock_expired_session2 = MagicMock()
        expired_sessions = [mock_expired_session1, mock_expired_session2]
        
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = expired_sessions
        mock_session.execute.return_value = mock_result
        
        mock_session.delete = AsyncMock()
        mock_session.commit = AsyncMock()
        
        # Call function
        await cleanup_expired_sessions()
        
        # Should execute query, delete sessions, and commit
        mock_session.execute.assert_called_once()
        assert mock_session.delete.call_count == 2  # Two expired sessions
        mock_session.commit.assert_called_once()


class TestDatabaseModels:
    """Test database model definitions"""

    def test_user_model_creation(self):
        """Test User model can be created"""
        from db import User
        
        user = User(
            email="test@example.com",
            name="Test User",
            picture="https://example.com/avatar.jpg",
            google_id="google-123"
        )
        
        assert user.email == "test@example.com"
        assert user.name == "Test User"
        assert user.picture == "https://example.com/avatar.jpg"
        assert user.google_id == "google-123"

    def test_user_session_model_creation(self):
        """Test UserSession model can be created"""
        from db import UserSession
        
        session = UserSession(
            user_id=1,
            access_token="access-token-123",
            refresh_token="refresh-token-123",
            expires_at=datetime.utcnow() + timedelta(hours=24)
        )
        
        assert session.user_id == 1
        assert session.access_token == "access-token-123"
        assert session.refresh_token == "refresh-token-123"

    def test_database_url_configuration(self):
        """Test database URL configuration"""
        from db import engine

        # The engine should be created with the in-memory test database
        # Note: The actual URL might be the in-memory one set by the test fixtures
        db_url = str(engine.url)
        assert "sqlite+aiosqlite" in db_url
        # Accept either test.db or :memory: depending on test setup
        assert ":memory:" in db_url or "test.db" in db_url or "users.db" in db_url
