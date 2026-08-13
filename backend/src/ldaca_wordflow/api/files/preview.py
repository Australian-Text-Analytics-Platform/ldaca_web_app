"""Thin HTTP adapters for safe, bounded file reads."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Security
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask

from ...models.files import FileWorksheetsResource
from ...runtime import Runtime, get_runtime
from ...services.sessions import SessionPrincipal
from ...services.user_files import UserFileStore
from ..responses import api_errors
from ..security import get_current_session
from ..table_responses import (
    ARROW_STREAM_RESPONSE,
    arrow_page_response,
    arrow_stream_response,
)
from .dependencies import get_user_file_store

router = APIRouter()
TEXT_RESPONSE_SCHEMA = {"schema": {"type": "string"}}
BINARY_RESPONSE_SCHEMA = {"schema": {"type": "string", "format": "binary"}}


@router.get(
    "/preview",
    response_class=Response,
    responses={**api_errors(400, 403, 404, 413, 422), **ARROW_STREAM_RESPONSE},
)
async def preview_file(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    path: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=500),
    sheet_name: str | None = Query(None),
    runtime: Runtime = Depends(get_runtime),
) -> Response:
    """Return one self-contained Arrow IPC preview page."""

    page_result = await runtime.file_read_service.preview(
        principal.user.id,
        path,
        page=page,
        page_size=page_size,
        sheet_name=sheet_name,
    )
    return arrow_page_response(page_result)


@router.get(
    "/preview/schema",
    response_class=Response,
    responses={**api_errors(400, 403, 404, 413, 422), **ARROW_STREAM_RESPONSE},
)
async def preview_file_schema(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    path: str = Query(..., min_length=1),
    sheet_name: str | None = Query(None),
    runtime: Runtime = Depends(get_runtime),
) -> Response:
    """Return one file preview schema as a zero-row Arrow IPC stream."""

    content = await runtime.file_read_service.schema(
        principal.user.id,
        path,
        sheet_name=sheet_name,
    )
    return arrow_stream_response(content)


@router.get(
    "/worksheets",
    response_model=FileWorksheetsResource,
    responses=api_errors(400, 403, 404, 413, 422),
)
async def list_file_worksheets(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    path: str = Query(..., min_length=1),
    runtime: Runtime = Depends(get_runtime),
) -> FileWorksheetsResource:
    """Return worksheet names for one Excel workbook."""

    return await runtime.file_read_service.worksheets(principal.user.id, path)


@router.get(
    "/raw",
    response_class=Response,
    responses={
        **api_errors(400, 404, 413, 422),
        200: {
            "description": "Raw UTF-8 file content.",
            "content": {
                "text/plain": TEXT_RESPONSE_SCHEMA,
                "text/markdown": TEXT_RESPONSE_SCHEMA,
            },
        },
    },
)
async def get_raw_file(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    path: str = Query(..., description="Path relative to the user's data directory"),
    runtime: Runtime = Depends(get_runtime),
) -> Response:
    content, media_type = await runtime.file_read_service.read_text(
        principal.user.id,
        path,
    )
    return Response(content=content, media_type=media_type)


@router.get(
    "/content",
    response_class=FileResponse,
    responses={
        **api_errors(400, 404, 413, 422, 507),
        200: {
            "description": "Binary file download.",
            "content": {"application/octet-stream": BINARY_RESPONSE_SCHEMA},
        },
    },
)
async def download_file(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    path: str = Query(..., description="Path relative to the user's data directory"),
    file_store: UserFileStore = Depends(get_user_file_store),
) -> FileResponse:
    snapshot = await file_store.response_snapshot(principal.user.id, path)
    return FileResponse(
        snapshot.path,
        media_type="application/octet-stream",
        filename=Path(path).name,
        background=BackgroundTask(snapshot.cleanup),
    )
