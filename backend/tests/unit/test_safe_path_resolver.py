"""Security contract for user-controlled paths resolved by storage services."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from ldaca_wordflow.services import safe_paths as safe_paths_module
from ldaca_wordflow.shared.errors import UnsafePathError
from ldaca_wordflow.services.safe_paths import SafePathResolver


@pytest.mark.parametrize(
    "candidate",
    [
        "/etc/passwd",
        "../outside.csv",
        "nested/../../outside.csv",
        r"C:\\Windows\\system32\\config",
        r"C:relative-on-drive",
        r"\\\\server\\share\\file.csv",
        "nested\\file.csv",
        "CON.txt",
        "nested/name.",
        "nested/bad:name.csv",
        "nested/e\u0301.csv",
        " leading.csv",
    ],
)
def test_resolver_rejects_non_portable_or_escaping_paths(
    tmp_path: Path,
    candidate: str,
) -> None:
    resolver = SafePathResolver(tmp_path)

    with pytest.raises(UnsafePathError):
        resolver.resolve(candidate)


def test_resolver_rejects_symlink_components(tmp_path: Path) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    link = tmp_path / "linked"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except NotImplementedError, OSError:
        pytest.skip("symlinks are unavailable on this platform")

    with pytest.raises(UnsafePathError):
        SafePathResolver(tmp_path).resolve("linked/escape.csv")


def test_resolver_rechecks_parent_before_final_write(tmp_path: Path) -> None:
    destination_parent = tmp_path / "incoming"
    destination_parent.mkdir()
    resolver = SafePathResolver(tmp_path)
    destination = resolver.resolve("incoming/data.csv")

    destination_parent.rmdir()
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir(exist_ok=True)
    try:
        destination_parent.symlink_to(outside, target_is_directory=True)
    except NotImplementedError, OSError:
        pytest.skip("symlinks are unavailable on this platform")

    with pytest.raises(UnsafePathError):
        resolver.recheck_for_write(destination)


def test_open_new_file_uses_no_follow_and_never_overwrites(tmp_path: Path) -> None:
    resolver = SafePathResolver(tmp_path)
    destination = resolver.resolve("new.csv")

    descriptor = resolver.open_new_file(destination)
    os.write(descriptor, b"value\n")
    os.close(descriptor)

    with pytest.raises(FileExistsError):
        resolver.open_new_file(destination)


def test_create_directory_falls_back_without_directory_descriptors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolver = SafePathResolver(tmp_path)
    destination = resolver.resolve("created")
    real_open = os.open

    def reject_directory_open(path, flags, *args, **kwargs):
        if Path(path).is_dir():
            raise AssertionError("directory descriptor is unavailable")
        return real_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(safe_paths_module, "_O_DIRECTORY", 0)
    monkeypatch.setattr(safe_paths_module.os, "supports_dir_fd", set())
    monkeypatch.setattr(safe_paths_module.os, "open", reject_directory_open)

    resolver.create_directory(destination)

    assert destination.is_dir()


def test_move_file_falls_back_across_directories_without_directory_descriptors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_parent = tmp_path / "incoming"
    destination_parent = tmp_path / "archive"
    source_parent.mkdir()
    destination_parent.mkdir()
    source = source_parent / "data.csv"
    source.write_text("value\n", encoding="utf-8")
    destination = destination_parent / source.name
    resolver = SafePathResolver(tmp_path)

    monkeypatch.setattr(safe_paths_module.os, "supports_dir_fd", set())

    resolver.move_file(source, destination)

    assert not source.exists()
    assert destination.read_text(encoding="utf-8") == "value\n"


def test_resolver_rejects_existing_case_or_unicode_collisions(tmp_path: Path) -> None:
    (tmp_path / "Report.csv").write_text("value\n")
    resolver = SafePathResolver(tmp_path)

    with pytest.raises(UnsafePathError, match="collides"):
        resolver.resolve("report.csv")
