"""Shared bounded names for state that crosses persistence boundaries."""

from typing import Annotated

from pydantic import AfterValidator, StringConstraints


def _validate_node_name(value: str) -> str:
    """Apply the one invariant used by HTTP, Analysis, and archive Node state."""

    if ".." in value:
        raise ValueError("Node name cannot contain '..'")
    if "/" in value or "\\" in value:
        raise ValueError("Node name cannot contain path separators")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Node name cannot contain control characters")
    return value


NodeName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=500),
    AfterValidator(_validate_node_name),
]
"""Canonical Node display name accepted by requests, Analyses, and archives."""


__all__ = ["NodeName"]
