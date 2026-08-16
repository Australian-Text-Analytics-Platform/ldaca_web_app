"""Workspace archive import HTTP adapter."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, Security, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ...shared.errors import UnsupportedMediaTypeError
from ...services.workspace_archives import WorkspaceArchiveService
from ...models.workspace import WorkspaceResource
from ...runtime import get_workspace_archive_service
from ...services.sessions import SessionPrincipal
from ..security import get_current_session
from ..responses import api_errors, route_path, workspace_etag
from ..request_stream import RequestByteStream

router = APIRouter(
    prefix="/workspaces",
    tags=["workspace-archives"],
    responses=api_errors(401),
)


@router.post(
    "/imports",
    response_model=WorkspaceResource,
    status_code=status.HTTP_201_CREATED,
    responses=api_errors(400, 403, 409, 413, 415, 422, 507),
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
        }
    },
)
async def import_workspace_archive(
    request: Request,
    response: Response,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    filename: Annotated[str, Query(min_length=1)],
    archive_service: WorkspaceArchiveService = Depends(get_workspace_archive_service),
) -> WorkspaceResource:
    """Validate, stage, and atomically install one workspace ZIP."""

    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
        != "application/octet-stream"
    ):
        raise UnsupportedMediaTypeError(
            "Workspace imports require application/octet-stream"
        )
    payload = await archive_service.import_upload(
        principal.user.id,
        filename,
        RequestByteStream(request),
    )
    resource = WorkspaceResource.model_validate(payload)
    response.headers["Location"] = route_path(
        request,
        "get_workspace_by_id",
        workspace_id=resource.id,
    )
    response.headers["ETag"] = workspace_etag(resource.revision)
    return resource


@router.get(
    "/{workspace_id}/archive",
    response_class=FileResponse,
    responses={
        **api_errors(404, 413, 422, 507),
        status.HTTP_200_OK: {
            "content": {
                "application/zip": {"schema": {"type": "string", "format": "binary"}}
            },
            "description": "Portable Workspace ZIP archive or raw archival copy",
        },
    },
)
async def export_workspace_archive(
    workspace_id: uuid.UUID,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    archive_service: WorkspaceArchiveService = Depends(get_workspace_archive_service),
) -> FileResponse:
    """Return a portable ZIP, or a raw archival copy for an incompatible Workspace."""

    snapshot, filename, revision = await archive_service.export_archive(
        principal.user.id,
        str(workspace_id),
    )
    headers = {"ETag": workspace_etag(revision)} if revision is not None else {}
    return FileResponse(
        snapshot.path,
        filename=filename,
        media_type="application/zip",
        headers=headers,
        background=BackgroundTask(snapshot.cleanup),
    )
