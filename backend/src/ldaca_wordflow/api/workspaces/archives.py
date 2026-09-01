"""Workspace archive import HTTP adapter."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ...shared.errors import UnsupportedMediaTypeError
from ...models.workspace import WorkspaceResource
from ..dependencies import WorkspaceArchiveServiceDep
from ..security import CurrentSessionSecurityDep
from ..responses import api_errors, route_path, workspace_etag
from ..request_stream import RequestByteStream

router = APIRouter(
    prefix="/workspaces",
    tags=["workspace-archives"],
    responses=api_errors(401),
)
OMITTED_TAB_COUNT_HEADER = "X-Wordflow-Omitted-Tab-Count"
OMITTED_ANALYSIS_COUNT_HEADER = "X-Wordflow-Omitted-Analysis-Count"


@router.post(
    "/imports",
    response_model=WorkspaceResource,
    status_code=status.HTTP_201_CREATED,
    responses={
        **api_errors(400, 403, 409, 413, 415, 422, 507),
        status.HTTP_201_CREATED: {
            "description": "Workspace archive installed",
            "headers": {
                OMITTED_TAB_COUNT_HEADER: {"schema": {"type": "integer"}},
                OMITTED_ANALYSIS_COUNT_HEADER: {"schema": {"type": "integer"}},
            },
        },
    },
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
    principal: CurrentSessionSecurityDep,
    filename: Annotated[str, Query(min_length=1)],
    archive_service: WorkspaceArchiveServiceDep,
) -> WorkspaceResource:
    """Validate, stage, and atomically install one workspace ZIP."""

    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
        != "application/octet-stream"
    ):
        raise UnsupportedMediaTypeError(
            "Workspace imports require application/octet-stream"
        )
    payload, omitted_tab_count, omitted_analysis_count = (
        await archive_service.import_upload(
            principal.user.id,
            filename,
            RequestByteStream(request),
        )
    )
    resource = WorkspaceResource.model_validate(payload)
    response.headers["Location"] = route_path(
        request,
        "get_workspace_by_id",
        workspace_id=resource.id,
    )
    response.headers["ETag"] = workspace_etag(resource.revision)
    response.headers[OMITTED_TAB_COUNT_HEADER] = str(omitted_tab_count)
    response.headers[OMITTED_ANALYSIS_COUNT_HEADER] = str(omitted_analysis_count)
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
            "headers": {
                OMITTED_TAB_COUNT_HEADER: {"schema": {"type": "integer"}},
                OMITTED_ANALYSIS_COUNT_HEADER: {"schema": {"type": "integer"}},
            },
        },
    },
)
async def export_workspace_archive(
    workspace_id: uuid.UUID,
    principal: CurrentSessionSecurityDep,
    archive_service: WorkspaceArchiveServiceDep,
) -> FileResponse:
    """Return a portable ZIP, or a raw archival copy for an incompatible Workspace."""

    (
        snapshot,
        filename,
        revision,
        omitted_tab_count,
        omitted_analysis_count,
    ) = await archive_service.export_archive(principal.user.id, workspace_id)
    headers = {"ETag": workspace_etag(revision)} if revision is not None else {}
    headers[OMITTED_TAB_COUNT_HEADER] = str(omitted_tab_count)
    headers[OMITTED_ANALYSIS_COUNT_HEADER] = str(omitted_analysis_count)
    return FileResponse(
        snapshot.path,
        filename=filename,
        media_type="application/zip",
        headers=headers,
        background=BackgroundTask(snapshot.cleanup),
    )
