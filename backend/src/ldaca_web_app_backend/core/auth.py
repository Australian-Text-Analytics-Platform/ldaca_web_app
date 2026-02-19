"""
Authentication utilities and dependencies
"""

import logging
from typing import Optional

from fastapi import Header, HTTPException

from ..db import validate_access_token
from ..settings import settings

logger = logging.getLogger(__name__)


async def get_current_user(authorization: Optional[str] = Header(None)):
    """
    Dependency to get current authenticated user.

    Single-user mode: returns configured local user.
    Multi-user mode: validates bearer token.

    Used by:
    - protected API route dependencies across backend routers

    Why:
    - Centralizes auth-mode branching so route handlers stay auth-agnostic.
    """
    if not settings.multi_user:
        # Single-user mode - always return root user
        logger.debug("Single-user mode: returning root user")
        return {
            "id": settings.single_user_id,
            "email": settings.single_user_email,
            "name": settings.single_user_name,
            "picture": None,
            "is_active": True,
            "is_verified": True,
            "created_at": None,
            "last_login": None,
        }

    # Multi-user mode - require authentication
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    try:
        # Extract token from "Bearer <token>"
        token = (
            authorization.split(" ")[1]
            if authorization.startswith("Bearer ")
            else authorization
        )
        user = await validate_access_token(token)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return user
    except IndexError, AttributeError:
        raise HTTPException(
            status_code=401, detail="Invalid authorization header format"
        )


async def get_current_user_from_token(token: str) -> dict:
    """Validate bearer token and return user payload.

    Used by:
    - auth/session bootstrap routes

    Why:
    - Provides direct token validation when header dependency injection is not used.
    """
    user = await validate_access_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


def get_available_auth_methods() -> list:
    """Return enabled authentication providers for the current config.

    Used by:
    - auth capability/status endpoints

    Why:
    - Lets frontend discover login options dynamically.
    """
    methods = []

    if settings.multi_user and settings.google_client_id:
        methods.append({"name": "google", "display_name": "Google", "enabled": True})

    return methods
