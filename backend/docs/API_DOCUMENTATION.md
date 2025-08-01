# ATAP Web App API - User Database Integration

## 🎯 **Overview**
Your FastAPI backend now uses a complete user database system with SQLite to handle user authentication, session management, and secure access control. The primary identifier for users is their **email address**.

## 📊 **Database Schema**

### **Users Table**
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,           -- Primary identifier
    name TEXT NOT NULL,
    picture TEXT,
    google_id TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);
```

### **User Sessions Table**
```sql
CREATE TABLE user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    access_token TEXT NOT NULL,           -- Your custom token
    refresh_token TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
);
```

## 🔐 **Authentication Flow**

1. **User logs in with Google** → Sends Google ID token
2. **Backend verifies Google token** → Extracts user info
3. **Get or create user by email** → Uses email as primary identifier
4. **Generate custom session token** → Creates your own access/refresh tokens
5. **Return tokens + user info** → Frontend stores for API calls

## 🚀 **API Endpoints**

### **Authentication Endpoints**

#### `POST /auth/google`
**Login with Google OAuth**
```json
// Request
{
  "id_token": "google_jwt_token_here"
}

// Response
{
  "access_token": "your_custom_token",
  "refresh_token": "refresh_token", 
  "expires_in": 86400,
  "scope": "openid email profile",
  "token_type": "Bearer",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "picture": "https://..."
  }
}
```

#### `GET /me`
**Get current user info** (requires auth)
```json
{
  "id": 1,
  "email": "user@example.com", 
  "name": "John Doe",
  "picture": "https://...",
  "created_at": "2025-07-07T...",
  "last_login": "2025-07-07T..."
}
```

#### `GET /auth/status`
**Check authentication status**
```json
{
  "authenticated": true,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

#### `POST /auth/logout`
**Logout and cleanup sessions**

### **Protected Data Endpoints**
All require `Authorization: Bearer <token>` header:

- `GET /files` - List available files
- `POST /load_file?file_name=...` - Load CSV file
- `GET /file_preview?file_name=...` - Preview file data
- `GET /dataframe?page_idx=...` - Get paginated data
- `GET /download?file_name=...` - Download file

### **Admin Endpoints**

#### `GET /admin/users`
**List all users with session info**
```json
{
  "users": [
    {
      "id": 1,
      "email": "user@example.com",
      "name": "John Doe", 
      "created_at": "2025-07-07T...",
      "last_login": "2025-07-07T...",
      "active_sessions": 1
    }
  ],
  "total": 1
}
```

#### `GET /admin/cleanup`
**Clean expired sessions**

## 🔒 **Security Features**

1. **Google OAuth Verification** - Validates Google ID tokens
2. **Custom Session Tokens** - Your own secure token system
3. **Token Expiration** - Configurable expiry times
4. **Path Validation** - Prevents directory traversal attacks
5. **User-based Access Control** - All file operations logged by user
6. **Session Cleanup** - Automatic cleanup of expired sessions

## 🛠 **Usage in Frontend**

```typescript
// Login
const authResponse = await googleAuth(googleIdToken);
localStorage.setItem('accessToken', authResponse.access_token);

// Make authenticated requests
const headers = {
  'Authorization': `Bearer ${accessToken}`
};

const files = await axios.get('/api/files', { headers });
```

## 📝 **Database Functions Available**

- `get_or_create_user(email, name, picture, google_id)` - User management
- `create_user_session(user_id, google_token)` - Session creation
- `validate_access_token(token)` - Token validation
- `cleanup_expired_sessions()` - Maintenance
- `get_user_by_email(email)` - User lookup

## 🎯 **Key Benefits**

✅ **Email-based user identification** - Simple, reliable user management
✅ **Secure token system** - Your own tokens, not just Google's
✅ **Session management** - Track user sessions and cleanup
✅ **Audit trail** - All file operations logged by user
✅ **Admin capabilities** - User management and system maintenance
✅ **Security hardened** - Path validation, token expiry, auth checks

Your backend now provides enterprise-grade user management while maintaining the simple email-based identification you requested! 🚀
