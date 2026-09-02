"""Strict deployment-only ownership sidecar for Workspace directories."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

from .durable_fs import atomic_write_json
from .layout import validate_user_id
from .safe_paths import is_link_or_reparse
from ...shared.errors import InvalidInputError

ACCESS_FILENAME = "access.json"
_MAX_ACCESS_BYTES = 4096


class WorkspaceAccessInvalidError(ValueError):
    """A Workspace ownership sidecar is absent, unsafe, or noncanonical."""


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise WorkspaceAccessInvalidError(
                "Workspace access sidecar contains duplicate fields"
            )
        result[key] = value
    return result


def read_workspace_owner(workspace_path: Path) -> str:
    """Read one exact owner without following an access-sidecar link."""

    path = workspace_path / ACCESS_FILENAME
    descriptor = -1
    try:
        path_metadata = path.lstat()
        if is_link_or_reparse(path_metadata):
            raise WorkspaceAccessInvalidError("Workspace access sidecar is unsafe")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > _MAX_ACCESS_BYTES:
            raise WorkspaceAccessInvalidError("Workspace access sidecar is invalid")
        content = bytearray()
        while len(content) <= _MAX_ACCESS_BYTES:
            chunk = os.read(descriptor, _MAX_ACCESS_BYTES + 1 - len(content))
            if not chunk:
                break
            content.extend(chunk)
        if len(content) > _MAX_ACCESS_BYTES:
            raise WorkspaceAccessInvalidError("Workspace access sidecar is too large")
        payload = json.loads(content.decode("utf-8"), object_pairs_hook=_unique_object)
    except WorkspaceAccessInvalidError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise WorkspaceAccessInvalidError(
            "Workspace access sidecar is invalid"
        ) from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)

    if not isinstance(payload, dict) or set(payload) != {"owner_id"}:
        raise WorkspaceAccessInvalidError("Workspace access sidecar is noncanonical")
    owner_id = payload["owner_id"]
    if not isinstance(owner_id, str):
        raise WorkspaceAccessInvalidError("Workspace owner is invalid")
    try:
        return validate_user_id(owner_id)
    except InvalidInputError as exc:
        raise WorkspaceAccessInvalidError("Workspace owner is invalid") from exc


def write_workspace_owner(workspace_path: Path, owner_id: str) -> None:
    """Atomically publish the exact owner sidecar for a staged Workspace."""

    atomic_write_json(
        workspace_path / ACCESS_FILENAME,
        {"owner_id": validate_user_id(owner_id)},
        max_bytes=_MAX_ACCESS_BYTES,
    )


__all__ = [
    "ACCESS_FILENAME",
    "WorkspaceAccessInvalidError",
    "read_workspace_owner",
    "write_workspace_owner",
]
