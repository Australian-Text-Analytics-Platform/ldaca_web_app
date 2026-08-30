"""Typed runtime dependencies for User File route adapters."""

from typing import Annotated

from fastapi import Depends

from ...services.user_files import UserFileStore
from ..dependencies import RuntimeDep


def get_user_file_store(
    runtime: RuntimeDep,
) -> UserFileStore:
    """Return the current application's configured user-file service."""

    return runtime.user_file_store


UserFileStoreDep = Annotated[UserFileStore, Depends(get_user_file_store)]

__all__ = ["UserFileStoreDep"]
