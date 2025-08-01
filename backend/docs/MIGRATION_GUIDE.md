# Configuration Migration Guide

## Overview
This guide explains how to migrate from the old JSON-based configuration system to the new pydantic-settings with `.env` file approach.

## Changes Made

### 1. New Dependencies
Added to `pyproject.toml`:
```toml
"pydantic-settings>=2.0.0",
"python-dotenv>=1.0.0",
```

### 2. Configuration File Changes
- **Before**: `config.json` file
- **After**: `.env` file with environment variables

### 3. Code Changes

#### Old Configuration (config.py)
```python
from config import config

# Usage
config.get('database', 'url')
config.database_url
config.allowed_origins
```

#### New Configuration (config.py)
```python
from config import settings

# Usage
settings.database_url
settings.cors_allowed_origins
settings.server_host
```

## Migration Steps

### Step 1: Install New Dependencies
```bash
pip install pydantic-settings python-dotenv
```

### Step 2: Create .env File
Copy the `.env.example` file to `.env` and update the values:
```bash
cp .env.example .env
```

### Step 3: Update Import Statements
Replace all instances of:
```python
from config import config
```

With:
```python
from config import settings
```

### Step 4: Update Configuration Access
Replace old nested access patterns:
```python
# Old
config.get('database', 'url')
config.get('server', 'host')
config.get('cors', 'allowed_origins')

# New
settings.database_url
settings.server_host
settings.cors_allowed_origins
```

## Configuration Mapping

| Old JSON Path | New Environment Variable | New Settings Property |
|---------------|--------------------------|----------------------|
| `database.url` | `DATABASE_URL` | `settings.database_url` |
| `database.backup_folder` | `DATABASE_BACKUP_FOLDER` | `settings.database_backup_folder` |
| `data.user_data_folder` | `USER_DATA_FOLDER` | `settings.user_data_folder` |
| `data.sample_data_folder` | `SAMPLE_DATA_FOLDER` | `settings.sample_data_folder` |
| `server.host` | `SERVER_HOST` | `settings.server_host` |
| `server.port` | `SERVER_PORT` | `settings.server_port` |
| `server.debug` | `DEBUG` | `settings.debug` |
| `cors.allowed_origins` | `CORS_ALLOWED_ORIGINS` | `settings.cors_allowed_origins` |
| `cors.allow_credentials` | `CORS_ALLOW_CREDENTIALS` | `settings.cors_allow_credentials` |
| `google_oauth.client_id` | `GOOGLE_CLIENT_ID` | `settings.google_client_id` |
| `security.token_expire_hours` | `TOKEN_EXPIRE_HOURS` | `settings.token_expire_hours` |
| `security.secret_key` | `SECRET_KEY` | `settings.secret_key` |
| `logging.level` | `LOG_LEVEL` | `settings.log_level` |
| `logging.file` | `LOG_FILE` | `settings.log_file` |

## Backward Compatibility
The new configuration maintains backward compatibility for these properties:
- `settings.data_folder` → `settings.user_data_folder`
- `settings.allowed_origins` → `settings.cors_allowed_origins`

## Environment Variable Features

### Boolean Values
These strings are converted to `True`:
- `"true"`, `"1"`, `"yes"`, `"on"`

All other values are converted to `False`.

### List Values
CORS origins can be specified as comma-separated values:
```env
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://atap.sguo.org,https://sguo0589.github.io
```

### Environment Variable Precedence
1. Environment variables (highest priority)
2. `.env` file
3. Default values in the Settings class

## Testing
Run the test script to verify the configuration:
```bash
python test_config.py
```

## Benefits of New System

1. **Type Safety**: Pydantic provides automatic type validation
2. **Environment Variables**: Easy deployment configuration
3. **IDE Support**: Better auto-completion and type hints
4. **Validation**: Automatic validation of configuration values
5. **Documentation**: Built-in field descriptions
6. **Flexible**: Support for multiple environment files
7. **Security**: Sensitive values can be kept in environment variables

## Files to Update

After migration, these files need to be updated to use the new configuration:
- `main.py` ✅ (Updated)
- `db.py`
- `api/auth.py`
- `core/utils.py`
- `tests/unit/test_config.py`
- Any other files importing `config`

## Clean Up
After migration is complete, you can remove:
- `config.json`
- `config.prod.json`
- Old configuration logic in `config.py`
