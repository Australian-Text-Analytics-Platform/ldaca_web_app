"""Typed runtime dependencies for User File route adapters."""

from typing import Annotated

from fastapi import Depends

from ...runtime import Runtime, get_runtime
from ...services.user_files import UserFileStore


def get_user_file_store(
    runtime: Annotated[Runtime, Depends(get_runtime)],
) -> UserFileStore:
    """Return the current application's configured user-file service."""

    return runtime.user_file_store
