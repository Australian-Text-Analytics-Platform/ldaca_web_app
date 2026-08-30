"""Authenticated account-level user preference routes."""

from __future__ import annotations


from fastapi import APIRouter

from ..models.user_preferences import UserPreferences, UserPreferencesPatch
from .dependencies import RuntimeDep
from .responses import api_errors
from .security import CurrentSessionSecurityDep

router = APIRouter(
    prefix="/preferences",
    tags=["preferences"],
    responses=api_errors(401),
)


@router.get("", response_model=UserPreferences, responses=api_errors(500))
async def get_preferences(
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> UserPreferences:
    return await runtime.user_preference_store.get(principal.user.id)


@router.patch(
    "",
    response_model=UserPreferences,
    responses=api_errors(422, 500),
)
async def update_preferences(
    patch: UserPreferencesPatch,
    principal: CurrentSessionSecurityDep,
    runtime: RuntimeDep,
) -> UserPreferences:
    return await runtime.user_preference_store.update(principal.user.id, patch)


__all__ = ["router"]
