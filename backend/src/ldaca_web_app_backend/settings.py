"""
Configuration management using pydantic-settings.
Settings are loaded from environment variables with sensible defaults.
Users are responsible for setting environment variables themselves.
"""

from pathlib import Path
from secrets import token_urlsafe
from typing import Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables with defaults."""

    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug_value(cls, value: Any) -> Any:
        """Normalize common deployment debug strings before bool parsing."""
        if isinstance(value, str):
            normalized_value = value.strip().lower()
            if normalized_value in {"release", "prod", "production"}:
                return False
            if normalized_value in {"debug", "dev", "development"}:
                return True
        return value

    # Root for all data-related storage (folders and DB)
    data_root: str | Path = Field(
        default=Path.home() / "Documents" / "ldaca",
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
    sample_data: str | Path | None = Field(
        default=None,
        description="Optional sample data folder override (filesystem path)",
    )

    # Server Configuration
    server_host: str = Field(default="0.0.0.0", description="Server host")
    backend_port: int = Field(default=8001, description="Backend server port")
    debug: bool = Field(default=False, description="Debug mode")
    quotation_service_timeout: float = Field(
        default=30.0, description="Timeout (seconds) for remote quotation services"
    )
    quotation_service_max_batch_size: int = Field(
        default=128,
        description="Maximum documents sent per request to the remote quotation service",
    )

    # CORS Configuration
    cors_allow_origin_regex: str = Field(
        default=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        description="Regex for allowed origins (dynamic localhost/127.0.0.1 with any port)",
    )
    cors_allow_credentials: bool = Field(
        default=True, description="CORS allow credentials"
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
        default_factory=lambda: token_urlsafe(32),
        description=(
            "Secret key for JWT tokens (set SECRET_KEY in environment for stable deployments)"
        ),
    )
    admin_emails: str = Field(
        default="",
        description=(
            "Comma-separated admin email allowlist for admin endpoints in multi-user mode"
        ),
    )

    # Feedback / Airtable Configuration
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
        case_sensitive=False,
        extra="ignore",
        env_prefix="",
        env_ignore_empty=True,
    )

    def get_data_root(self) -> Path:
        """Return configured data root path.

        Used by:
        - startup initialization, file utilities, DB URL derivation

        Why:
        - Centralizes conversion from env-config value to `Path` object.
        """
        return Path(self.data_root)

    def get_user_data_folder(self) -> Path:
        """Return user data base folder path under data root.

        Used by:
        - user/file/workspace folder helpers

        Why:
        - Keeps all user-owned storage rooted under one configurable path.
        """
        return self.get_data_root() / self.user_data_folder

    def get_sample_data_folder(self) -> Path | None:
        """Return optional sample-data override path.

        Used by:
        - sample-data import/setup utilities

        Why:
        - Supports external dataset bundles without code changes.
        """
        if not self.sample_data:
            return None
        return Path(self.sample_data)

    def get_database_backup_folder(self) -> Path:
        """Return database backup folder path under data root.

        Used by:
        - backup and maintenance tooling

        Why:
        - Keeps backup location configurable and co-located with runtime data.
        """
        return self.get_data_root() / self.database_backup_folder

    def get_database_url(self) -> str:
        """Return effective database URL, deriving SQLite path when omitted.

        Used by:
        - `db.py` engine initialization

        Why:
        - Allows simple local setup while supporting explicit DB URLs in deploys.

        Refactor note:
        - `secret_key` default value is placeholder-grade; enforce env-provided
          secret in production startup validation to reduce misconfiguration risk.
        """
        if self.database_url and self.database_url.strip():
            return self.database_url
        # Construct a sqlite URL under DATA_ROOT/database_file
        db_path = self.get_data_root() / self.database_file
        return f"sqlite+aiosqlite:///{db_path}"

    def get_admin_emails(self) -> set[str]:
        """Return normalized admin email allowlist from settings."""
        if not self.admin_emails.strip():
            return set()
        return {
            email.strip().lower()
            for email in self.admin_emails.split(",")
            if email.strip()
        }


# Global settings instance
settings = Settings()  # type: ignore[arg-type]
