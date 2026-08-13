from __future__ import annotations

from pathlib import Path

import anyio
import pytest
import rtoml

from ldaca_wordflow.domain.annotation import AnnotationProviderSnapshot
from ldaca_wordflow.infrastructure.storage.layout import (
    user_preferences_path,
    user_provider_credentials_path,
)
from ldaca_wordflow.models.provider_credentials import (
    AnnotationProviderConfigurationCreate,
    DataPortalCredentialPatch,
)
from ldaca_wordflow.models.user_preferences import (
    PREFERENCES_SCHEMA_VERSION,
    UserPreferencesPatch,
)
from ldaca_wordflow.services.provider_credentials import ProviderCredentialStore
from ldaca_wordflow.services.user_preferences import UserPreferenceStore
from ldaca_wordflow.settings import Settings
from ldaca_wordflow.shared.errors import (
    AccessDeniedError,
    InvalidInputError,
    ProviderCredentialMissingError,
    ProviderCredentialsCorruptError,
    UserPreferencesCorruptError,
)


def _stores(
    tmp_path: Path,
    *,
    multi_user: bool = False,
    deployment_token: str | None = None,
) -> tuple[
    UserPreferenceStore,
    ProviderCredentialStore,
    Settings,
]:
    settings = Settings(
        data_root=tmp_path,
        multi_user=multi_user,
        ldaca_oni_api_token=deployment_token,
        google_client_id="google-client" if multi_user else "",
    )
    limiter = anyio.CapacityLimiter(2)
    preferences = UserPreferenceStore(
        settings,
        io_limiter=limiter,
    )
    credentials = ProviderCredentialStore(
        settings,
        io_limiter=limiter,
    )
    return preferences, credentials, settings


@pytest.mark.anyio
async def test_missing_preferences_return_schema_versioned_defaults(tmp_path: Path) -> None:
    preferences, _credentials, settings = _stores(tmp_path)

    result = await preferences.get("root")

    assert result.model_dump() == {
        "hidden_views": [],
        "favorite_workspaces": [],
        "analysis_multi_tab_enabled": False,
        "contextual_hints_enabled": True,
    }
    stored = rtoml.loads(
        user_preferences_path(settings, "root").read_text(encoding="utf-8")
    )
    assert stored["schema_version"] == PREFERENCES_SCHEMA_VERSION


@pytest.mark.anyio
async def test_patch_changes_only_explicit_fields(
    tmp_path: Path,
) -> None:
    preferences, _credentials, _settings = _stores(tmp_path)
    await preferences.update(
        "root",
        UserPreferencesPatch(
            hidden_views=["quotation", "quotation", " "],
            contextual_hints_enabled=False,
        ),
    )

    result = await preferences.update(
        "root",
        UserPreferencesPatch(favorite_workspaces=["workspace-a"]),
    )

    assert result.hidden_views == ["quotation"]
    assert result.favorite_workspaces == ["workspace-a"]
    assert result.contextual_hints_enabled is False
    stored = rtoml.loads(
        user_preferences_path(_settings, "root").read_text(encoding="utf-8")
    )
    assert stored["schema_version"] == 2


@pytest.mark.anyio
async def test_credential_updates_never_touch_sanitized_preferences(
    tmp_path: Path,
) -> None:
    preferences, credentials, settings = _stores(tmp_path)
    await preferences.get("root")

    await credentials.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="OpenAI",
            provider="openai",
            api_key="top-secret",
        )
    )

    assert "top-secret" not in user_preferences_path(
        settings, "root"
    ).read_text(encoding="utf-8")
    assert "top-secret" in user_provider_credentials_path(
        settings, "root"
    ).read_text(encoding="utf-8")


@pytest.mark.anyio
async def test_single_user_credentials_use_only_the_canonical_root_file(
    tmp_path: Path,
) -> None:
    _preferences, credentials, settings = _stores(tmp_path)

    configuration = await credentials.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="OpenAI",
            provider="openai",
            api_key="root-secret",
        )
    )

    summary = await credentials.summary()
    assert summary.storage == "backend"
    assert summary.annotation_providers == [configuration]
    assert await credentials.resolve_annotation_provider(
        AnnotationProviderSnapshot(
            provider_configuration_id=configuration.id,
            provider="openai",
        )
    ) == "root-secret"
    assert user_provider_credentials_path(settings, "root").is_file()
    assert list(settings.get_users_root_folder().glob("*/provider-credentials.toml")) == [
        user_provider_credentials_path(settings, "root")
    ]


@pytest.mark.anyio
async def test_single_user_rejects_request_supplied_credentials(tmp_path: Path) -> None:
    _preferences, credentials, _settings = _stores(tmp_path)
    configuration = await credentials.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="OpenAI",
            provider="openai",
            api_key="root-secret",
        )
    )

    with pytest.raises(InvalidInputError):
        await credentials.resolve_annotation_provider(
            AnnotationProviderSnapshot(
                provider_configuration_id=configuration.id,
                provider="openai",
            ),
            supplied="request-secret",
        )
    with pytest.raises(InvalidInputError):
        await credentials.data_portal_credential(supplied="request-secret")


