"""Provider-level annotation discovery routes."""

from __future__ import annotations


from fastapi import APIRouter

from ..models.annotations import (
    AnnotationModelsRequest,
    AnnotationModelsResource,
)
from .dependencies import RuntimeDep
from .responses import api_errors
from .security import CurrentSessionSecurityDep

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
    _principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> AnnotationModelsResource:
    """Discover models using the mode-appropriate request boundary."""

    return await runtime.annotation_service.models(request)


__all__ = ["router"]
