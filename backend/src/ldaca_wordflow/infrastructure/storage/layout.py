"""Pure path layout and portable naming for runtime-owned storage."""

from __future__ import annotations

import re
from pathlib import Path

from ...settings import Settings
from ...shared.errors import InvalidInputError

_SAFE_USER_ID = re.compile(r"[A-Za-z0-9._-]+\Z")
NODE_SOURCE_STAGING_PREFIX = ".wordflow-node-"
NODE_SOURCE_STAGING_SUFFIX = ".parquet.tmp"
SAFE_WORKSPACE_IMPORT_MARKER = ".wordflow-safe-materialized-import"
SAFE_WORKSPACE_IMPORT_MARKER_CONTENT = "wordflow-materialized-workspace-v2\n"
USER_FILE_IMPORT_STAGING_DIRECTORY = ".wordflow-import-staging"


def validate_display_name(name: str) -> tuple[bool, str]:
    """Validate a human label without applying file-component rules."""

    trimmed = name.strip()
    if not trimmed:
        return False, "name cannot be empty"
    if ".." in trimmed:
        return False, "name cannot contain '..'"
    if "/" in trimmed or "\\" in trimmed:
        return False, "name cannot contain path separators"
    if any(ord(character) < 32 or ord(character) == 127 for character in trimmed):
        return False, "name cannot contain control characters"
    return True, ""


def validate_user_id(user_id: str) -> str:
    """Return one path-safe opaque principal identifier unchanged."""

    if not _SAFE_USER_ID.fullmatch(user_id):
        raise InvalidInputError("Invalid user identifier")
    return user_id


def workspaces_root(settings: Settings) -> Path:
    """Return the sole durable Workspace catalogue root."""

    return settings.get_data_root() / "workspaces"


def deployment_database_path(settings: Settings) -> Path:
    return settings.get_data_root() / "deployment.sqlite3"


def workspace_staging_root(settings: Settings) -> Path:
    return workspaces_root(settings) / ".staging"


def workspace_trash_root(settings: Settings) -> Path:
    return workspaces_root(settings) / ".trash"


def user_root(settings: Settings, user_id: str) -> Path:
    """Return the stable private root for one validated user identity."""

    return settings.get_users_root_folder() / validate_user_id(user_id)


def user_files_root(settings: Settings, user_id: str) -> Path:
    return user_root(settings, user_id) / "files"


def user_imports_root(settings: Settings, user_id: str) -> Path:
    return user_root(settings, user_id) / "imports"


def user_preferences_path(settings: Settings, user_id: str) -> Path:
    return user_root(settings, user_id) / "preferences.toml"


def user_provider_credentials_path(settings: Settings, user_id: str) -> Path:
    return user_root(settings, user_id) / "provider-credentials.toml"


def user_cache_root(settings: Settings, user_id: str) -> Path:
    return settings.get_data_root() / ".cache" / "users" / validate_user_id(user_id)


__all__ = [
    "NODE_SOURCE_STAGING_PREFIX",
    "NODE_SOURCE_STAGING_SUFFIX",
    "SAFE_WORKSPACE_IMPORT_MARKER",
    "SAFE_WORKSPACE_IMPORT_MARKER_CONTENT",
    "USER_FILE_IMPORT_STAGING_DIRECTORY",
    "deployment_database_path",
    "user_cache_root",
    "user_files_root",
    "user_imports_root",
    "user_preferences_path",
    "user_provider_credentials_path",
    "user_root",
    "validate_user_id",
    "validate_display_name",
    "workspace_staging_root",
    "workspace_trash_root",
    "workspaces_root",
]
