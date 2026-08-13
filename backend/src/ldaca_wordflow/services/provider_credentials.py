"""Mode-aware provider credential persistence and runtime resolution."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from functools import partial
from pathlib import Path

import anyio
import rtoml
from anyio.to_thread import run_sync as run_sync_in_worker_thread
from pydantic import SecretStr, ValidationError

from ..domain.annotation import AnnotationProviderSnapshot
from ..infrastructure.storage.durable_fs import atomic_output_path
from ..infrastructure.storage.layout import user_provider_credentials_path
from ..models.provider_credentials import (
    AnnotationProviderConfigurationCreate,
    AnnotationProviderConfigurationUpdate,
    AnnotationProviderConfigurationResource,
    DataPortalCredentialPatch,
    ProviderCredentialSummary,
    StoredAnnotationProviderConfiguration,
    StoredProviderCredentials,
)
from ..settings import Settings
from ..shared.errors import (
    AccessDeniedError,
    InvalidInputError,
    NotFoundError,
    ProviderCredentialMissingError,
    ProviderCredentialsCorruptError,
)
from .sessions import SINGLE_USER

logger = logging.getLogger(__name__)


class ProviderCredentialStore:
    """Persist local credentials or resolve hosted credentials per request."""

    def __init__(
        self,
        settings: Settings,
        *,
        io_limiter: anyio.CapacityLimiter,
    ) -> None:
        self._settings = settings
        self._io_limiter = io_limiter
        self._lock = anyio.Lock()

    async def summary(self) -> ProviderCredentialSummary:
        if self._settings.multi_user:
            return ProviderCredentialSummary(
                storage="browser",
                annotation_providers=None,
                data_portal={
                    "user_configured": None,
                    "deployment_configured": self._deployment_credential() is not None,
                },
            )
        async with self._lock:
            stored = await self._load()
        return self._summary(stored)

    async def create_annotation_provider(
        self,
        command: AnnotationProviderConfigurationCreate,
    ) -> AnnotationProviderConfigurationResource:
        self._require_backend_storage()
        async with self._lock:
            stored = await self._load()
            configuration = StoredAnnotationProviderConfiguration(
                id=uuid.uuid4(),
                name=command.name,
                provider=command.provider,
                base_url=command.base_url,
                api_key=command.api_key,
            )
            updated = stored.model_copy(
                update={
                    "annotation_providers": [
                        *stored.annotation_providers,
                        configuration,
                    ]
                }
            )
            await self._run_io(_write_credentials, self._path(), updated)
        return _configuration_resource(configuration)

    async def update_annotation_provider(
        self,
        configuration_id: uuid.UUID,
        command: AnnotationProviderConfigurationUpdate,
    ) -> AnnotationProviderConfigurationResource:
        """Update one saved slot while preserving its UUID, locator, and order.

        Called by the PATCH route in backend-owned deployments. The request
        model has already separated omission from explicit credential removal;
        rebuilding the stored model revalidates the complete candidate before
        the single atomic file replacement.
        """

        self._require_backend_storage()
        async with self._lock:
            stored = await self._load()
            configurations = list(stored.annotation_providers)
            for index, configuration in enumerate(configurations):
                if configuration.id == configuration_id:
                    name = configuration.name
                    if "name" in command.model_fields_set:
                        assert command.name is not None
                        name = command.name
                    updated_configuration = StoredAnnotationProviderConfiguration(
                        id=configuration.id,
                        name=name,
                        provider=configuration.provider,
                        base_url=configuration.base_url,
                        api_key=(
                            command.api_key
                            if "api_key" in command.model_fields_set
                            else configuration.api_key
                        ),
                    )
                    configurations[index] = updated_configuration
                    updated = stored.model_copy(
                        update={"annotation_providers": configurations}
                    )
                    await self._run_io(_write_credentials, self._path(), updated)
                    return _configuration_resource(updated_configuration)
        raise NotFoundError("Annotation provider configuration not found")

    async def delete_annotation_provider(
        self,
        configuration_id: uuid.UUID,
    ) -> None:
        self._require_backend_storage()
        async with self._lock:
            stored = await self._load()
            configurations = [
                configuration
                for configuration in stored.annotation_providers
                if configuration.id != configuration_id
            ]
            if len(configurations) == len(stored.annotation_providers):
                raise NotFoundError("Annotation provider configuration not found")
            updated = stored.model_copy(
                update={"annotation_providers": configurations}
            )
            await self._run_io(_write_credentials, self._path(), updated)

    async def clear_annotation_providers(self) -> None:
        self._require_backend_storage()
        async with self._lock:
            stored = await self._load()
            updated = stored.model_copy(update={"annotation_providers": []})
            await self._run_io(_write_credentials, self._path(), updated)

    async def update_data_portal_credential(
        self,
        patch: DataPortalCredentialPatch,
    ) -> ProviderCredentialSummary:
        self._require_backend_storage()
        async with self._lock:
            stored = await self._load()
            updated = self._apply_data_portal_patch(stored, patch)
            await self._run_io(
                _write_credentials,
                self._path(),
                updated,
            )
        return self._summary(updated)

    async def clear(self) -> None:
        self._require_backend_storage()
        async with self._lock:
            await self._load()
            await self._run_io(
                _write_credentials,
                self._path(),
                StoredProviderCredentials(schema_version=2),
            )

    async def resolve_annotation_provider(
        self,
        snapshot: AnnotationProviderSnapshot,
        *,
        supplied: SecretStr | str | None = None,
    ) -> str | None:
        if self._settings.multi_user:
            credential = _secret_value(supplied)
            if snapshot.provider != "custom" and credential is None:
                raise ProviderCredentialMissingError(
                    f"No credential is configured for {snapshot.provider}"
                )
            return credential

        self._reject_supplied(supplied)
        async with self._lock:
            stored = await self._load()
        configuration = next(
            (
                item
                for item in stored.annotation_providers
                if item.id == snapshot.provider_configuration_id
            ),
            None,
        )
        if configuration is None:
            raise ProviderCredentialMissingError(
                "Annotation provider configuration is not available"
            )
        if (
            configuration.provider != snapshot.provider
            or configuration.base_url != snapshot.provider_base_url
        ):
            raise InvalidInputError(
                "Annotation provider configuration does not match the request"
            )
        credential = _secret_value(configuration.api_key)
        if configuration.provider != "custom" and credential is None:
            raise ProviderCredentialMissingError(
                f"No credential is configured for {configuration.provider}"
            )
        return credential

    async def data_portal_credential(
        self,
        *,
        supplied: SecretStr | str | None = None,
    ) -> str | None:
        if self._settings.multi_user:
            return _secret_value(supplied) or self._deployment_credential()
        self._reject_supplied(supplied)
        async with self._lock:
            stored = await self._load()
        return (
            _secret_value(stored.data_portal.api_token)
            or self._deployment_credential()
        )

    async def _load(self) -> StoredProviderCredentials:
        try:
            result = await self._run_io(_load_credentials, self._path())
        except _InvalidCredentials as exc:
            logger.warning("Invalid provider credentials for single-user root")
            raise ProviderCredentialsCorruptError() from exc
        if not isinstance(result, StoredProviderCredentials):
            raise TypeError("Provider credential reader returned an invalid value")
        return result

    def _path(self) -> Path:
        return user_provider_credentials_path(self._settings, SINGLE_USER.id)

    def _deployment_credential(self) -> str | None:
        return _secret_value(self._settings.ldaca_oni_api_token)

    def _require_backend_storage(self) -> None:
        if self._settings.multi_user:
            raise AccessDeniedError(
                "Provider credentials are owned by the browser in multi-user mode"
            )

    def _reject_supplied(self, supplied: SecretStr | str | None) -> None:
        if supplied is not None:
            raise InvalidInputError(
                "Request credentials are not accepted in single-user mode"
            )

    @staticmethod
    def _apply_data_portal_patch(
        stored: StoredProviderCredentials,
        patch: DataPortalCredentialPatch,
    ) -> StoredProviderCredentials:
        values = stored.model_dump()
        portal = values["data_portal"]
        if "data_portal_api_token" in patch.model_fields_set:
            portal["api_token"] = patch.data_portal_api_token
        return StoredProviderCredentials.model_validate(values)

    def _summary(
        self,
        stored: StoredProviderCredentials,
    ) -> ProviderCredentialSummary:
        return ProviderCredentialSummary(
            storage="backend",
            annotation_providers=[
                _configuration_resource(configuration)
                for configuration in stored.annotation_providers
            ],
            data_portal={
                "user_configured": stored.data_portal.api_token is not None,
                "deployment_configured": self._deployment_credential() is not None,
            },
        )

    async def _run_io(self, function: Callable[..., object], *args: object) -> object:
        return await run_sync_in_worker_thread(
            partial(function, *args),
            abandon_on_cancel=False,
            limiter=self._io_limiter,
        )


class _InvalidCredentials(ValueError):
    pass


def _secret_value(value: SecretStr | str | None) -> str | None:
    if isinstance(value, SecretStr):
        return value.get_secret_value()
    return value


def _load_credentials(path: Path) -> StoredProviderCredentials:
    if not path.exists():
        return StoredProviderCredentials(schema_version=2)
    if path.is_symlink() or not path.is_file():
        raise _InvalidCredentials("Stored file must be a regular file")
    try:
        raw = rtoml.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise _InvalidCredentials("Stored TOML is invalid") from exc
    if not isinstance(raw, dict):
        raise _InvalidCredentials("Stored TOML must contain a table")
    try:
        return StoredProviderCredentials.model_validate(raw)
    except ValidationError as exc:
        raise _InvalidCredentials("Provider credential schema is invalid") from exc


def _write_credentials(path: Path, credentials: StoredProviderCredentials) -> None:
    payload: dict[str, object] = {
        "schema_version": credentials.schema_version,
        "annotation_providers": [
            {
                "id": str(configuration.id),
                "name": configuration.name,
                "provider": configuration.provider,
                **(
                    {"base_url": configuration.base_url}
                    if configuration.base_url is not None
                    else {}
                ),
                **(
                    {"api_key": configuration.api_key.get_secret_value()}
                    if configuration.api_key is not None
                    else {}
                ),
            }
            for configuration in credentials.annotation_providers
        ],
        "data_portal": (
            {"api_token": credentials.data_portal.api_token.get_secret_value()}
            if credentials.data_portal.api_token is not None
            else {}
        ),
    }
    with atomic_output_path(path) as temporary:
        temporary.chmod(0o600)
        temporary.write_text(rtoml.dumps(payload), encoding="utf-8")
        temporary.chmod(0o600)
    path.chmod(0o600)


def _configuration_resource(
    configuration: StoredAnnotationProviderConfiguration,
) -> AnnotationProviderConfigurationResource:
    return AnnotationProviderConfigurationResource(
        id=configuration.id,
        name=configuration.name,
        provider=configuration.provider,
        base_url=configuration.base_url,
        has_api_key=configuration.api_key is not None,
    )


__all__ = ["ProviderCredentialStore"]
