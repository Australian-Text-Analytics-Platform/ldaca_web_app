"""Current-principal storage policy and usage projection."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Request, Response, Security

from ..models.storage import (
    QuotaStorageResource,
    StorageResource,
    UnlimitedStorageResource,
)
from ..runtime import get_runtime
from ..services.quota import QuotaStorageStatus
from ..services.sessions import SessionPrincipal
from .responses import api_errors
from .security import get_current_session

router = APIRouter(
    tags=["storage"],
    responses=api_errors(401),
)


@router.get(
    "/storage",
    response_model=StorageResource,
)
async def get_storage(
    request: Request,
    response: Response,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
) -> StorageResource:
    """Return a fresh quota snapshot or the exact unlimited policy."""

    response.headers["Cache-Control"] = "no-store"
    snapshot = await get_runtime(request).quota_service.status(principal.user.id)
    if isinstance(snapshot, QuotaStorageStatus):
        return QuotaStorageResource(
            limit_bytes=snapshot.limit_bytes,
            used_bytes=snapshot.used_bytes,
            reserved_bytes=snapshot.reserved_bytes,
            available_bytes=snapshot.available_bytes,
        )
    return UnlimitedStorageResource()


__all__ = ["router"]
