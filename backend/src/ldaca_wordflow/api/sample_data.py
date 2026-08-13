"""Sample catalogue and retained-import HTTP boundaries."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, Security, status

from ..domain import UserFileImport
from ..models.data_sources import SampleCatalogueResource
from ..runtime import Runtime, get_runtime
from ..services.sessions import SessionPrincipal
from .responses import api_errors, route_path
from .security import get_current_session

router = APIRouter(
    prefix="/sample-collections",
    tags=["sample-data"],
    responses=api_errors(401),
)


@router.get(
    "",
    response_model=SampleCatalogueResource,
    responses=api_errors(502),
)
async def list_sample_collections(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> SampleCatalogueResource:
    """Return the validated catalogue with current-user installation state."""

    return await runtime.sample_data_service.catalogue(principal.user.id)


@router.post(
    "/{collection_id:path}/imports",
    response_model=UserFileImport,
    status_code=status.HTTP_202_ACCEPTED,
    responses=api_errors(400, 403, 409, 413, 422, 502, 507),
)
async def submit_sample_import(
    collection_id: str,
    request: Request,
    response: Response,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> UserFileImport:
    """Queue one retained import of a complete sample collection."""

    resource = await runtime.user_file_import_service.submit_sample(
        principal.user.id,
        collection_id,
    )
    response.headers["Location"] = route_path(
        request,
        "get_user_file_import",
        import_id=resource.id,
    )
    return resource


__all__ = ["router"]
