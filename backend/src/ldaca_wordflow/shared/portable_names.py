"""Cross-platform name and collision rules shared by storage boundaries."""

from __future__ import annotations

import unicodedata
from pathlib import PurePosixPath, PureWindowsPath

MAX_PORTABLE_COMPONENT_BYTES = 255
MAX_RELATIVE_PATH_BYTES = 1024
MAX_RELATIVE_PATH_DEPTH = 32

_WINDOWS_RESERVED_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{index}" for index in range(1, 10)),
    *(f"lpt{index}" for index in range(1, 10)),
}
_PORTABLE_FORBIDDEN_CHARACTERS = frozenset('<>:"/\\|?*')


def portable_name_error(name: str, *, exact: bool) -> str | None:
    """Return why one name is not stable across supported filesystems."""

    normalized = unicodedata.normalize("NFC", name)
    candidate = normalized if exact else normalized.strip()
    if not candidate:
        return "name cannot be empty"
    if exact and (candidate != name or candidate != candidate.strip()):
        return "name must use canonical Unicode and no surrounding whitespace"
    if not exact and candidate != name.strip():
        return "name must use canonical Unicode"
    if candidate.endswith((".", " ")):
        return "name cannot end with a dot or space"
    if any(character in _PORTABLE_FORBIDDEN_CHARACTERS for character in candidate):
        return "name contains a character unsupported by portable storage"
    if any(ord(character) < 32 or ord(character) == 127 for character in candidate):
        return "name cannot contain control characters"
    if ".." in candidate:
        return "name cannot contain '..'"
    if candidate.split(".", 1)[0].casefold() in _WINDOWS_RESERVED_NAMES:
        return "name is reserved by a supported filesystem"
    return None


def portable_collision_key(name: str) -> str:
    """Return the cross-platform Unicode/case identity of a path component."""

    return unicodedata.normalize("NFC", name).casefold()


def portable_relative_path_parts(
    value: str,
    *,
    allow_root: bool = False,
) -> tuple[str, ...]:
    """Return canonical portable components or raise ``ValueError``.

    Used by public paths, ZIP members, and remote sample manifests so every
    storage producer has the same separator, depth, component, and byte limits.
    """

    if not isinstance(value, str) or "\x00" in value or "\\" in value:
        raise ValueError("Path is not portable")
    windows = PureWindowsPath(value)
    posix = PurePosixPath(value)
    if windows.drive or windows.root or posix.is_absolute():
        raise ValueError("Path is not relative")
    parts = posix.parts
    if not parts:
        if allow_root and value.strip() in {"", "."}:
            return ()
        raise ValueError("Path is empty")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("Path contains traversal")
    if len(parts) > MAX_RELATIVE_PATH_DEPTH:
        raise ValueError("Path has too many components")
    if len(posix.as_posix().encode("utf-8")) > MAX_RELATIVE_PATH_BYTES:
        raise ValueError("Path is too long")
    if any(len(part.encode("utf-8")) > MAX_PORTABLE_COMPONENT_BYTES for part in parts):
        raise ValueError("Path component is too long")
    if any(portable_name_error(part, exact=True) is not None for part in parts):
        raise ValueError("Path component is not portable")
    return parts


__all__ = [
    "MAX_PORTABLE_COMPONENT_BYTES",
    "MAX_RELATIVE_PATH_BYTES",
    "MAX_RELATIVE_PATH_DEPTH",
    "portable_collision_key",
    "portable_name_error",
    "portable_relative_path_parts",
]
