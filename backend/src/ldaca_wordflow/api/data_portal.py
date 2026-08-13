"""LDaCA Data Portal read and retained-import HTTP boundaries."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, Security, status

from ..domain import UserFileImport
from ..models.data_sources import (
    DataPortalFeaturedRequest,
    DataPortalImportSubmitRequest,
    DataPortalSearchRequest,
    DataPortalSearchResource,
)
from ..runtime import Runtime, get_runtime
from ..services.sessions import SessionPrincipal
from .responses import api_errors, route_path
from .security import get_current_session

router = APIRouter(
    prefix="/data-portal",
    tags=["data-portal"],
    responses=api_errors(401),
)


@router.post(
    "/search",
    response_model=DataPortalSearchResource,
    responses=api_errors(400, 403, 422, 502),
)
async def search_data_portal(
    request: DataPortalSearchRequest,
    _principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> DataPortalSearchResource:
    """Search the configured portal without holding file or workspace gates."""

    return await runtime.data_portal_service.search(request)


@router.post(
    "/featured",
    response_model=DataPortalSearchResource,
    responses=api_errors(400, 403, 422, 502),
)
async def list_featured_data_portal_collections(
    request: DataPortalFeaturedRequest,
    _principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> DataPortalSearchResource:
    """Return configured featured collections through the same typed resource."""

    return await runtime.data_portal_service.featured(request.api_token)


@router.post(
    "/imports",
    response_model=UserFileImport,
    status_code=status.HTTP_202_ACCEPTED,
    responses=api_errors(400, 403, 409, 422, 507),
)
async def submit_data_portal_import(
    request: DataPortalImportSubmitRequest,
    http_request: Request,
    response: Response,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> UserFileImport:
    """Queue a process import while keeping the portal token out of persistence."""

    resource = await runtime.user_file_import_service.submit_data_portal(
        principal.user.id,
        request,
    )
    response.headers["Location"] = route_path(
        http_request,
        "get_user_file_import",
        import_id=resource.id,
    )
    return resource


__all__ = ["router"]
