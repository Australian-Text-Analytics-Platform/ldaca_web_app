"""Canonical retained User File Import lifecycle endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status

from ..domain import UserFileImport
from ..models.user_file_imports import UserFileImportPage
from .dependencies import RuntimeDep
from .responses import api_errors, route_path
from .security import CurrentSessionSecurityDep

router = APIRouter(
    prefix="/user-file-imports",
    tags=["user-file-imports"],
    responses=api_errors(401),
)


@router.get(
    "",
    response_model=UserFileImportPage,
    responses=api_errors(422, 500),
)
async def list_user_file_imports(
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> UserFileImportPage:
    """Return retained import history in stable newest-first order."""

    return await runtime.user_file_import_service.list(
        principal.user.id,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{import_id}",
    response_model=UserFileImport,
    responses=api_errors(404, 422),
)
async def get_user_file_import(
    import_id: uuid.UUID,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> UserFileImport:
    """Return one import while concealing cross-user identities."""

    return await runtime.user_file_import_service.get(principal.user.id, import_id)


@router.post(
    "/{import_id}/cancel",
    response_model=UserFileImport,
    responses={
        **api_errors(404, 409, 422),
        status.HTTP_202_ACCEPTED: {
            "model": UserFileImport,
            "description": "Running import cancellation is pending",
        },
    },
)
async def cancel_user_file_import(
    import_id: uuid.UUID,
    request: Request,
    response: Response,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> UserFileImport:
    """Cancel queued work now or request confirmed running cancellation."""

    resource, pending = await runtime.user_file_import_service.cancel(
        principal.user.id,
        import_id,
    )
    response.status_code = (
        status.HTTP_202_ACCEPTED if pending else status.HTTP_200_OK
    )
    response.headers["Location"] = route_path(
        request,
        "get_user_file_import",
        import_id=resource.id,
    )
    return resource


@router.delete(
    "/{import_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(404, 409, 422),
)
async def delete_user_file_import(
    import_id: uuid.UUID,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> Response:
    """Delete one terminal history record without deleting published files."""

    await runtime.user_file_import_service.delete(principal.user.id, import_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
