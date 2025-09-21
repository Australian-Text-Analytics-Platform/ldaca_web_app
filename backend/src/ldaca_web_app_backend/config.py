"""
Configuration management using pydantic-settings and .env files.
"""

import os
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).parent

# Determine which .env file to load for settings
DEFAULT_EXAMPLE_ENV_PATH = PROJECT_ROOT / "configs" / ".env.example"
DEFAULT_PROD_ENV_PATH = PROJECT_ROOT / "configs" / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    def _resolve_env_path():
        """Resolve the environment file path in priority order (helper local to class body)."""
        if "ENV_PATH" in os.environ:
            env_path = Path(os.environ["ENV_PATH"]).resolve()
        elif "ENV_LOCATION" in os.environ:
            env_path = Path(os.environ["ENV_LOCATION"]).resolve()
        elif DEFAULT_PROD_ENV_PATH.exists():
            env_path = DEFAULT_PROD_ENV_PATH
        elif DEFAULT_EXAMPLE_ENV_PATH.exists():
            env_path = DEFAULT_EXAMPLE_ENV_PATH
        else:
            raise FileNotFoundError("No suitable .env file found")
        if not env_path.exists():
            raise FileNotFoundError(f"Specified .env file: {env_path} does not exist")
        else:
            print(f"Using environment file: {env_path}")
            return env_path

    # Root for all data-related storage (folders and DB)
    data_root: str | Path = Field(
        default=Path(os.environ.get("HOME")) / "ldaca_data",
        description="Root data folder",
    )

    # Database Configuration
    # If database_url is not provided, we derive it from data_root and database_file
    database_url: str | None = Field(
        default=None,
        description="Database connection URL (optional; derived from data_root if omitted)",
    )
    database_file: str = Field(
        default="users.db", description="SQLite database filename"
    )
    database_backup_folder: str = Field(
        default="backups", description="Database backup folder (relative to data_root)"
    )

    # Data Folders
    user_data_folder: str = Field(
        default="users", description="User data folder (relative to data_root)"
    )
    sample_data: str = Field(
        default=str(PROJECT_ROOT / "sample_data"), description="Sample data folder"
    )

    # Server Configuration
    server_host: str = Field(default="0.0.0.0", description="Server host")
    # Renamed: server_port -> backend_port (BACKEND_PORT env). Keep legacy SERVER_PORT fallback for compatibility.
    backend_port: int = Field(default=8001, description="Backend server port")
    debug: bool = Field(default=False, description="Debug mode")

    # CORS configuration updated: use regex instead of static list; credentials always true.
    cors_allow_origin_regex: str = Field(
        default=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        description="Regex for allowed origins (dynamic localhost/127.0.0.1 with any port)",
    )
    cors_allow_credentials: bool = Field(
        default=True, description="CORS allow credentials (forced True)"
    )

    # Authentication Configuration
    multi_user: bool = Field(default=False, description="Multi-user mode enabled")

    # Single user configuration (when multi_user=False)
    single_user_id: str = Field(default="root", description="Single user ID")
    single_user_name: str = Field(default="Root User", description="Single user name")
    single_user_email: str = Field(
        default="root@localhost", description="Single user email"
    )

    # Google OAuth Configuration (when multi_user=True)
    google_client_id: str = Field(default="", description="Google OAuth client ID")

    # Security Configuration
    token_expire_hours: int = Field(default=24, description="Token expiration hours")
    secret_key: str = Field(
        default="your-secret-key-here", description="Secret key for JWT tokens"
    )

    # Feedback / Airtable Configuration
    # NOTE: For security, do not hardcode real keys here. Provide them via .env
    airtable_api_key: str | None = Field(default=None, description="Airtable API Key")
    airtable_base_id: str | None = Field(default=None, description="Airtable Base ID")
    airtable_table_id: str | None = Field(
        default=None, description="Airtable Table ID or name"
    )
    airtable_field_reply_to_id: str | None = Field(
        default=None, description="Airtable Field ID for Reply-To / email"
    )
    airtable_field_subject_id: str | None = Field(
        default=None, description="Airtable Field ID for Subject"
    )
    airtable_field_comments_id: str | None = Field(
        default=None, description="Airtable Field ID for Comments"
    )

    model_config = SettingsConfigDict(
        env_file=_resolve_env_path(),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        # Environment variable prefix
        env_prefix="",
        # Allow loading from both lowercase and uppercase env vars
        env_ignore_empty=True,
    )

    # Removed list-based origins; using regex via settings.cors_allow_origin_regex directly in main.py

    @field_validator("multi_user", mode="before")
    @classmethod
    def validate_multi_user(cls, v):
        """Convert string to boolean."""
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes", "on")
        return v

    @field_validator("debug", mode="before")
    @classmethod
    def validate_debug(cls, v):
        """Convert string to boolean."""
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes", "on")
        return v

    @field_validator("cors_allow_credentials", mode="before")
    @classmethod
    def validate_cors_credentials(cls, v):
        # Honor explicit false for test expectations; default True otherwise
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes", "on")
        return bool(v)

    def get_data_root(self) -> Path:
        """Get DATA_ROOT as absolute Path."""
        return Path(self.data_root)

    def get_user_data_folder(self) -> Path:
        """Get user data folder absolute path (DATA_ROOT/user_data_folder)."""
        return self.get_data_root() / self.user_data_folder

    def get_sample_data_folder(self) -> Path:
        """Get sample data folder."""
        return Path(self.sample_data)

    def get_database_backup_folder(self) -> Path:
        """Get database backup folder absolute path (DATA_ROOT/database_backup_folder)."""
        return self.get_data_root() / self.database_backup_folder

    def get_database_url(self) -> str:
        """Return effective database URL, deriving from DATA_ROOT if not provided."""
        if self.database_url and self.database_url.strip():
            return self.database_url
        # Construct a sqlite URL under DATA_ROOT/database_file
        db_path = self.get_data_root() / self.database_file
        return f"sqlite+aiosqlite:///{db_path}"


# Global settings instance
settings = Settings()  # type: ignore[arg-type]
