"""Safe relative-path resolution for filesystem-backed backend services.

Used by:
- ``UserFileStore`` and ``WorkspaceArchiveService`` before every filesystem
  boundary influenced by a client-controlled name.

Flow:
- Parse only portable relative path components, reject traversal and Windows
  drive/UNC forms even on POSIX, verify lexical and resolved containment, and
  reject symlink or reparse-point components.
- Immediately before a final write, repeat the component and containment checks
  so a path validated earlier cannot silently follow a replaced parent.
- Open newly created files with exclusive and no-follow flags where the host
  exposes them.
"""

from __future__ import annotations

import os
import secrets
import stat
from contextlib import contextmanager
from collections.abc import Iterable, Iterator
from pathlib import Path

from ...shared.errors import UnsafePathError
from ...shared.portable_names import (
    MAX_PORTABLE_COMPONENT_BYTES,
    MAX_RELATIVE_PATH_BYTES,
    MAX_RELATIVE_PATH_DEPTH,
    portable_collision_key,
    portable_relative_path_parts,
)

_O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)


def is_link_or_reparse(metadata: os.stat_result) -> bool:
    """Return whether one no-follow stat identifies an unsafe link-like entry."""

    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    file_attributes = getattr(metadata, "st_file_attributes", 0)
    return stat.S_ISLNK(metadata.st_mode) or bool(
        reparse_flag and file_attributes & reparse_flag
    )


def is_real_directory(path: Path) -> bool:
    """Return whether one path currently names a no-follow directory."""

    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return False
    return not is_link_or_reparse(metadata) and stat.S_ISDIR(metadata.st_mode)


def is_real_file(path: Path) -> bool:
    """Return whether one path currently names a no-follow regular file."""

    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return False
    return not is_link_or_reparse(metadata) and stat.S_ISREG(metadata.st_mode)


def logical_tree_usage(
    roots: Iterable[str | Path],
    byte_limit: int,
    file_limit: int,
) -> tuple[int, int]:
    """Count private regular-file ``st_size`` without following special entries.

    The scan stops as soon as either caller-owned limit is exceeded. Directory
    entries are also bounded so a child cannot evade supervision with an
    arbitrarily wide tree containing few regular files.
    """

    if byte_limit < 0 or file_limit < 0:
        raise ValueError("Logical tree limits cannot be negative")
    total_bytes = 0
    total_files = 0
    visited_entries = 0
    entry_limit = max(1, file_limit * 8)
    seen: set[Path] = set()
    for raw_root in roots:
        root = Path(raw_root)
        if not is_real_directory(root):
            continue
        for current_root, directory_names, file_names in os.walk(
            root,
            topdown=True,
            followlinks=False,
        ):
            current = Path(current_root)
            safe_directories: list[str] = []
            for name in directory_names:
                candidate = current / name
                visited_entries += 1
                if visited_entries > entry_limit:
                    return total_bytes, file_limit + 1
                if is_real_directory(candidate):
                    safe_directories.append(name)
            directory_names[:] = safe_directories
            for name in file_names:
                candidate = current / name
                visited_entries += 1
                if visited_entries > entry_limit:
                    return total_bytes, file_limit + 1
                try:
                    metadata = candidate.lstat()
                    resolved = candidate.resolve(strict=True)
                except FileNotFoundError:
                    continue
                if (
                    is_link_or_reparse(metadata)
                    or not stat.S_ISREG(metadata.st_mode)
                    or resolved in seen
                ):
                    continue
                seen.add(resolved)
                total_bytes += metadata.st_size
                total_files += 1
                if total_bytes > byte_limit or total_files > file_limit:
                    return total_bytes, total_files
    return total_bytes, total_files


