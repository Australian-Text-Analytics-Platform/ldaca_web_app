from __future__ import annotations

from pathlib import Path
from uuid import UUID

import anyio
import pytest
import rtoml
from pydantic import ValidationError

from ldaca_wordflow.infrastructure.storage.layout import (
    user_provider_credentials_path,
)
from ldaca_wordflow.infrastructure.storage.private_toml import PrivateTomlPersistence
from ldaca_wordflow.domain.annotation import AnnotationProviderSnapshot
from ldaca_wordflow.models.provider_credentials import (
    AnnotationProviderConfigurationCreate,
    AnnotationProviderConfigurationUpdate,
)
from ldaca_wordflow.services.provider_credentials import ProviderCredentialStore
from ldaca_wordflow.services.sessions import SINGLE_USER
from ldaca_wordflow.settings import Settings
from ldaca_wordflow.shared.errors import (
    InvalidInputError,
    NotFoundError,
    ProviderCredentialMissingError,
    ProviderCredentialsCorruptError,
)

from ._storage import unlimited_storage_admission


def _store(tmp_path: Path, *, multi_user: bool = False) -> tuple[
    ProviderCredentialStore,
    Settings,
]:
    settings = Settings(
        data_root=tmp_path,
        multi_user=multi_user,
        google_client_id="google-client" if multi_user else "",
    )
    limiter = anyio.CapacityLimiter(2)
    persistence = PrivateTomlPersistence(
        settings.get_users_root_folder(),
        unlimited_storage_admission(tmp_path, limiter=limiter),
        limiter=limiter,
    )
    return ProviderCredentialStore(settings, persistence), settings


@pytest.mark.anyio
async def test_create_configuration_returns_safe_ordered_metadata_and_schema_two(
    tmp_path: Path,
) -> None:
    store, settings = _store(tmp_path)

    created = await store.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="OpenRouter personal",
            provider="openrouter",
            api_key="provider-secret",
        )
    )

    assert isinstance(created.id, UUID)
    assert created.model_dump(mode="json") == {
        "id": str(created.id),
        "name": "OpenRouter personal",
        "provider": "openrouter",
        "base_url": None,
        "has_api_key": True,
    }
    summary = await store.summary()
    assert summary.annotation_providers == [created]
    assert "provider-secret" not in summary.model_dump_json()

    stored = rtoml.loads(
        user_provider_credentials_path(settings, SINGLE_USER.id).read_text(
            encoding="utf-8"
        )
    )
    assert stored["schema_version"] == 2
    assert stored["annotation_providers"][0]["api_key"] == "provider-secret"


@pytest.mark.anyio
async def test_keyless_and_duplicate_configurations_are_allowed(
    tmp_path: Path,
) -> None:
    store, _settings = _store(tmp_path)
    first = await store.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="OpenRouter",
            provider="openrouter",
            api_key="personal-key",
        )
    )

    second = await store.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="OpenRouter",
            provider="openrouter",
            api_key="personal-key",
        )
    )
    keyless = await store.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="OpenAI without key",
            provider="openai",
        )
    )

    assert first.name == second.name
    assert first.id != second.id
    assert keyless.has_api_key is False
    assert (await store.summary()).annotation_providers == [first, second, keyless]


@pytest.mark.anyio
async def test_update_delete_and_clear_preserve_collection_semantics(
    tmp_path: Path,
) -> None:
    store, _settings = _store(tmp_path)
    first = await store.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="First",
            provider="openai",
            api_key="first-key",
        )
    )
    second = await store.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="Second",
            provider="openrouter",
            api_key="second-key",
        )
    )

    updated = await store.update_annotation_provider(
        second.id,
        AnnotationProviderConfigurationUpdate(
            name="First",
            api_key="replacement-key",
        ),
    )

    assert updated.model_dump(mode="json") == {
        "id": str(second.id),
        "name": "First",
        "provider": "openrouter",
        "base_url": None,
        "has_api_key": True,
    }
    assert [item.id for item in (await store.summary()).annotation_providers or []] == [
        first.id,
        second.id,
    ]
    snapshot = AnnotationProviderSnapshot(
        provider_configuration_id=second.id,
        provider="openrouter",
    )
    assert await store.resolve_annotation_provider(snapshot) == "replacement-key"
    cleared = await store.update_annotation_provider(
        second.id,
        AnnotationProviderConfigurationUpdate(api_key=None),
    )
    assert cleared.has_api_key is False
    with pytest.raises(ProviderCredentialMissingError):
        await store.resolve_annotation_provider(snapshot)
    await store.delete_annotation_provider(first.id)
    assert (await store.summary()).annotation_providers == [cleared]
    with pytest.raises(NotFoundError):
        await store.delete_annotation_provider(first.id)

    await store.clear_annotation_providers()
    assert (await store.summary()).annotation_providers == []


