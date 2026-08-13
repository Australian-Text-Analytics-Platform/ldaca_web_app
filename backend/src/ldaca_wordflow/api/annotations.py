"""Provider-level annotation discovery routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Security

from ..models.annotations import (
    AnnotationModelsRequest,
    AnnotationModelsResource,
)
from ..runtime import Runtime, get_runtime
from ..services.sessions import SessionPrincipal
from .responses import api_errors
from .security import get_current_session

router = APIRouter(
    prefix="/annotation-providers",
    tags=["annotations"],
    responses=api_errors(401),
)


@router.post(
    "/models",
    response_model=AnnotationModelsResource,
    responses=api_errors(400, 403, 409, 422, 502),
)
async def list_annotation_models(
    request: AnnotationModelsRequest,
    _principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> AnnotationModelsResource:
    """Discover models using the mode-appropriate request boundary."""

    return await runtime.annotation_service.models(request)


__all__ = ["router"]
