"""Unauthenticated, same-origin Data Root bootstrap control plane."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header

from ..models.data_root import (
    DataRootErrorResource,
    DataRootResource,
    DataRootUpdateRequest,
)
from ..runtime import RuntimeManager, RuntimeManagerSnapshot, get_runtime_manager
from .responses import api_errors

router = APIRouter(tags=["data-root"])


def _resource(snapshot: RuntimeManagerSnapshot) -> DataRootResource:
    return DataRootResource(
        state=snapshot.state,
        source=snapshot.source,
        data_root=str(snapshot.data_root) if snapshot.data_root is not None else None,
        suggested_data_root=(
            str(snapshot.suggested_data_root)
            if snapshot.suggested_data_root is not None
            else None
        ),
        mutable=snapshot.mutable,
        runtime_generation=snapshot.runtime_generation,
        error=(
            DataRootErrorResource(
                code=snapshot.error.code,
                message=snapshot.error.message,
            )
            if snapshot.error is not None
            else None
        ),
        change_token=snapshot.change_token,
    )


@router.get("/data-root", response_model=DataRootResource, name="get_data_root")
async def get_data_root(
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> DataRootResource:
    """Return the bootstrap state without exposing multi-user filesystem paths."""

    return _resource(manager.snapshot())


@router.put(
    "/data-root",
    response_model=DataRootResource,
    name="update_data_root",
    responses=api_errors(403, 409, 422),
)
async def update_data_root(
    body: DataRootUpdateRequest,
    _change_token: Annotated[str, Header(alias="X-Data-Root-Token")],
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> DataRootResource:
    """Configure or switch the complete single-user Runtime synchronously."""

    return _resource(await manager.configure(body.data_root))


__all__ = ["router"]
