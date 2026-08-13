from __future__ import annotations

import os
from pathlib import Path

from ldaca_wordflow.infrastructure.storage import durable_fs


def test_fsync_file_uses_a_writable_descriptor(
    tmp_path: Path,
    monkeypatch,
) -> None:
    target = tmp_path / "record.json"
    target.write_bytes(b"record")
    real_fsync = os.fsync

    def windows_compatible_fsync(descriptor: int) -> None:
        os.write(descriptor, b"")
        real_fsync(descriptor)

    monkeypatch.setattr(durable_fs.os, "fsync", windows_compatible_fsync)

    durable_fs.fsync_file(target)

    assert target.read_bytes() == b"record"


def test_fsync_directory_skips_hosts_without_directory_descriptors(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(durable_fs, "_O_DIRECTORY", 0)

    def unexpected_open(*_args, **_kwargs):
        raise AssertionError("directory descriptor should not be opened")

    monkeypatch.setattr(durable_fs.os, "open", unexpected_open)

    durable_fs.fsync_directory(tmp_path)