def test_single_user_api_creates_an_annotation_provider_configuration(
    files_test_client,
) -> None:
    response = files_test_client.post(
        "/api/provider-credentials/annotation-providers",
        json={
            "name": "OpenAI work",
            "provider": "openai",
            "api_key": "api-secret",
        },
    )

    assert response.status_code == 201
    assert response.json() == {
        "id": response.json()["id"],
        "name": "OpenAI work",
        "provider": "openai",
        "base_url": None,
        "has_api_key": True,
    }
    summary = files_test_client.get("/api/provider-credentials").json()
    assert summary["annotation_providers"] == [response.json()]
    assert "api-secret" not in str(summary)


def test_annotation_provider_configuration_api_updates_deletes_and_clears(
    files_test_client,
) -> None:
    first = files_test_client.post(
        "/api/provider-credentials/annotation-providers",
        json={"name": "First", "provider": "openai", "api_key": "first-key"},
    ).json()
    second = files_test_client.post(
        "/api/provider-credentials/annotation-providers",
        json={
            "name": "Second",
            "provider": "openrouter",
            "api_key": "second-key",
        },
    ).json()

    updated = files_test_client.patch(
        f"/api/provider-credentials/annotation-providers/{second['id']}",
        json={"name": "First", "api_key": "replacement-key"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "First"
    assert updated.json()["has_api_key"] is True
    assert "replacement-key" not in updated.text
    cleared = files_test_client.patch(
        f"/api/provider-credentials/annotation-providers/{second['id']}",
        json={"api_key": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["has_api_key"] is False
    assert (
        files_test_client.delete(
            f"/api/provider-credentials/annotation-providers/{first['id']}"
        ).status_code
        == 204
    )
    assert files_test_client.delete(
        "/api/provider-credentials/annotation-providers"
    ).status_code == 204
    assert files_test_client.get("/api/provider-credentials").json()[
        "annotation_providers"
    ] == []


def test_multi_user_api_denies_annotation_provider_configuration_writes(
    multi_user_test_client,
) -> None:
    response = multi_user_test_client.post(
        "/api/provider-credentials/annotation-providers",
        json={"name": "OpenAI", "provider": "openai", "api_key": "browser-key"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "access_denied"
    assert multi_user_test_client.get("/api/provider-credentials").json()[
        "annotation_providers"
    ] is None

    update = multi_user_test_client.patch(
        "/api/provider-credentials/annotation-providers/"
        "74a93227-c081-4db9-af2e-ad357b62278d",
        json={"name": "Renamed"},
    )
    assert update.status_code == 403


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": None},
        {"name": ""},
        {"api_key": ""},
        {"provider": "openai"},
        {"base_url": "https://example.test/v1"},
        {"unexpected": True},
    ],
)
def test_annotation_provider_update_rejects_invalid_patch_shapes(
    files_test_client,
    payload: dict[str, object],
) -> None:
    created = files_test_client.post(
        "/api/provider-credentials/annotation-providers",
        json={"name": "OpenAI", "provider": "openai"},
    ).json()

    response = files_test_client.patch(
        f"/api/provider-credentials/annotation-providers/{created['id']}",
        json=payload,
    )

    assert response.status_code == 422


def test_annotation_provider_update_returns_not_found(files_test_client) -> None:
    response = files_test_client.patch(
        "/api/provider-credentials/annotation-providers/"
        "74a93227-c081-4db9-af2e-ad357b62278d",
        json={"name": "Missing"},
    )

    assert response.status_code == 404


@pytest.mark.anyio
async def test_mode_specific_resolution_verifies_the_safe_configuration_snapshot(
    tmp_path: Path,
) -> None:
    single, _settings = _store(tmp_path / "single")
    created = await single.create_annotation_provider(
        AnnotationProviderConfigurationCreate(
            name="Personal",
            provider="openrouter",
            api_key="stored-secret",
        )
    )
    snapshot = AnnotationProviderSnapshot(
        provider_configuration_id=created.id,
        provider="openrouter",
    )

    assert await single.resolve_annotation_provider(snapshot) == "stored-secret"
    with pytest.raises(InvalidInputError, match="does not match"):
        await single.resolve_annotation_provider(
            AnnotationProviderSnapshot(
                provider_configuration_id=created.id,
                provider="openai",
            )
        )
    with pytest.raises(InvalidInputError, match="not accepted"):
        await single.resolve_annotation_provider(snapshot, supplied="request-secret")

    multi, _settings = _store(tmp_path / "multi", multi_user=True)
    assert await multi.resolve_annotation_provider(
        snapshot,
        supplied="browser-secret",
    ) == "browser-secret"
    with pytest.raises(ProviderCredentialMissingError):
        await multi.resolve_annotation_provider(snapshot)
    assert await multi.resolve_annotation_provider(
        AnnotationProviderSnapshot(
            provider_configuration_id=created.id,
            provider="custom",
            provider_base_url="http://127.0.0.1:9999/v1/",
        )
    ) is None


@pytest.mark.parametrize(
    ("base_url", "normalized"),
    [
        ("https://models.example.test/v1/", "https://models.example.test/v1"),
        ("http://10.0.0.8:8000/api/v1///", "http://10.0.0.8:8000/api/v1"),
        ("http://localhost:9999/v1/", "http://localhost:9999/v1"),
        ("http://127.0.0.1:9999/v1", "http://127.0.0.1:9999/v1"),
    ],
)
def test_custom_provider_accepts_and_normalizes_trusted_http_destinations(
    base_url: str,
    normalized: str,
) -> None:
    command = AnnotationProviderConfigurationCreate(
        name="Custom",
        provider="custom",
        base_url=base_url,
    )

    assert command.base_url == normalized
    assert command.api_key is None


@pytest.mark.parametrize(
    "base_url",
    [
        "ftp://models.example.test/v1",
        "https:///v1",
        "https://user:password@models.example.test/v1",
        "https://models.example.test/v1?token=secret",
        "https://models.example.test/v1#models",
    ],
)
def test_custom_provider_rejects_invalid_or_credential_bearing_urls(
    base_url: str,
) -> None:
    with pytest.raises(ValidationError):
        AnnotationProviderConfigurationCreate(
            name="Custom",
            provider="custom",
            base_url=base_url,
        )


@pytest.mark.anyio
@pytest.mark.parametrize(
    "legacy",
    [
        {"annotation": {"openai": "legacy-secret"}},
        {"schema_version": 1, "annotation": {"openai": "legacy-secret"}},
    ],
)
async def test_old_credential_layouts_are_rejected_without_migration(
    tmp_path: Path,
    legacy: dict[str, object],
) -> None:
    store, settings = _store(tmp_path)
    path = user_provider_credentials_path(settings, SINGLE_USER.id)
    path.parent.mkdir(parents=True)
    path.write_text(
        rtoml.dumps(legacy),
        encoding="utf-8",
    )

    with pytest.raises(ProviderCredentialsCorruptError):
        await store.summary()


@pytest.mark.anyio
async def test_duplicate_stored_configuration_identity_is_valid_schema_two(
    tmp_path: Path,
) -> None:
    store, settings = _store(tmp_path)
    path = user_provider_credentials_path(settings, SINGLE_USER.id)
    path.parent.mkdir(parents=True)
    path.write_text(
        rtoml.dumps(
            {
                "schema_version": 2,
                "annotation_providers": [
                    {
                        "id": "74a93227-c081-4db9-af2e-ad357b62278d",
                        "name": "First",
                        "provider": "openrouter",
                        "api_key": "same-key",
                    },
                    {
                        "id": "8a342ceb-1ed6-433a-bc3f-75b6fd5dba38",
                        "name": "Second",
                        "provider": "openrouter",
                        "api_key": "same-key",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    summary = await store.summary()
    assert summary.annotation_providers is not None
    assert len(summary.annotation_providers) == 2
