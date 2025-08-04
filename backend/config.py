"""
Configuration management using pydantic-settings and .env files.
"""

from pathlib import Path
from typing import List

from pydantic import Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    # Database Configuration
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/users.db",
        description="Database connection URL",
    )
    database_backup_folder: str = Field(
        default="./data/backups", description="Database backup folder"
    )

    # Data Folders
    user_data_folder: str = Field(default="./data", description="User data folder")
    sample_data_folder: str = Field(
        default="./data/sample_data", description="Sample data folder"
    )

    # Server Configuration
    server_host: str = Field(default="0.0.0.0", description="Server host")
    server_port: int = Field(default=8001, description="Server port")
    debug: bool = Field(default=False, description="Debug mode")

    # CORS Configuration - using string field to avoid JSON parsing issues
    cors_allowed_origins_str: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000,https://ldaca.sguo.org,https://sguo0589.github.io",
        description="CORS allowed origins as comma-separated string",
    )
    cors_allow_credentials: bool = Field(
        default=True, description="CORS allow credentials"
    )

    # Authentication Configuration
    multi_user: bool = Field(default=True, description="Multi-user mode enabled")

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

    # Logging Configuration
    log_level: str = Field(default="INFO", description="Logging level")
    log_file: str = Field(default="./logs/app.log", description="Log file path")

    # Model configuration
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        # Environment variable prefix
        env_prefix="",
        # Allow loading from both lowercase and uppercase env vars
        env_ignore_empty=True,
    )

    @computed_field
    @property
    def cors_allowed_origins(self) -> List[str]:
        """Convert comma-separated string to list of origins."""
        if self.cors_allowed_origins_str:
            return [
                origin.strip()
                for origin in self.cors_allowed_origins_str.split(",")
                if origin.strip()
            ]
        return ["http://localhost:3000"]

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
        """Convert string to boolean."""
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes", "on")
        return v

    # Convenience properties for backward compatibility
    @property
    def data_folder(self) -> Path:
        """Backward compatibility property."""
        return Path(self.user_data_folder)

    @property
    def allowed_origins(self) -> List[str]:
        """Backward compatibility property."""
        return self.cors_allowed_origins

    def get_user_data_folder(self) -> Path:
        """Get user data folder as Path object."""
        return Path(self.user_data_folder)

    def get_sample_data_folder(self) -> Path:
        """Get sample data folder as Path object."""
        return Path(self.sample_data_folder)

    def get_database_backup_folder(self) -> Path:
        """Get database backup folder as Path object."""
        return Path(self.database_backup_folder)

    def get_log_file(self) -> Path:
        """Get log file as Path object."""
        return Path(self.log_file)


# Global settings instance
settings = Settings()

# For backward compatibility
config = settings
