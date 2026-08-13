"""Thin direct-resource adapters for runtime-owned user file storage."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, Security, status

from ...models.files import (
    CreateFolderRequest,
    FileResource,
    MoveFileRequest,
)
from ...services.sessions import SessionPrincipal
from ...services.user_files import UserFileStore
from ...shared.errors import UnsupportedMediaTypeError
from ..request_stream import RequestByteStream
from ..responses import api_errors, route_path_with_query
from ..security import get_current_session
from .dependencies import get_user_file_store

router = APIRouter()


@router.get(
    "",
    response_model=list[FileResource],
    responses=api_errors(403, 413, 422),
)
async def list_user_files(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    file_store: UserFileStore = Depends(get_user_file_store),
) -> list[FileResource]:
    """Return the complete deterministic User File tree."""

    return [
        FileResource.model_validate(resource)
        for resource in await file_store.list_tree(principal.user.id)
    ]


@router.get(
    "/resource",
    response_model=FileResource,
    responses=api_errors(400, 403, 404, 422),
)
async def get_user_file_resource(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    path: Annotated[str, Query(min_length=1)],
    file_store: UserFileStore = Depends(get_user_file_store),
) -> FileResource:
    """Return one direct file-or-directory resource."""

    return FileResource.model_validate(
        await file_store.resource(principal.user.id, path)
    )


@router.post(
    "/folders",
    response_model=FileResource,
    status_code=status.HTTP_201_CREATED,
    responses=api_errors(400, 403, 404, 409, 422, 507),
)
async def create_folder(
    request: CreateFolderRequest,
    http_request: Request,
    response: Response,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    file_store: UserFileStore = Depends(get_user_file_store),
) -> FileResource:
    """Create one addressable directory and return its direct resource."""

    resource = FileResource.model_validate(
        await file_store.create_folder(
            principal.user.id,
            name=request.name,
            parent_path=request.parent_path,
        )
    )
    response.headers["Location"] = route_path_with_query(
        http_request,
        "get_user_file_resource",
        path=resource.path,
    )
    return resource


@router.patch(
    "",
    response_model=FileResource,
    responses=api_errors(400, 403, 404, 409, 422),
)
async def move_file(
    request: MoveFileRequest,
    http_request: Request,
    response: Response,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    file_store: UserFileStore = Depends(get_user_file_store),
) -> FileResource:
    """Move one existing file without replacement."""

    resource = FileResource.model_validate(
        await file_store.move(
            principal.user.id,
            source_path=request.source_path,
            target_directory_path=request.target_directory_path,
        )
    )
    response.headers["Location"] = route_path_with_query(
        http_request,
        "get_user_file_resource",
        path=resource.path,
    )
    return resource


@router.post(
    "/uploads",
    response_model=FileResource,
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
async def upload_file(
    request: Request,
    response: Response,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    path: Annotated[str, Query(min_length=1)],
    file_store: UserFileStore = Depends(get_user_file_store),
) -> FileResource:
    """Admit and stream one raw body before any framework multipart spooling."""

    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
        != "application/octet-stream"
    ):
        raise UnsupportedMediaTypeError("File uploads require application/octet-stream")
    stored = await file_store.upload(
        principal.user.id,
        path,
        RequestByteStream(request),
    )
    resource = FileResource.model_validate(stored)
    response.headers["Location"] = route_path_with_query(
        request,
        "get_user_file_resource",
        path=resource.path,
    )
    return resource


@router.delete(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(400, 403, 404, 422),
)
async def delete_file(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    path: str = Query(..., description="Path relative to the user's data directory"),
    file_store: UserFileStore = Depends(get_user_file_store),
) -> Response:
    """Delete one file/directory and return an empty body."""

    await file_store.delete(principal.user.id, path)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
