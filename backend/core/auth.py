"""
Authentication utilities and dependencies
"""

import logging
from typing import Optional

from config import settings
from db import validate_access_token
from fastapi import Depends, Header, HTTPException

logger = logging.getLogger(__name__)


async def get_current_user(authorization: Optional[str] = Header(None)):
    """
    Dependency to get current authenticated user.

    Single-user mode: Always returns root user
    Multi-user mode: Validates auth token
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
    except (IndexError, AttributeError):
        raise HTTPException(
            status_code=401, detail="Invalid authorization header format"
        )


async def get_current_user_from_token(token: str) -> dict:
    """Validate token and return user - for multi-user mode"""
    user = await validate_access_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


def get_available_auth_methods() -> list:
    """Get list of available authentication methods"""
    methods = []

    if settings.multi_user and settings.google_client_id:
        methods.append({"name": "google", "display_name": "Google", "enabled": True})

    return methods


def require_admin(current_user: dict = Depends(get_current_user)):
    """Dependency to require admin privileges"""
    # TODO: Implement admin role checking logic
    return current_user
