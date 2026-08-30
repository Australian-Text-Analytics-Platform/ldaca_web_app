"""Reusable FastAPI dependency annotations for runtime-owned services."""

from typing import Annotated

from fastapi import Depends

from ..runtime import (
    Runtime,
    RuntimeManager,
    get_runtime,
    get_runtime_manager,
    get_workspace_archive_service,
    get_workspace_service,
)
from ..services.workspace import WorkspaceService
from ..services.workspace_archives import WorkspaceArchiveService

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
RuntimeManagerDep = Annotated[RuntimeManager, Depends(get_runtime_manager)]
WorkspaceServiceDep = Annotated[WorkspaceService, Depends(get_workspace_service)]
WorkspaceArchiveServiceDep = Annotated[
    WorkspaceArchiveService,
    Depends(get_workspace_archive_service),
]

__all__ = [
    "RuntimeDep",
    "RuntimeManagerDep",
    "WorkspaceArchiveServiceDep",
    "WorkspaceServiceDep",
]
