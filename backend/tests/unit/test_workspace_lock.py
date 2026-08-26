"""Operating-system ownership tests for the per-Workspace lock registry."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import textwrap
import uuid

import pytest

from ldaca_wordflow.infrastructure.storage.workspace_lock import (
    WorkspaceLockContendedError,
    WorkspaceLockStorageError,
    acquire_workspace_lock,
)


def test_abrupt_process_exit_releases_workspace_lock(tmp_path: Path) -> None:
    lock_root = tmp_path / "workspaces" / ".locks"
    workspace_id = str(uuid.uuid4())
    child_code = textwrap.dedent(
        """
        import os
        from pathlib import Path
        import sys
        from ldaca_wordflow.infrastructure.storage.workspace_lock import acquire_workspace_lock

        process_lock = acquire_workspace_lock(Path(sys.argv[1]), sys.argv[2])
        print("locked", flush=True)
        input()
        os._exit(17)
        """
    )
    child = subprocess.Popen(
        [sys.executable, "-c", child_code, str(lock_root), workspace_id],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert child.stdout is not None
        assert child.stdout.readline().strip() == "locked"
        with pytest.raises(WorkspaceLockContendedError):
            acquire_workspace_lock(lock_root, workspace_id)

        assert child.stdin is not None
        child.stdin.write("\n")
        child.stdin.flush()
        assert child.wait(timeout=10) == 17

        replacement = acquire_workspace_lock(lock_root, workspace_id)
        try:
            assert (lock_root / f"{workspace_id}.lock").read_text(
                encoding="ascii"
            ) == f"pid={os.getpid()}\n"
        finally:
            replacement.close()
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=10)


def test_lock_registry_symlink_is_rejected_without_writing_target(
    tmp_path: Path,
) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    lock_root = tmp_path / "workspaces" / ".locks"
    lock_root.parent.mkdir()
    try:
        lock_root.symlink_to(outside, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"symlinks are unavailable: {exc}")

    with pytest.raises(WorkspaceLockStorageError):
        acquire_workspace_lock(lock_root, str(uuid.uuid4()))

    assert list(outside.iterdir()) == []


def test_lock_registry_ownership_mismatch_is_rejected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if not hasattr(os, "getuid"):
        pytest.skip("numeric filesystem ownership is unavailable")
    lock_root = tmp_path / "workspaces" / ".locks"
    lock_root.mkdir(parents=True)
    actual_uid = os.getuid()
    monkeypatch.setattr(os, "getuid", lambda: actual_uid + 1)

    with pytest.raises(WorkspaceLockStorageError):
        acquire_workspace_lock(lock_root, str(uuid.uuid4()))

    assert list(lock_root.iterdir()) == []


def test_unexpected_lock_entry_type_is_rejected(tmp_path: Path) -> None:
    lock_root = tmp_path / "workspaces" / ".locks"
    lock_root.mkdir(parents=True)
    workspace_id = str(uuid.uuid4())
    (lock_root / f"{workspace_id}.lock").mkdir()

    with pytest.raises(WorkspaceLockStorageError):
        acquire_workspace_lock(lock_root, workspace_id)


def test_hard_link_lock_entry_is_rejected_without_modifying_target(
    tmp_path: Path,
) -> None:
    lock_root = tmp_path / "workspaces" / ".locks"
    lock_root.mkdir(parents=True)
    workspace_id = str(uuid.uuid4())
    outside = tmp_path / "outside.txt"
    outside.write_text("do not modify", encoding="utf-8")
    try:
        os.link(outside, lock_root / f"{workspace_id}.lock")
    except OSError as exc:
        pytest.skip(f"hard links are unavailable: {exc}")

    with pytest.raises(WorkspaceLockStorageError):
        acquire_workspace_lock(lock_root, workspace_id)

    assert outside.read_text(encoding="utf-8") == "do not modify"
