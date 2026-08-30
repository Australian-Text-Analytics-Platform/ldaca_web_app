"""Strict provider-credential resources and write-only update commands."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StringConstraints,
    field_validator,
    model_validator,
)

from ..domain.annotation import (
    AnnotationProvider,
    normalize_annotation_provider_base_url,
)

CredentialStorage = Literal["backend", "browser"]

CredentialValue = Annotated[
    SecretStr,
    Field(
        min_length=1,
        max_length=4_000,
        json_schema_extra={"writeOnly": True},
    ),
]

ProviderConfigurationName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DataPortalCredentialPatch(_StrictModel):
    """Write-only Data Portal credential update."""

    data_portal_api_token: CredentialValue | None = None


class _AnnotationProviderConfigurationFields(_StrictModel):
    name: ProviderConfigurationName
    provider: AnnotationProvider
    base_url: str | None = Field(default=None, max_length=2_000)

    @field_validator("base_url", mode="before")
    @classmethod
    def normalize_base_url(cls, value: object) -> object:
        if value is None or not isinstance(value, str):
            return value
        return normalize_annotation_provider_base_url(value)

    @model_validator(mode="after")
    def validate_locator(self) -> _AnnotationProviderConfigurationFields:
        if self.provider == "custom" and self.base_url is None:
            raise ValueError("Custom providers require a base URL")
        if self.provider != "custom" and self.base_url is not None:
            raise ValueError("Built-in providers cannot define a base URL")
        return self


class AnnotationProviderConfigurationCreate(_AnnotationProviderConfigurationFields):
    """Create one stable provider connection with an optional credential."""

    api_key: CredentialValue | None = None

class AnnotationProviderConfigurationResource(_AnnotationProviderConfigurationFields):
    """Safe provider-configuration metadata returned to clients."""

    id: uuid.UUID
    has_api_key: bool


class AnnotationProviderConfigurationUpdate(_StrictModel):
    """Patch mutable connection details without accepting immutable locators.

    Used by the provider-credential route in single-user mode. Omission keeps a
    value unchanged, while an explicit null credential removes the saved key.
    Names cannot be cleared and an empty object is never a meaningful update.
    """

    name: ProviderConfigurationName | None = None
    api_key: CredentialValue | None = None

    @model_validator(mode="after")
    def validate_patch(self) -> AnnotationProviderConfigurationUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one provider configuration field is required")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Provider configuration name cannot be null")
        return self


class DataPortalCredentialStatus(_StrictModel):
    user_configured: bool | None
    deployment_configured: bool


class ProviderCredentialSummary(_StrictModel):
    """Safe credential presence information; never contains secret values."""

    storage: CredentialStorage
    annotation_providers: list[AnnotationProviderConfigurationResource] | None
    data_portal: DataPortalCredentialStatus


class _StoredDataPortalCredentials(_StrictModel):
    api_token: SecretStr | None = None


class StoredAnnotationProviderConfiguration(_AnnotationProviderConfigurationFields):
    id: uuid.UUID
    api_key: SecretStr | None = None


class StoredProviderCredentials(_StrictModel):
    """Private representation persisted in the per-user TOML file."""

    schema_version: Literal[2]
    annotation_providers: list[StoredAnnotationProviderConfiguration] = Field(
        default_factory=list
    )
    data_portal: _StoredDataPortalCredentials = Field(
        default_factory=_StoredDataPortalCredentials
    )

    @model_validator(mode="after")
    def unique_annotation_provider_configuration_ids(
        self,
    ) -> StoredProviderCredentials:
        seen_ids: set[uuid.UUID] = set()
        for configuration in self.annotation_providers:
            if configuration.id in seen_ids:
                raise ValueError("Annotation provider configuration IDs must be unique")
            seen_ids.add(configuration.id)
        return self


__all__ = [
    "AnnotationProvider",
    "AnnotationProviderConfigurationCreate",
    "AnnotationProviderConfigurationUpdate",
    "AnnotationProviderConfigurationResource",
    "CredentialStorage",
    "DataPortalCredentialPatch",
    "DataPortalCredentialStatus",
    "ProviderCredentialSummary",
    "StoredAnnotationProviderConfiguration",
    "StoredProviderCredentials",
]
