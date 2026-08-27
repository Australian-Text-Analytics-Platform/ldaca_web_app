"""Cross-process exclusive ownership for one open Workspace.

The persistent lock file is only a rendezvous point. The operating-system lock
held by its descriptor is authoritative, so a crashed process leaves no stale
ownership that another backend must infer from PID text.
"""

from __future__ import annotations

import errno
import os
import stat
import uuid
from dataclasses import dataclass
from pathlib import Path

from .durable_fs import fsync_directory, mkdir_durable


class WorkspaceLockContendedError(Exception):
    """Another cooperating backend currently owns the Workspace lock."""


class WorkspaceLockStorageError(Exception):
    """The private Workspace lock registry is unsafe or unavailable."""


@dataclass(slots=True)
class WorkspaceProcessLock:
    """One idempotently releasable operating-system file lock."""

    descriptor: int

    def close(self) -> None:
        if self.descriptor < 0:
            return
        descriptor = self.descriptor
        self.descriptor = -1
        try:
            if os.name == "nt":
                import msvcrt

                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def _is_safe_owned_directory(path: Path) -> bool:
    try:
        metadata = path.lstat()
    except OSError:
        return False
    reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    attributes = int(getattr(metadata, "st_file_attributes", 0))
    return (
        stat.S_ISDIR(metadata.st_mode)
        and not stat.S_ISLNK(metadata.st_mode)
        and not attributes & reparse
        and (not hasattr(os, "getuid") or metadata.st_uid == os.getuid())
    )


def _is_safe_owned_file(descriptor: int) -> bool:
    metadata = os.fstat(descriptor)
    reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    attributes = int(getattr(metadata, "st_file_attributes", 0))
    return (
        stat.S_ISREG(metadata.st_mode)
        and metadata.st_nlink == 1
        and not attributes & reparse
        and (not hasattr(os, "getuid") or metadata.st_uid == os.getuid())
    )


def _descriptor_matches_path(descriptor: int, path: Path) -> bool:
    try:
        path_metadata = path.lstat()
    except OSError:
        return False
    reparse = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    attributes = int(getattr(path_metadata, "st_file_attributes", 0))
    return (
        not stat.S_ISLNK(path_metadata.st_mode)
        and not attributes & reparse
        and os.path.samestat(os.fstat(descriptor), path_metadata)
    )


def _lock_descriptor(descriptor: int) -> None:
    try:
        if os.name == "nt":
            import msvcrt

            if os.fstat(descriptor).st_size == 0:
                os.write(descriptor, b"\0")
            os.lseek(descriptor, 0, os.SEEK_SET)
            msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        contention_errnos = {errno.EACCES, errno.EAGAIN}
        if hasattr(errno, "EDEADLK"):
            contention_errnos.add(errno.EDEADLK)
        if exc.errno in contention_errnos or getattr(exc, "winerror", None) in {
            32,
            33,
        }:
            raise WorkspaceLockContendedError from exc
        raise WorkspaceLockStorageError from exc


def acquire_workspace_lock(
    lock_root: Path,
    workspace_id: str,
) -> WorkspaceProcessLock:
    """Acquire one non-blocking lock without following a hostile registry entry."""

    try:
        if str(uuid.UUID(workspace_id)) != workspace_id:
            raise ValueError
    except ValueError as exc:
        raise WorkspaceLockStorageError from exc
    try:
        mkdir_durable(lock_root)
    except OSError as exc:
        raise WorkspaceLockStorageError from exc
    if not _is_safe_owned_directory(lock_root):
        raise WorkspaceLockStorageError

    name = f"{workspace_id}.lock"
    path = lock_root / name
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    root_descriptor = -1
    descriptor = -1
    try:
        if os.open in os.supports_dir_fd and hasattr(os, "O_DIRECTORY"):
            root_descriptor = os.open(
                lock_root,
                os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
            )
            if not _is_safe_owned_directory(lock_root) or not os.path.samestat(
                os.fstat(root_descriptor),
                lock_root.lstat(),
            ):
                raise WorkspaceLockStorageError
            descriptor = os.open(name, flags, 0o600, dir_fd=root_descriptor)
        else:
            try:
                metadata = path.lstat()
            except FileNotFoundError:
                pass
            else:
                reparse = int(
                    getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
                )
                attributes = int(getattr(metadata, "st_file_attributes", 0))
                if stat.S_ISLNK(metadata.st_mode) or attributes & reparse:
                    raise WorkspaceLockStorageError
            descriptor = os.open(path, flags, 0o600)
    except (OSError, WorkspaceLockStorageError) as exc:
        raise WorkspaceLockStorageError from exc
    finally:
        if root_descriptor >= 0:
            os.close(root_descriptor)

    try:
        if not _is_safe_owned_file(descriptor) or not _descriptor_matches_path(
            descriptor,
            path,
        ):
            raise WorkspaceLockStorageError
        _lock_descriptor(descriptor)
        os.ftruncate(descriptor, 0)
        os.write(descriptor, f"pid={os.getpid()}\n".encode("ascii"))
        os.fsync(descriptor)
        fsync_directory(lock_root)
        return WorkspaceProcessLock(descriptor)
    except WorkspaceLockContendedError:
        os.close(descriptor)
        raise
    except (OSError, WorkspaceLockStorageError) as exc:
        os.close(descriptor)
        raise WorkspaceLockStorageError from exc


__all__ = [
    "WorkspaceLockContendedError",
    "WorkspaceLockStorageError",
    "WorkspaceProcessLock",
    "acquire_workspace_lock",
]
