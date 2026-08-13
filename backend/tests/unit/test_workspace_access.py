"""Strict deployment-only Workspace ownership sidecar contract."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ldaca_wordflow.infrastructure.storage.workspace_access import (
    WorkspaceAccessInvalidError,
    read_workspace_owner,
    write_workspace_owner,
)


def test_access_sidecar_contains_exactly_one_owner(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    write_workspace_owner(workspace, "owner-1")

    assert json.loads((workspace / "access.json").read_text(encoding="utf-8")) == {
        "owner_id": "owner-1"
    }
    assert read_workspace_owner(workspace) == "owner-1"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"owner_id": "owner", "role": "admin"},
        {"owner_id": ""},
        {"owner_id": 1},
        [],
    ],
)
def test_access_sidecar_rejects_every_noncanonical_shape(
    tmp_path: Path,
    payload: object,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "access.json").write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(WorkspaceAccessInvalidError):
        read_workspace_owner(workspace)


def test_access_sidecar_rejects_duplicate_owner_fields(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "access.json").write_text(
        '{"owner_id":"first","owner_id":"second"}',
        encoding="utf-8",
    )

    with pytest.raises(WorkspaceAccessInvalidError):
        read_workspace_owner(workspace)


@pytest.mark.skipif(not hasattr(Path, "symlink_to"), reason="symlinks unavailable")
def test_access_sidecar_rejects_symlinks(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    target = tmp_path / "outside.json"
    target.write_text('{"owner_id":"owner"}', encoding="utf-8")
    try:
        (workspace / "access.json").symlink_to(target)
    except OSError:
        pytest.skip("symlink creation is unavailable")

    with pytest.raises(WorkspaceAccessInvalidError):
        read_workspace_owner(workspace)
