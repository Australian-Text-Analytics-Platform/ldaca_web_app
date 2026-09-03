"""Platform-owned application paths and Data Root filesystem validation."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from platformdirs import PlatformDirs

from .infrastructure.storage.durable_fs import (
    atomic_write_json,
    fsync_directory,
    mkdir_durable,
)

APP_IDENTIFIER = "au.edu.ldaca.wordflow"
CONFIG_SCHEMA_VERSION = 1


class DataRootConfigError(ValueError):
    """The platform configuration file is malformed or unsupported."""


@dataclass(frozen=True, slots=True)
class DataRootPaths:
    """Process-local configuration and recommended data locations."""

    config_file: Path
    suggested_data_root: Path


def platform_data_root_paths() -> DataRootPaths:
    """Resolve non-roaming per-user paths through operating-system conventions."""

    directories = PlatformDirs(APP_IDENTIFIER, appauthor=False, roaming=False)
    return DataRootPaths(
        config_file=directories.user_config_path / "settings.json",
        suggested_data_root=directories.user_data_path / "data",
    )


def platform_cache_root() -> Path:
    """Resolve the disposable per-user cache through operating-system conventions."""

    return PlatformDirs(
        APP_IDENTIFIER,
        appauthor=False,
        roaming=False,
    ).user_cache_path


class DataRootConfigStore:
    """Read and atomically replace the one versioned Data Root setting."""

    def __init__(self, paths: DataRootPaths | None = None) -> None:
        self.paths = paths or platform_data_root_paths()

    def read(self) -> Path | None:
        """Return the configured absolute path without touching that directory."""

        path = self.paths.config_file
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise DataRootConfigError("Data Root configuration is unreadable") from exc
        if not isinstance(payload, dict) or payload.get("schema_version") != 1:
            raise DataRootConfigError("Data Root configuration schema is unsupported")
        raw_root = payload.get("data_root")
        if not isinstance(raw_root, str) or not raw_root.strip():
            raise DataRootConfigError("Data Root configuration has no path")
        root = Path(raw_root)
        if not root.is_absolute():
            raise DataRootConfigError("Configured Data Root must be absolute")
        return root.expanduser().resolve(strict=False)

    def write(self, data_root: Path) -> None:
        """Persist one canonical absolute root with a crash-safe replacement."""

        atomic_write_json(
            self.paths.config_file,
            {
                "schema_version": CONFIG_SCHEMA_VERSION,
                "data_root": str(data_root),
            },
        )
        if os.name != "nt":
            self.paths.config_file.chmod(0o600)


def probe_data_root(candidate: Path) -> Path:
    """Create, canonicalize, and prove read/write/delete access to a directory."""

    if not candidate.is_absolute():
        raise ValueError("Data Root must be an absolute path")
    mkdir_durable(candidate)
    canonical = candidate.resolve(strict=True)
    if not canonical.is_dir():
        raise ValueError("Data Root must be a directory")
    descriptor, raw_probe = tempfile.mkstemp(prefix=".wordflow-probe.", dir=canonical)
    probe = Path(raw_probe)
    try:
        with os.fdopen(descriptor, "w+b") as handle:
            handle.write(b"wordflow")
            handle.flush()
            os.fsync(handle.fileno())
            handle.seek(0)
            if handle.read() != b"wordflow":
                raise OSError("Data Root probe could not be read back")
    finally:
        probe.unlink(missing_ok=True)
        fsync_directory(canonical)
    return canonical


__all__ = [
    "APP_IDENTIFIER",
    "DataRootConfigError",
    "DataRootConfigStore",
    "DataRootPaths",
    "platform_cache_root",
    "platform_data_root_paths",
    "probe_data_root",
]
