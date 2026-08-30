"""Canonical Workspace metadata and explicit open-state routes."""

from __future__ import annotations

import uuid
from dataclasses import asdict

from fastapi import APIRouter, Request, Response, status

from ...models.workspace import (
    AvailableWorkspaceListItem,
    UnavailableWorkspaceListItem,
    WorkspaceCreateRequest,
    WorkspaceListItem,
    WorkspaceNodeReorderRequest,
    WorkspaceResource,
    WorkspaceUpdateRequest,
)
from ...services.workspace import (
    UnavailableWorkspaceRecord,
    WorkspaceRecord,
)
from ..dependencies import RuntimeDep, WorkspaceServiceDep
from ..responses import api_errors, route_path, workspace_etag
from ..security import CurrentUserDep

router = APIRouter(
    prefix="/workspaces",
    tags=["workspaces"],
    responses=api_errors(401),
)


def _resource(record: WorkspaceRecord) -> WorkspaceResource:
    return WorkspaceResource.model_validate(asdict(record))


def _list_item(record: WorkspaceRecord | UnavailableWorkspaceRecord) -> WorkspaceListItem:
    if isinstance(record, WorkspaceRecord):
        return AvailableWorkspaceListItem.model_validate(asdict(record))
    return UnavailableWorkspaceListItem.model_validate(asdict(record))


@router.get("", response_model=list[WorkspaceListItem])
async def list_workspaces(
    current_user: CurrentUserDep,
    workspace_service: WorkspaceServiceDep,
) -> list[WorkspaceListItem]:
    """List fresh persisted metadata without opening any Workspace."""

    records = await workspace_service.list_workspaces(current_user.id)
    return [_list_item(record) for record in records]


@router.post(
    "",
    response_model=WorkspaceResource,
    status_code=status.HTTP_201_CREATED,
    responses=api_errors(400, 403, 409, 422, 507),
)
async def create_workspace(
    request: WorkspaceCreateRequest,
    http_request: Request,
    response: Response,
    current_user: CurrentUserDep,
    workspace_service: WorkspaceServiceDep,
) -> WorkspaceResource:
    """Create one durable closed Workspace."""

    record = await workspace_service.create_workspace(
        current_user.id,
        request.name,
        request.description or "",
    )
    response.headers["Location"] = route_path(
        http_request,
        "get_workspace_by_id",
        workspace_id=record.id,
    )
    response.headers["ETag"] = workspace_etag(record.revision)
    return _resource(record)


@router.get(
    "/{workspace_id}",
    response_model=WorkspaceResource,
    responses=api_errors(404, 422),
)
async def get_workspace_by_id(
    workspace_id: uuid.UUID,
    response: Response,
    current_user: CurrentUserDep,
    workspace_service: WorkspaceServiceDep,
) -> WorkspaceResource:
    """Read the same lightweight resource returned by the collection."""

    record = await workspace_service.get_workspace(
        current_user.id,
        workspace_id,
    )
    response.headers["ETag"] = workspace_etag(record.revision)
    return _resource(record)


@router.put(
    "/{workspace_id}/open",
    response_model=WorkspaceResource,
    responses=api_errors(403, 404, 409, 422, 503),
)
async def open_workspace_by_id(
    workspace_id: uuid.UUID,
    response: Response,
    current_user: CurrentUserDep,
    runtime: RuntimeDep,
) -> WorkspaceResource:
    """Make one Workspace the user's sole open process-local aggregate."""

    record = await runtime.workspace_lifecycle_service.open(
        current_user.id,
        workspace_id,
    )
    response.headers["ETag"] = workspace_etag(record.revision)
    return _resource(record)


@router.delete(
    "/{workspace_id}/open",
    response_model=WorkspaceResource,
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        **api_errors(403, 404, 409, 422),
        status.HTTP_204_NO_CONTENT: {"description": "Workspace is closed"},
    },
)
async def close_workspace_by_id(
    workspace_id: uuid.UUID,
    current_user: CurrentUserDep,
    runtime: RuntimeDep,
) -> WorkspaceResource | Response:
    """Close immediately or report that admitted work is still draining."""

    record = await runtime.workspace_lifecycle_service.request_close(
        current_user.id,
        workspace_id,
    )
    if record is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return _resource(record)


@router.patch(
    "/{workspace_id}",
    response_model=WorkspaceResource,
    responses=api_errors(400, 403, 404, 409, 422, 507),
)
async def update_workspace_by_id(
    workspace_id: uuid.UUID,
    request: WorkspaceUpdateRequest,
    response: Response,
    current_user: CurrentUserDep,
    workspace_service: WorkspaceServiceDep,
) -> WorkspaceResource:
    """Apply one narrow metadata command to the current open aggregate."""

    record = await workspace_service.update_metadata(
        current_user.id,
        workspace_id,
        request,
    )
    response.headers["ETag"] = workspace_etag(record.revision)
    return _resource(record)


@router.put(
    "/{workspace_id}/nodes/order",
    response_model=WorkspaceResource,
    responses=api_errors(400, 403, 404, 409, 422, 507),
)
async def reorder_workspace_nodes_by_id(
    workspace_id: uuid.UUID,
    request: WorkspaceNodeReorderRequest,
    response: Response,
    current_user: CurrentUserDep,
    workspace_service: WorkspaceServiceDep,
) -> WorkspaceResource:
    """Persist one exact Data Block order under the Workspace gate."""

    record = await workspace_service.reorder_nodes(
        current_user.id,
        workspace_id,
        request,
    )
    response.headers["ETag"] = workspace_etag(record.revision)
    return _resource(record)


@router.delete(
    "/{workspace_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(403, 404, 409, 422),
)
async def delete_workspace_by_id(
    workspace_id: uuid.UUID,
    current_user: CurrentUserDep,
    runtime: RuntimeDep,
) -> Response:
    """Atomically remove a Workspace and return an empty body."""

    await runtime.workspace_lifecycle_service.delete(
        current_user.id,
        workspace_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
