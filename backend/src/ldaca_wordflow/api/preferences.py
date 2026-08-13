"""Authenticated account-level user preference routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Security

from ..models.user_preferences import UserPreferences, UserPreferencesPatch
from ..runtime import Runtime, get_runtime
from ..services.sessions import SessionPrincipal
from .responses import api_errors
from .security import get_current_session

router = APIRouter(
    prefix="/preferences",
    tags=["preferences"],
    responses=api_errors(401),
)


@router.get("", response_model=UserPreferences, responses=api_errors(500))
async def get_preferences(
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> UserPreferences:
    return await runtime.user_preference_store.get(principal.user.id)


@router.patch(
    "",
    response_model=UserPreferences,
    responses=api_errors(422, 500),
)
async def update_preferences(
    patch: UserPreferencesPatch,
    principal: Annotated[SessionPrincipal, Security(get_current_session)],
    runtime: Runtime = Depends(get_runtime),
) -> UserPreferences:
    return await runtime.user_preference_store.update(principal.user.id, patch)


__all__ = ["router"]
