"""Bootstrap settings reject unsupported deployment profiles before startup."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from ldaca_wordflow.settings import Settings


def test_data_root_is_canonical_and_storage_layout_is_not_configurable(
    tmp_path: Path,
) -> None:
    settings = Settings(data_root=tmp_path / "nested" / ".." / "data")
    assert settings.data_root == (tmp_path / "data").resolve()

    with pytest.raises(ValidationError):
        Settings.model_validate({"user_data_folder": "legacy-users"})
    with pytest.raises(ValidationError):
        Settings.model_validate({"database_file": "legacy.db"})
    with pytest.raises(ValidationError):
        Settings.model_validate({"database_url": "sqlite:///elsewhere.db"})
    for removed_quota_setting in (
        "max_user_storage_bytes",
        "max_user_files",
        "max_user_directories",
    ):
        with pytest.raises(ValidationError):
            Settings.model_validate({removed_quota_setting: 1})
    for removed_identity_setting in (
        "single_user_id",
        "single_user_name",
        "single_user_email",
    ):
        with pytest.raises(ValidationError):
            Settings.model_validate({removed_identity_setting: "custom"})


def test_cors_is_exact_and_multi_user_excludes_tauri_transport() -> None:
    with pytest.raises(ValidationError, match="wildcard"):
        Settings(cors_allowed_origins=("*",))
    for origin in (
        "ftp://wordflow.example",
        "https://user:pass@wordflow.example",
        "https://wordflow.example:abc",
        "https://wordflow.example:99999",
    ):
        with pytest.raises(ValidationError):
            Settings(cors_allowed_origins=(origin,))
    assert Settings(
        cors_allowed_origins=("HTTPS://WORDFLOW.EXAMPLE:443/",)
    ).cors_allowed_origins == ("https://wordflow.example",)
    with pytest.raises(ValidationError, match="provider"):
        Settings(multi_user=True, cors_allowed_origins=("https://wordflow.example",))
    desktop = Settings(backend_port=8123)
    assert desktop.cors_allowed_origins == ()
    assert desktop.get_allowed_origins() == ()
    with pytest.raises(ValidationError, match="local HTTP"):
        Settings(
            multi_user=True,
            google_client_id="client-id",
            session_cookie_secure=False,
            cors_allowed_origins=("https://wordflow.example",),
        )
    with pytest.raises(ValidationError, match="local HTTP"):
        Settings(
            multi_user=True,
            google_client_id="client-id",
            session_cookie_secure=False,
            server_host="0.0.0.0",
            trusted_hosts=("wordflow.example",),
            cors_allowed_origins=(),
        )


def test_network_and_capacity_settings_are_bounded() -> None:
    assert Settings().server_host == "127.0.0.1"
    with pytest.raises(ValidationError, match="loopback"):
        Settings(server_host="0.0.0.0")
    with pytest.raises(ValidationError, match="loopback"):
        Settings(server_host="192.0.2.10")
    assert Settings(server_host="::1").server_host == "::1"

    with pytest.raises(ValidationError):
        Settings(backend_port=0)
    with pytest.raises(ValidationError):
        Settings(quotation_service_timeout=0)
    with pytest.raises(ValidationError):
        Settings(quotation_service_max_batch_size=0)
    with pytest.raises(ValidationError):
        Settings(analysis_execution_capacity=0)
    with pytest.raises(ValidationError):
        Settings(max_analysis_storage_bytes=0)
    with pytest.raises(ValidationError):
        Settings(max_analysis_storage_files=0)
    with pytest.raises(ValidationError):
        Settings(shutdown_grace_seconds=0)
    with pytest.raises(ValidationError):
        Settings(shutdown_grace_seconds=float("inf"))
    with pytest.raises(ValidationError):
        Settings(ldaca_oni_timeout=0)
    with pytest.raises(ValidationError, match="HTTPS origin"):
        Settings(cilogon_issuer="http://issuer.example")
    with pytest.raises(ValidationError, match="HTTPS origin"):
        Settings(cilogon_issuer="https://issuer.example/tenant")
    for malformed in ("https:", "https:///"):
        with pytest.raises(ValidationError, match="HTTPS origin"):
            Settings(cilogon_issuer=malformed)


def test_logging_and_cilogon_callback_paths_are_startup_validated() -> None:
    assert Settings(log_file="logs/backend.jsonl").log_file == "logs/backend.jsonl"
    for value in ("../backend.log", "/tmp/backend.log", "logs\\backend.log"):
        with pytest.raises(ValidationError):
            Settings(log_file=value)
    with pytest.raises(ValidationError):
        Settings.model_validate({"log_level": "VERBOSE"})

    provider: dict[str, object] = {
        "cilogon_client_id": "client",
        "cilogon_client_secret": "cilogon-plaintext-secret",
    }
    with pytest.raises(ValidationError, match="redirect URI is required"):
        Settings.model_validate(provider)
    for uri in (
        "https://user:pass@wordflow.example/api/auth/cilogon/callback",
        "http://wordflow.example/api/auth/cilogon/callback",
        "https://wordflow.example:abc/api/auth/cilogon/callback",
        "https://wordflow.example/callback",
    ):
        with pytest.raises(ValidationError):
            Settings.model_validate({**provider, "cilogon_redirect_uri": uri})

    configured = Settings.model_validate(
        {
            **provider,
            "cilogon_redirect_uri": (
                "https://wordflow.example/api/auth/cilogon/callback"
            ),
            "ldaca_oni_api_token": "oni-plaintext-secret",
        }
    )
    representation = repr(configured)
    assert "cilogon-plaintext-secret" not in representation
    assert "oni-plaintext-secret" not in representation