class SafePathResolver:
    """Resolve untrusted relative paths beneath one canonical storage root.

    The resolver deliberately rejects backslashes instead of interpreting them
    as ordinary POSIX filename characters. This gives hosted and desktop builds
    the same path contract and prevents an archive or API path accepted on one
    platform from becoming a drive or directory escape on another.
    """

    def __init__(self, root: Path) -> None:
        root.mkdir(parents=True, exist_ok=True)
        self.root = root.resolve(strict=True)
        self._reject_special_component(self.root)

    def resolve(
        self,
        relative_path: str,
        *,
        allow_root: bool = False,
    ) -> Path:
        """Return a contained path after portable syntax and link checks.

        Used by:
        - storage-service reads, moves, deletes, uploads, and archive member
          extraction.
        """

        parts = self._portable_parts(relative_path, allow_root=allow_root)
        candidate = self.root.joinpath(*parts)
        self._assert_lexically_contained(candidate)
        self._check_existing_components(candidate)
        self._check_portable_collisions(parts)
        self._assert_resolved_containment(candidate)
        return candidate

    def recheck_for_write(self, destination: Path) -> Path:
        """Revalidate a previously resolved destination immediately before I/O."""

        self._assert_lexically_contained(destination)
        self._check_existing_components(destination)
        relative = destination.relative_to(self.root)
        self._check_portable_collisions(relative.parts)
        self._assert_resolved_containment(destination)
        parent = destination.parent
        if not parent.exists() or not parent.is_dir():
            raise UnsafePathError("Destination folder is not available")
        return destination

    def open_new_file(self, destination: Path, *, mode: int = 0o600) -> int:
        """Exclusively open a new file without following a final symlink.

        Called by:
        - archive extraction when materialising validated members.
        """

        checked = self.recheck_for_write(destination)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_NOFOLLOW", 0)
        if os.open in os.supports_dir_fd and _O_DIRECTORY:
            return self._open_new_file_dirfd(checked, flags, mode)
        return os.open(checked, flags, mode)

    def _open_new_file_dirfd(self, destination: Path, flags: int, mode: int) -> int:
        """Traverse parents by descriptor so symlink swaps cannot retarget open."""

        relative = destination.relative_to(self.root)
        root_flags = os.O_RDONLY | _O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
        descriptors: list[int] = []
        try:
            current = os.open(self.root, root_flags)
            descriptors.append(current)
            for part in relative.parts[:-1]:
                current = os.open(
                    part,
                    root_flags,
                    dir_fd=current,
                )
                descriptors.append(current)
            return os.open(
                relative.parts[-1],
                flags,
                mode,
                dir_fd=current,
            )
        except FileExistsError:
            raise
        except OSError as exc:
            raise UnsafePathError("Destination folder is not available") from exc
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)

    def create_directory(self, destination: Path, *, mode: int = 0o700) -> None:
        """Create one directory relative to a no-follow parent descriptor."""

        checked = self.recheck_for_write(destination)
        if os.mkdir in os.supports_dir_fd:
            with self._parent_descriptor(checked) as (parent, name):
                os.mkdir(name, mode=mode, dir_fd=parent)
                os.fsync(parent)
            return
        checked.mkdir(mode=mode, exist_ok=False)
        self._fsync_path(checked.parent)

    def create_temporary_file(self, destination: Path) -> tuple[int, Path]:
        """Create an exclusive upload temporary beside a verified destination."""

        checked = self.recheck_for_write(destination)
        if os.open in os.supports_dir_fd:
            with self._parent_descriptor(checked) as (parent, _name):
                for _ in range(128):
                    temporary_name = f".{checked.name}.{secrets.token_hex(16)}.upload"
                    try:
                        descriptor = os.open(
                            temporary_name,
                            os.O_WRONLY
                            | os.O_CREAT
                            | os.O_EXCL
                            | getattr(os, "O_NOFOLLOW", 0),
                            0o600,
                            dir_fd=parent,
                        )
                    except FileExistsError:
                        continue
                    return descriptor, checked.parent / temporary_name
            raise UnsafePathError("Unable to allocate upload temporary file")
        import tempfile

        descriptor, raw_path = tempfile.mkstemp(
            prefix=f".{checked.name}.", suffix=".upload", dir=checked.parent
        )
        return descriptor, Path(raw_path)

    def publish_file(self, source: Path, destination: Path) -> None:
        """Publish a same-directory temporary without overwriting a destination."""

        source_checked = self.recheck_for_write(source)
        destination_checked = self.recheck_for_write(destination)
        if source_checked.parent != destination_checked.parent:
            raise UnsafePathError("Temporary file is not beside its destination")
        if os.link in os.supports_dir_fd and os.unlink in os.supports_dir_fd:
            with self._parent_descriptor(destination_checked) as (parent, name):
                os.link(
                    source_checked.name,
                    name,
                    src_dir_fd=parent,
                    dst_dir_fd=parent,
                    follow_symlinks=False,
                )
                try:
                    os.unlink(source_checked.name, dir_fd=parent)
                except BaseException:
                    os.unlink(name, dir_fd=parent)
                    raise
                os.fsync(parent)
            return
        if destination_checked.exists():
            raise FileExistsError(destination_checked)
        os.link(source_checked, destination_checked, follow_symlinks=False)
        source_checked.unlink()
        self._fsync_path(destination_checked.parent)

    def move_file(self, source: Path, destination: Path) -> None:
        """Move one regular file through verified source and target descriptors."""

        source_checked = self.recheck_for_write(source)
        destination_checked = self.recheck_for_write(destination)
        if os.link in os.supports_dir_fd and os.unlink in os.supports_dir_fd:
            with self._parent_descriptor(source_checked) as (
                source_parent,
                source_name,
            ):
                with self._parent_descriptor(destination_checked) as (
                    destination_parent,
                    destination_name,
                ):
                    metadata = os.stat(
                        source_name, dir_fd=source_parent, follow_symlinks=False
                    )
                    if not stat.S_ISREG(metadata.st_mode):
                        raise UnsafePathError("Source is not a regular file")
                    os.link(
                        source_name,
                        destination_name,
                        src_dir_fd=source_parent,
                        dst_dir_fd=destination_parent,
                        follow_symlinks=False,
                    )
                    try:
                        os.unlink(source_name, dir_fd=source_parent)
                    except BaseException:
                        os.unlink(destination_name, dir_fd=destination_parent)
                        raise
                    os.fsync(destination_parent)
                    if source_parent != destination_parent:
                        os.fsync(source_parent)
            return
        if destination_checked.exists():
            raise FileExistsError(destination_checked)
        os.link(source_checked, destination_checked, follow_symlinks=False)
        try:
            source_checked.unlink()
        except BaseException:
            destination_checked.unlink()
            raise
        self._fsync_path(destination_checked.parent)
        if source_checked.parent != destination_checked.parent:
            self._fsync_path(source_checked.parent)

    def delete(self, target: Path) -> None:
        """Delete one file or tree without following swapped directory entries."""

        checked = self.recheck_for_write(target)
        if os.open in os.supports_dir_fd and os.unlink in os.supports_dir_fd:
            with self._parent_descriptor(checked) as (parent, name):
                metadata = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if stat.S_ISDIR(metadata.st_mode):
                    directory = os.open(
                        name,
                        os.O_RDONLY | _O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                        dir_fd=parent,
                    )
                    try:
                        self._delete_directory_contents(directory)
                    finally:
                        os.close(directory)
                    os.rmdir(name, dir_fd=parent)
                elif stat.S_ISREG(metadata.st_mode):
                    os.unlink(name, dir_fd=parent)
                else:
                    raise UnsafePathError("File resource has an unsupported type")
                os.fsync(parent)
            return
        if checked.is_dir():
            import shutil

            shutil.rmtree(checked)
        else:
            checked.unlink()
        self._fsync_path(checked.parent)

    def _delete_directory_contents(self, descriptor: int) -> None:
        for name in os.listdir(descriptor):
            metadata = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            if stat.S_ISDIR(metadata.st_mode):
                child = os.open(
                    name,
                    os.O_RDONLY | _O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=descriptor,
                )
                try:
                    self._delete_directory_contents(child)
                finally:
                    os.close(child)
                os.rmdir(name, dir_fd=descriptor)
            elif stat.S_ISREG(metadata.st_mode):
                os.unlink(name, dir_fd=descriptor)
            else:
                raise UnsafePathError("File resource has an unsupported type")

    @contextmanager
    def _parent_descriptor(self, destination: Path) -> Iterator[tuple[int, str]]:
        """Yield the verified parent descriptor and final component."""

        relative = destination.relative_to(self.root)
        flags = os.O_RDONLY | _O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
        descriptors: list[int] = []
        try:
            try:
                current = os.open(self.root, flags)
                descriptors.append(current)
                for part in relative.parts[:-1]:
                    current = os.open(part, flags, dir_fd=current)
                    descriptors.append(current)
            except OSError as exc:
                raise UnsafePathError("Destination folder is not available") from exc
            yield current, relative.parts[-1]
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)

    @staticmethod
    def _fsync_path(directory: Path) -> None:
        if not _O_DIRECTORY:
            return
        descriptor = os.open(directory, os.O_RDONLY | _O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @staticmethod
    def _portable_parts(relative_path: str, *, allow_root: bool) -> tuple[str, ...]:
        try:
            return portable_relative_path_parts(
                relative_path,
                allow_root=allow_root,
            )
        except ValueError as exc:
            raise UnsafePathError("Invalid file path") from exc

    def _check_portable_collisions(self, parts: tuple[str, ...]) -> None:
        """Reject names that alias an existing sibling by Unicode/case rules."""

        current = self.root
        for part in parts:
            if current.is_dir():
                key = portable_collision_key(part)
                try:
                    siblings = current.iterdir()
                    if any(
                        portable_collision_key(entry.name) == key and entry.name != part
                        for entry in siblings
                    ):
                        raise UnsafePathError(
                            "File path collides with an existing name"
                        )
                except OSError as exc:
                    raise UnsafePathError("File path is not available") from exc
            current = current / part

    def _assert_lexically_contained(self, candidate: Path) -> None:
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise UnsafePathError("Invalid file path") from exc

    def _assert_resolved_containment(self, candidate: Path) -> None:
        try:
            candidate.resolve(strict=False).relative_to(self.root)
        except (OSError, RuntimeError, ValueError) as exc:
            raise UnsafePathError("Invalid file path") from exc

    def _check_existing_components(self, candidate: Path) -> None:
        try:
            relative = candidate.relative_to(self.root)
        except ValueError as exc:
            raise UnsafePathError("Invalid file path") from exc

        current = self.root
        for part in relative.parts:
            current = current / part
            try:
                self._reject_special_component(current)
            except FileNotFoundError:
                break

    @staticmethod
    def _reject_special_component(path: Path) -> None:
        metadata = path.lstat()
        if is_link_or_reparse(metadata):
            raise UnsafePathError("Path contains a link or reparse point")


__all__ = [
    "MAX_PORTABLE_COMPONENT_BYTES",
    "MAX_RELATIVE_PATH_BYTES",
    "MAX_RELATIVE_PATH_DEPTH",
    "SafePathResolver",
    "is_link_or_reparse",
    "is_real_directory",
    "is_real_file",
    "logical_tree_usage",
]
