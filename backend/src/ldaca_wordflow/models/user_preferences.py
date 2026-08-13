"""Strict account-level preference resources."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PREFERENCES_SCHEMA_VERSION = 2


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UserPreferences(_StrictModel):
    """Non-secret preferences synchronized for one authenticated user."""

    hidden_views: list[str] = Field(default_factory=list)
    favorite_workspaces: list[str] = Field(default_factory=list)
    analysis_multi_tab_enabled: bool = False
    contextual_hints_enabled: bool = True

    @field_validator("hidden_views", "favorite_workspaces")
    @classmethod
    def unique_non_empty_values(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            normalized = value.strip()
            if normalized and normalized not in cleaned:
                cleaned.append(normalized)
        return cleaned

class UserPreferencesPatch(_StrictModel):
    """Partial update; only explicitly provided fields are changed."""

    hidden_views: list[str] = Field(default_factory=list)
    favorite_workspaces: list[str] = Field(default_factory=list)
    analysis_multi_tab_enabled: bool = False
    contextual_hints_enabled: bool = True

    @field_validator("hidden_views", "favorite_workspaces")
    @classmethod
    def unique_non_empty_values(cls, values: list[str]) -> list[str]:
        return UserPreferences.unique_non_empty_values(values)

class StoredUserPreferences(UserPreferences):
    """Schema-versioned representation persisted to preferences.toml."""

    schema_version: Literal[2] = Field(default=PREFERENCES_SCHEMA_VERSION, frozen=True)


__all__ = [
    "PREFERENCES_SCHEMA_VERSION",
    "StoredUserPreferences",
    "UserPreferences",
    "UserPreferencesPatch",
]
