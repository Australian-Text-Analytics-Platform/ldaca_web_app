"""Immutable, environment-backed bootstrap configuration."""

from pathlib import Path, PurePosixPath, PureWindowsPath
from ipaddress import ip_address
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict


class RemoteQuotationEngineSetting(BaseModel):
    """One operator-owned remote quotation endpoint."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    url: AnyHttpUrl


class Settings(BaseSettings):
    """One immutable, fully validated runtime configuration snapshot.

    Loaded once by CLI/bootstrap or constructed explicitly by tests. Services
    receive this instance through lifespan wiring; no module-level settings or
    runtime reload path exists.
    """

    # Root for all data-related storage (folders and DB). ``None`` keeps only
    # the HTTP control plane live until the Data Root manager resolves config
    # or accepts a single-user setup request.
    data_root: Path | None = Field(
        default=None,
        description="Operator-provided root data folder",
    )

    max_file_upload_bytes: int = Field(
        default=512 * 1024 * 1024,
        ge=1,
        description="Maximum bytes in one user file upload",
    )
    max_workspace_archive_bytes: int = Field(
        default=512 * 1024 * 1024,
        ge=1,
        description="Maximum compressed bytes in one workspace import",
    )
    max_workspace_export_bytes: int = Field(
        default=2 * 1024 * 1024 * 1024,
        ge=1,
        description="Maximum expanded and compressed bytes in a workspace export",
    )
    max_default_request_body_bytes: int = Field(
        default=2 * 1024 * 1024,
        ge=1,
        description="Global request body limit outside explicit upload routes",
    )
    max_preview_source_bytes: int = Field(
        default=64 * 1024 * 1024,
        ge=1,
        description="Largest stored file accepted by preview or node ingestion",
    )
    max_node_storage_bytes: int = Field(
        default=1024 * 1024 * 1024,
        ge=1,
        description="Maximum durable Parquet bytes created by one source node",
    )
    max_text_response_bytes: int = Field(
        default=8 * 1024 * 1024,
        ge=1,
        description="Largest UTF-8 file returned by the raw text endpoint",
    )
    max_user_file_tree_response_bytes: int = Field(
        default=8 * 1024 * 1024,
        ge=1,
        description="Largest complete serialized User File tree response",
    )
    max_response_snapshot_bytes: int = Field(default=2 * 1024 * 1024 * 1024, ge=1)
    max_concurrent_response_snapshots: int = Field(default=8, ge=1, le=128)
    max_open_workspace_bytes: int = Field(
        default=4 * 1024 * 1024 * 1024,
        ge=1,
        description="Hosted process capacity for open serialized Workspace snapshots",
    )
    max_workspace_nodes: int = Field(default=10_000, ge=1)
    max_workspace_snapshot_bytes: int = Field(
        default=256 * 1024 * 1024,
        ge=1,
        description="Maximum plan-and-metadata bytes in one workspace commit",
    )
    min_free_disk_bytes: int = Field(
        default=1024 * 1024 * 1024,
        ge=0,
        description="Physical free-space reserve kept below all admitted writes",
    )
    analysis_execution_capacity: int = Field(
        default=2,
        ge=1,
        description="Maximum Analyses admitted to fresh child processes at once",
    )
    user_file_import_capacity: int = Field(
        default=2,
        ge=1,
        description="Maximum User File Imports admitted to execution at once",
    )
    shutdown_grace_seconds: float = Field(
        default=10.0,
        gt=0,
        allow_inf_nan=False,
        description="Shared deadline for terminating background work at shutdown",
    )
    max_analysis_storage_bytes: int = Field(
        default=1024 * 1024 * 1024,
        ge=1,
        description="Maximum private input, output, and Artifact bytes per Analysis",
    )
    max_analysis_storage_files: int = Field(
        default=1_000,
        ge=1,
        description="Maximum private input, output, and Artifact files per Analysis",
    )
    max_topic_projection_cache_entries: int = Field(
        default=16,
        ge=0,
        description="Maximum complete Topic projection bases retained per runtime",
    )
    max_topic_projection_cache_bytes: int = Field(
        default=64 * 1024 * 1024,
        ge=0,
        description="Maximum encoded bytes retained by the Topic projection cache",
    )
    max_user_file_import_bytes: int = Field(
        default=1024 * 1024 * 1024,
        ge=1,
        description="Maximum staged bytes produced by one User File Import",
    )
    max_user_file_import_files: int = Field(
        default=1_000,
        ge=1,
        description="Maximum staged files produced by one User File Import",
    )
    max_user_file_import_record_bytes: int = Field(
        default=64 * 1024,
        ge=1,
        description="Maximum serialized bytes in one User File Import record",
    )
    max_concurrent_workspace_imports: int = Field(default=2, ge=1, le=16)
    # Server Configuration
    server_host: str = Field(default="127.0.0.1", description="Server host")
    backend_port: int = Field(
        default=8001,
        ge=1,
        le=65535,
        description="Backend server port",
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO",
        description="Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)",
    )
    log_file: str | None = Field(
        default=None,
        description="Log file name (relative to data_root). None disables file logging.",
    )
    quotation_service_timeout: float = Field(
        default=30.0,
        gt=0,
        description="Timeout (seconds) for remote quotation services",
    )
    quotation_service_max_batch_size: int = Field(
        default=128,
        ge=1,
        description="Maximum documents sent per request to the remote quotation service",
    )
    quotation_remote_engines: tuple[RemoteQuotationEngineSetting, ...] = Field(
        default=(),
        description="Operator-owned remote quotation engine allowlist",
    )
    cors_allowed_origins: tuple[str, ...] = Field(
        default=(),
        description="Exact cross-origin browser origins allowed to call the API",
    )
    trusted_hosts: tuple[str, ...] = Field(
        default=("localhost", "127.0.0.1", "::1"),
        description="Exact HTTP Host names accepted by the backend",
    )

    # Authentication Configuration
    multi_user: bool = Field(default=False, description="Multi-user mode enabled")

    # Google OAuth Configuration (when multi_user=True)
    google_client_id: str = Field(default="", description="Google OAuth client ID")

    # CILogon OIDC Configuration (when multi_user=True)
    cilogon_client_id: str = Field(default="", description="CILogon OIDC client ID")
    cilogon_client_secret: SecretStr = Field(
        default_factory=lambda: SecretStr(""),
        description="CILogon OIDC client secret",
    )
    cilogon_issuer: str = Field(
        default="https://test.cilogon.aaf.edu.au",
        description="Exact trusted CILogon OIDC issuer",
    )
    cilogon_redirect_uri: str = Field(
        default="",
        description=(
            "CILogon callback URL registered with the provider. "
            "Set to the full URL of /api/auth/cilogon/callback on your deployment."
        ),
    )

    # Hosted browser session configuration. Desktop single-user mode does not
    # use cookies as its authentication transport, but it still uses a
    # process-scoped CSRF token.
    session_ttl_hours: int = Field(
        default=24,
        ge=1,
        description="Hosted browser session lifetime in hours",
    )
    session_cookie_secure: bool = Field(
        default=True,
        description=(
            "Require HTTPS for the hosted session cookie. Disable only for "
            "same-site local HTTP development."
        ),
    )

    # LDaCA Data Portal / Oni API configuration
    ldaca_oni_api_base_url: str = Field(
        default="https://data.ldaca.edu.au/api",
        description="Base URL for the LDaCA Data Portal Oni API",
    )
    ldaca_oni_api_token: SecretStr | None = Field(
        default=None,
        description="Optional bearer token for LDaCA Oni API requests",
    )
    ldaca_oni_timeout: float = Field(
        default=30.0,
        gt=0,
        description="Timeout (seconds) for LDaCA Oni API requests",
    )
    ldaca_oni_download_concurrency: int = Field(
        default=8,
        ge=1,
        le=32,
        description="Concurrent text-file downloads for LDaCA Oni imports",
    )
    ldaca_oni_featured_collection_ids: tuple[str, ...] = Field(
        default=("arcp://name,hdl10.26180~23961609",),
        description="Featured LDaCA collection crate identifiers",
    )

    model_config = SettingsConfigDict(
        case_sensitive=False,
        extra="forbid",
        env_prefix="",
        env_ignore_empty=True,
        frozen=True,
    )

    @field_validator("data_root")
    @classmethod
    def canonicalize_data_root(cls, value: Path | None) -> Path | None:
        """Store one absolute, normalized root before runtime construction."""

        return value.expanduser().resolve(strict=False) if value is not None else None

    @field_validator("log_file")
    @classmethod
    def validate_log_file(cls, value: str | None) -> str | None:
        """Keep optional log output inside the immutable data root.

        ``setup_logging`` joins this value to ``data_root``. Requiring a
        canonical POSIX-style relative path here prevents absolute, drive,
        traversal, and platform-dependent separator escapes before startup.
        """

        if value is None:
            return None
        candidate = value.strip()
        windows = PureWindowsPath(candidate)
        posix = PurePosixPath(candidate)
        if (
            not candidate
            or "\\" in candidate
            or windows.drive
            or windows.root
            or posix.is_absolute()
            or any(part in {"", ".", ".."} for part in posix.parts)
        ):
            raise ValueError("Log file must be a safe path relative to data_root")
        return posix.as_posix()

    @field_validator("cors_allowed_origins")
    @classmethod
    def validate_cors_origins(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        """Require unique exact origins with no wildcard, path, query, or fragment."""

        normalized: list[str] = []
        for value in values:
            candidate = value.strip()
            parsed = urlsplit(candidate)
            try:
                port = parsed.port
            except ValueError as exc:
                raise ValueError("CORS origin contains an invalid port") from exc
            if candidate == "*":
                raise ValueError("CORS wildcard origins are unsupported")
            if (
                parsed.scheme.casefold() not in {"http", "https", "tauri"}
                or parsed.hostname is None
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("CORS origins must be exact scheme-and-host origins")
            scheme = parsed.scheme.casefold()
            host = parsed.hostname.rstrip(".").casefold()
            if not host or (scheme == "tauri" and port is not None):
                raise ValueError("CORS origins must be exact scheme-and-host origins")
            rendered_host = f"[{host}]" if ":" in host else host
            default_port = (
                80 if scheme == "http" else 443 if scheme == "https" else None
            )
            rendered_port = (
                f":{port}" if port is not None and port != default_port else ""
            )
            normalized.append(f"{scheme}://{rendered_host}{rendered_port}")
        if len(normalized) != len(set(normalized)):
            raise ValueError("CORS origins must be unique")
        return tuple(normalized)

    @field_validator("trusted_hosts")
    @classmethod
    def validate_trusted_hosts(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        """Require exact host names/IP literals without wildcard or port syntax."""

        normalized: list[str] = []
        for raw in values:
            candidate = raw.strip().strip("[]").rstrip(".").casefold()
            if (
                not candidate
                or "*" in candidate
                or "/" in candidate
                or "@" in candidate
            ):
                raise ValueError("Trusted hosts must be exact host names")
            try:
                ip_address(candidate)
            except ValueError:
                if ":" in candidate or any(
                    not (part and part.replace("-", "a").isalnum())
                    for part in candidate.split(".")
                ):
                    raise ValueError("Trusted hosts must be exact host names")
            normalized.append(candidate)
        if len(normalized) != len(set(normalized)):
            raise ValueError("Trusted hosts must be unique")
        return tuple(normalized)

    @field_validator("cilogon_issuer")
    @classmethod
    def validate_cilogon_issuer(cls, value: str) -> str:
        """Require one HTTPS issuer origin with no mutable URL components."""

        candidate = value.strip().rstrip("/")
        parsed = urlsplit(candidate)
        try:
            port = parsed.port
        except ValueError as exc:
            raise ValueError("CILogon issuer must use a valid HTTPS port") from exc
        if (
            parsed.scheme != "https"
            or parsed.hostname is None
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
            or (port is not None and port != 443)
        ):
            raise ValueError("CILogon issuer must be an exact HTTPS origin")
        return candidate

    @field_validator("cilogon_redirect_uri")
    @classmethod
    def validate_cilogon_redirect_uri(cls, value: str) -> str:
        """Require the exact registered callback URL when CILogon is enabled."""

        candidate = value.strip()
        if not candidate:
            return ""
        parsed = urlsplit(candidate)
        try:
            port = parsed.port
        except ValueError as exc:
            raise ValueError("CILogon redirect URI contains an invalid port") from exc
        hostname = parsed.hostname
        if (
            parsed.scheme.casefold() not in {"http", "https"}
            or hostname is None
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or not parsed.path.endswith("/api/auth/cilogon/callback")
            or any(part in {".", ".."} for part in PurePosixPath(parsed.path).parts)
        ):
            raise ValueError("CILogon redirect URI must be an exact callback URL")
        host = hostname.rstrip(".").casefold()
        try:
            is_loopback = ip_address(host).is_loopback
        except ValueError:
            is_loopback = host == "localhost"
        if parsed.scheme.casefold() == "http" and not is_loopback:
            raise ValueError(
                "CILogon redirect URI requires HTTPS outside local development"
            )
        rendered_host = f"[{host}]" if ":" in host else host
        default_port = 80 if parsed.scheme.casefold() == "http" else 443
        rendered_port = f":{port}" if port is not None and port != default_port else ""
        return (
            f"{parsed.scheme.casefold()}://{rendered_host}{rendered_port}{parsed.path}"
        )

    @model_validator(mode="after")
    def validate_deployment_profile(self) -> "Settings":
        """Reject unsupported provider and multi-user desktop combinations."""

        if not self.multi_user:
            candidate = self.server_host.strip().strip("[]")
            try:
                is_loopback = ip_address(candidate).is_loopback
            except ValueError:
                is_loopback = candidate.casefold() == "localhost"
            if not is_loopback:
                raise ValueError("Single-user mode requires a loopback server host")

        has_google = bool(self.google_client_id.strip())
        has_cilogon_id = bool(self.cilogon_client_id.strip())
        has_cilogon_secret = bool(
            self.cilogon_client_secret.get_secret_value().strip()
        )
        if has_cilogon_id != has_cilogon_secret:
            raise ValueError("CILogon client ID and secret must be configured together")
        if has_cilogon_id and not self.cilogon_redirect_uri:
            raise ValueError("CILogon redirect URI is required when CILogon is enabled")
        engine_ids = [engine.id for engine in self.quotation_remote_engines]
        if len(engine_ids) != len(set(engine_ids)):
            raise ValueError("Remote quotation engine IDs must be unique")
        if self.multi_user and not (has_google or has_cilogon_id):
            raise ValueError("Hosted multi-user mode requires an identity provider")
        if self.multi_user and not self.session_cookie_secure:
            local_hosts = {"localhost", "127.0.0.1", "::1"}
            server_host = self.server_host.strip().strip("[]").casefold()
            try:
                server_is_local = ip_address(server_host).is_loopback
            except ValueError:
                server_is_local = server_host == "localhost"
            if (
                not server_is_local
                or any(host not in local_hosts for host in self.trusted_hosts)
                or any(
                    urlsplit(origin).scheme != "http"
                    or urlsplit(origin).hostname not in local_hosts
                    for origin in self.cors_allowed_origins
                )
            ):
                raise ValueError(
                    "Insecure hosted cookies are allowed only for local HTTP development"
                )
        return self

    def get_data_root(self) -> Path:
        """Return the canonical data root validated during construction."""
        if self.data_root is None:
            raise RuntimeError("Data Root is not configured")
        return self.data_root

    def get_allowed_origins(self) -> tuple[str, ...]:
        """Return exact browser origins for the validated deployment profile."""

        return self.cors_allowed_origins

    def get_users_root_folder(self) -> Path:
        """Return the canonical parent directory for all per-user storage."""
        return self.get_data_root() / "users"

    def get_trusted_hosts(self) -> tuple[str, ...]:
        """Return the explicit API Host allowlist without conflating CORS clients."""

        return self.trusted_hosts

    def get_cilogon_issuer(self) -> str:
        """Return the canonical issuer used for discovery and identity ownership."""

        return self.cilogon_issuer

    def get_cilogon_discovery_url(self) -> str:
        """Derive discovery from the trusted issuer instead of accepting a URL."""

        return f"{self.get_cilogon_issuer()}/.well-known/openid-configuration"


def load_settings(**overrides: Any) -> Settings:
    """Load one immutable snapshot for CLI/bootstrap or an isolated test app."""

    return Settings(**overrides)
