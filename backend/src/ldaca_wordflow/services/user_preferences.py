"""Per-user account preference persistence."""

from __future__ import annotations

import logging

import anyio
from pydantic import ValidationError

from ..infrastructure.storage.private_toml import (
    PrivateTomlError,
    PrivateTomlPersistence,
)
from ..models.user_preferences import (
    PREFERENCES_SCHEMA_VERSION,
    StoredUserPreferences,
    UserPreferences,
    UserPreferencesPatch,
)
from ..shared.errors import UserPreferencesCorruptError

logger = logging.getLogger(__name__)
_PREFERENCES_FILENAME = "preferences.toml"

class UserPreferenceStore:
    """Own strict preference files under one lock per user."""

    def __init__(
        self,
        persistence: PrivateTomlPersistence,
    ) -> None:
        self._persistence = persistence
        self._locks: dict[str, anyio.Lock] = {}
        self._locks_guard = anyio.Lock()

    async def get(self, user_id: str) -> UserPreferences:
        async with await self._user_lock(user_id):
            preferences = await self._load(user_id)
        return UserPreferences.model_validate(
            preferences.model_dump(exclude={"schema_version"})
        )

    async def update(
        self,
        user_id: str,
        patch: UserPreferencesPatch,
    ) -> UserPreferences:
        async with await self._user_lock(user_id):
            preferences = await self._load(user_id)
            values = preferences.model_dump()
            for field in patch.model_fields_set:
                values[field] = getattr(patch, field)
            updated = StoredUserPreferences.model_validate(values)
            await self._write(user_id, updated)
        return UserPreferences.model_validate(
            updated.model_dump(exclude={"schema_version"})
        )

    async def _load(self, user_id: str) -> StoredUserPreferences:
        try:
            raw = await self._persistence.read(user_id, _PREFERENCES_FILENAME)
        except PrivateTomlError as exc:
            logger.warning("Invalid user preferences for user %s", user_id)
            raise UserPreferencesCorruptError() from exc
        if raw is None:
            preferences = StoredUserPreferences()
            await self._write(user_id, preferences)
            return preferences
        if raw.get("schema_version") != PREFERENCES_SCHEMA_VERSION:
            raise UserPreferencesCorruptError()
        try:
            return StoredUserPreferences.model_validate(raw)
        except ValidationError as exc:
            logger.warning("Invalid user preferences for user %s", user_id)
            raise UserPreferencesCorruptError() from exc

    async def _write(
        self,
        user_id: str,
        preferences: StoredUserPreferences,
    ) -> None:
        payload = preferences.model_dump(mode="json", exclude_none=True)
        try:
            await self._persistence.write(user_id, _PREFERENCES_FILENAME, payload)
        except PrivateTomlError as exc:
            raise UserPreferencesCorruptError() from exc

    async def _user_lock(self, user_id: str) -> anyio.Lock:
        async with self._locks_guard:
            return self._locks.setdefault(user_id, anyio.Lock())

__all__ = ["UserPreferenceStore"]
