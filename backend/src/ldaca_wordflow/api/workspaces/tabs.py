"""Strict Workspace-owned Tab collection and resource routes."""

from __future__ import annotations

import uuid
from fastapi import APIRouter, Request, Response, status

from ...domain.workspace import Tab
from ...models.tabs import TabCreate, TabUpdate
from ..dependencies import RuntimeDep
from ..responses import api_errors, route_path
from ..security import CurrentSessionSecurityDep

router = APIRouter(
    prefix="/workspaces/{workspace_id}/tabs",
    tags=["tabs"],
    responses=api_errors(401),
)


@router.get(
    "",
    response_model=list[Tab],
    responses=api_errors(403, 404, 409, 422, 500),
)
async def list_tabs(
    workspace_id: uuid.UUID,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> list[Tab]:
    """Return every Tab in immutable creation order."""

    return await runtime.workspace_service.list_tabs(
        principal.user.id,
        str(workspace_id),
    )


@router.post(
    "",
    response_model=Tab,
    status_code=status.HTTP_201_CREATED,
    responses=api_errors(403, 404, 409, 422, 500, 507),
)
async def create_tab(
    workspace_id: uuid.UUID,
    body: TabCreate,
    request: Request,
    response: Response,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Tab:
    """Create a durable empty Tab immediately."""

    tab = await runtime.workspace_service.create_tab(
        principal.user.id,
        str(workspace_id),
        body,
    )
    response.headers["Location"] = route_path(
        request,
        "get_tab",
        workspace_id=workspace_id,
        tab_id=tab.id,
    )
    return tab


@router.get(
    "/{tab_id}",
    response_model=Tab,
    responses=api_errors(403, 404, 409, 422, 500),
)
async def get_tab(
    workspace_id: uuid.UUID,
    tab_id: uuid.UUID,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Tab:
    """Read one Tab by its sole UUID identity."""

    return await runtime.workspace_service.get_tab(
        principal.user.id,
        str(workspace_id),
        str(tab_id),
    )


@router.patch(
    "/{tab_id}",
    response_model=Tab,
    responses=api_errors(403, 404, 409, 422, 500, 507),
)
async def update_tab(
    workspace_id: uuid.UUID,
    tab_id: uuid.UUID,
    body: TabUpdate,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Tab:
    """Update one Tab without changing its immutable function kind."""

    return await runtime.workspace_service.update_tab(
        principal.user.id,
        str(workspace_id),
        str(tab_id),
        body,
    )


@router.delete(
    "/{tab_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(403, 404, 409, 422, 500, 507),
)
async def delete_tab(
    workspace_id: uuid.UUID,
    tab_id: uuid.UUID,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Response:
    """Delete one existing Tab; repeated deletion is ordinary absence."""

    await runtime.analysis_service.delete_tab(
        principal.user.id,
        str(workspace_id),
        str(tab_id),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
