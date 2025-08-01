"""
Mock API responses and external service responses
"""

# Mock Google OAuth token data
MOCK_GOOGLE_TOKEN_VALID = {
    "iss": "accounts.google.com",
    "sub": "test-google-id-123",
    "email": "test@example.com",
    "email_verified": True,
    "name": "Test User",
    "picture": "https://example.com/avatar.jpg",
}

MOCK_GOOGLE_TOKEN_INVALID = {
    "iss": "wrong-issuer.com",
    "sub": "test-google-id-123",
    "email": "test@example.com",
    "email_verified": False,
}

# Mock user data
MOCK_USER_DATA = {
    "id": "test-user-123",
    "email": "test@example.com",
    "name": "Test User",
    "picture": "https://example.com/avatar.jpg",
    "created_at": "2024-01-01T00:00:00Z",
    "last_login": "2024-01-01T12:00:00Z",
}

# Mock workspace data
MOCK_WORKSPACE_DATA = {
    "id": "workspace-123",
    "name": "Test Workspace",
    "description": "A test workspace",
    "created_at": "2024-01-01T00:00:00Z",
    "modified_at": "2024-01-01T12:00:00Z",
    "nodes": {},
    "is_saved": False,
}

# Mock node data
MOCK_NODE_DATA = {
    "id": "node-123",
    "name": "Test Node",
    "data": None,
    "created_at": "2024-01-01T00:00:00Z",
}

# Mock HTTP responses
MOCK_HTTP_RESPONSES = {
    "health_check": {
        "status": "ok",
        "timestamp": "2024-01-01T00:00:00Z",
        "version": "3.0.0",
    },
    "workspace_list": {"workspaces": []},
    "node_list": {"nodes": []},
}
