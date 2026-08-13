"""Crash-safe same-filesystem publication primitives.

All backend persistence boundaries use these helpers so directory creation,
file flushing, atomic replacement, and parent-directory flushing have one
platform contract.
"""

from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

_O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)


class AtomicWriteCapacityError(ValueError):
    """Serialized content exceeds a caller-owned persistence budget."""


def fsync_file(path: Path) -> None:
    """Flush one completed file through a Windows-compatible descriptor."""

    descriptor = os.open(path, os.O_WRONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def fsync_directory(path: Path) -> None:
    """Durably record directory-entry changes where the platform supports it."""

    if not _O_DIRECTORY:
        return
    flags = os.O_RDONLY | _O_DIRECTORY
    try:
        descriptor = os.open(path, flags)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def mkdir_durable(path: Path) -> None:
    """Create a directory chain and flush each newly published parent entry."""

    missing: list[Path] = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    path.mkdir(parents=True, exist_ok=True)
    for created in reversed(missing):
        fsync_directory(created.parent)


@contextmanager
def atomic_output_path(target: Path) -> Iterator[Path]:
    """Yield a same-directory temporary path and publish it on clean exit."""

    mkdir_durable(target.parent)
    descriptor, raw_path = tempfile.mkstemp(
        prefix=f".{target.name}.",
        suffix=".tmp",
        dir=target.parent,
    )
    os.close(descriptor)
    temporary = Path(raw_path)
    try:
        yield temporary
        fsync_file(temporary)
        os.replace(temporary, target)
        fsync_directory(target.parent)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def atomic_write_json(
    target: Path,
    payload: Any,
    *,
    max_bytes: int | None = None,
) -> int:
    """Serialize bounded JSON without exposing a truncated destination."""

    content = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if max_bytes is not None and len(content) > max_bytes:
        raise AtomicWriteCapacityError("Serialized JSON exceeds its storage budget")
    with atomic_output_path(target) as temporary:
        temporary.write_bytes(content)
    return len(content)


__all__ = [
    "AtomicWriteCapacityError",
    "atomic_output_path",
    "atomic_write_json",
    "fsync_file",
    "fsync_directory",
    "mkdir_durable",
]