@pytest.mark.anyio
async def test_multi_user_credentials_are_browser_owned_and_legacy_files_unread(
    tmp_path: Path,
) -> None:
    _preferences, credentials, settings = _stores(
        tmp_path,
        multi_user=True,
        deployment_token="deployment-token",
    )
    legacy_path = user_provider_credentials_path(settings, "user-a")
    legacy_path.parent.mkdir(parents=True)
    legacy_path.write_text("invalid = [", encoding="utf-8")

    summary = await credentials.summary()

    assert summary.storage == "browser"
    assert summary.annotation_providers is None
    assert summary.data_portal.user_configured is None
    assert summary.data_portal.deployment_configured is True
    browser_snapshot = AnnotationProviderSnapshot(
        provider_configuration_id="0b3da4fe-edbe-45f2-a1cb-80ddc562b2fc",
        provider="openai",
    )
    assert await credentials.resolve_annotation_provider(
        browser_snapshot, supplied="browser-secret"
    ) == "browser-secret"
    assert await credentials.data_portal_credential(
        supplied="browser-token"
    ) == "browser-token"
    assert await credentials.data_portal_credential() == "deployment-token"
    with pytest.raises(ProviderCredentialMissingError):
        await credentials.resolve_annotation_provider(browser_snapshot)
    with pytest.raises(AccessDeniedError):
        await credentials.update_data_portal_credential(
            DataPortalCredentialPatch(data_portal_api_token="denied")
        )
    with pytest.raises(AccessDeniedError):
        await credentials.clear()
    assert legacy_path.read_text(encoding="utf-8") == "invalid = ["


@pytest.mark.anyio
async def test_corrupt_canonical_preference_file_fails_visibly(tmp_path: Path) -> None:
    preferences, _credentials, settings = _stores(tmp_path)
    path = user_preferences_path(settings, "root")
    path.parent.mkdir(parents=True)
    path.write_text("invalid = [", encoding="utf-8")

    with pytest.raises(UserPreferencesCorruptError):
        await preferences.get("root")


@pytest.mark.anyio
async def test_unversioned_preference_file_is_rejected(tmp_path: Path) -> None:
    preferences, _credentials, settings = _stores(tmp_path)
    path = user_preferences_path(settings, "root")
    path.parent.mkdir(parents=True)
    path.write_text(rtoml.dumps({"contextual_hints_enabled": False}), encoding="utf-8")

    with pytest.raises(UserPreferencesCorruptError):
        await preferences.get("root")


@pytest.mark.anyio
async def test_schema_one_preference_file_is_rejected_without_migration(
    tmp_path: Path,
) -> None:
    preferences, _credentials, settings = _stores(tmp_path)
    path = user_preferences_path(settings, "root")
    path.parent.mkdir(parents=True)
    path.write_text(
        rtoml.dumps(
            {
                "schema_version": 1,
                "default_tokenizer_model": "native:plain_words_en",
                "contextual_hints_enabled": False,
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(UserPreferencesCorruptError):
        await preferences.get("root")


@pytest.mark.anyio
async def test_corrupt_canonical_credential_file_fails_visibly(tmp_path: Path) -> None:
    preferences, credentials, settings = _stores(tmp_path)
    path = user_provider_credentials_path(settings, "root")
    path.parent.mkdir(parents=True)
    path.write_text("invalid = [", encoding="utf-8")

    assert (await preferences.get("root")).contextual_hints_enabled is True
    with pytest.raises(ProviderCredentialsCorruptError):
        await credentials.summary()


@pytest.mark.anyio
async def test_symlinked_preference_file_is_rejected(tmp_path: Path) -> None:
    preferences, _credentials, settings = _stores(tmp_path)
    path = user_preferences_path(settings, "root")
    path.parent.mkdir(parents=True)
    target = tmp_path / "outside.toml"
    target.write_text("", encoding="utf-8")
    path.symlink_to(target)

    with pytest.raises(UserPreferencesCorruptError):
        await preferences.get("root")


def test_preferences_api_reads_and_patches_current_user(files_test_client) -> None:
    initial = files_test_client.get("/api/preferences")
    assert initial.status_code == 200
    assert initial.json()["contextual_hints_enabled"] is True

    updated = files_test_client.patch(
        "/api/preferences",
        json={
            "favorite_workspaces": ["workspace-a"],
            "contextual_hints_enabled": False,
        },
    )

    assert updated.status_code == 200
    assert updated.json()["favorite_workspaces"] == ["workspace-a"]
    assert updated.json()["contextual_hints_enabled"] is False
    assert updated.json()["analysis_multi_tab_enabled"] is False


def test_multi_user_credential_api_reports_browser_ownership_and_denies_writes(
    multi_user_test_client,
    tmp_path: Path,
) -> None:
    user_id = multi_user_test_client.get("/api/session").json()["user"]["id"]
    settings = Settings(
        data_root=tmp_path,
        multi_user=True,
        google_client_id="google-client",
    )
    legacy_path = user_provider_credentials_path(settings, user_id)
    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_path.write_text("invalid = [", encoding="utf-8")

    status = multi_user_test_client.get("/api/provider-credentials")

    assert status.status_code == 200
    assert status.json() == {
        "storage": "browser",
        "annotation_providers": None,
        "data_portal": {
            "user_configured": None,
            "deployment_configured": False,
        },
    }
    patched = multi_user_test_client.patch(
        "/api/provider-credentials",
        json={"data_portal_api_token": "must-not-persist"},
    )
    assert patched.status_code == 403
    assert patched.json()["code"] == "access_denied"
    deleted = multi_user_test_client.delete("/api/provider-credentials")
    assert deleted.status_code == 403
    assert deleted.json()["code"] == "access_denied"
    assert legacy_path.read_text(encoding="utf-8") == "invalid = ["
