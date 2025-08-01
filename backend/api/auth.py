"""
Unified authentication endpoints following Single Source of Truth principle
"""

import logging
from typing import Optional

from config import settings
from core.auth import (
    get_available_auth_methods,
    get_current_user,
    get_current_user_from_token,
)
from core.utils import setup_user_folders
from db import cleanup_expired_sessions, create_user_session, get_or_create_user
from fastapi import APIRouter, Depends, Header, HTTPException
from google.auth.transport import requests as grequests
from google.oauth2 import id_token
from models import AuthInfoResponse, AuthMethod, GoogleIn, GoogleOut, User, UserResponse

router = APIRouter(prefix="/auth", tags=["authentication"])
logger = logging.getLogger(__name__)


@router.get("/", response_model=AuthInfoResponse)
async def get_auth_info(authorization: Optional[str] = Header(None)):
    """
    Main auth endpoint - tells frontend everything it needs to know.

    Returns:
    - In single-user mode: authenticated=True with root user info
    - In multi-user mode with valid token: authenticated=True with user info
    - In multi-user mode without token: authenticated=False with available auth methods
    """
    if not settings.multi_user:
        # Single-user mode - return root user directly
        logger.debug("Single-user mode: returning root user info")

        # Ensure root user folders and sample data are set up
        from core.utils import copy_sample_data_to_user

        user_folders = setup_user_folders(settings.single_user_id)
        copy_sample_data_to_user(settings.single_user_id)
        logger.debug(f"Root user folders ensured at: {user_folders['user_folder']}")

        return AuthInfoResponse(
            authenticated=True,
            user=User(
                id=settings.single_user_id,
                name=settings.single_user_name,
                email=settings.single_user_email,
                picture=None,
            ),
            multi_user_mode=False,
            available_auth_methods=[],
            requires_authentication=False,
        )

    # Multi-user mode - check for existing authentication
    if authorization and authorization.startswith("Bearer "):
        try:
            token = authorization.split(" ")[1]
            user = await get_current_user_from_token(token)
            logger.debug(f"Multi-user mode: authenticated user {user['email']}")

            return AuthInfoResponse(
                authenticated=True,
                user=User(
                    id=user["id"],
                    name=user["name"],
                    email=user["email"],
                    picture=user["picture"],
                ),
                multi_user_mode=True,
                available_auth_methods=get_available_auth_methods(),
                requires_authentication=True,
            )
        except HTTPException:
            # Invalid token - fall through to unauthenticated response
            pass

    # Multi-user mode - not authenticated, return available auth methods
    logger.debug("Multi-user mode: not authenticated, returning auth methods")
    return AuthInfoResponse(
        authenticated=False,
        user=None,
        multi_user_mode=True,
        available_auth_methods=get_available_auth_methods(),
        requires_authentication=True,
    )


@router.post("/google", response_model=GoogleOut)
async def google_auth(payload: GoogleIn):
    """Google OAuth authentication - only available in multi-user mode"""
    if not settings.multi_user:
        raise HTTPException(
            status_code=400,
            detail="Google authentication not available in single-user mode",
        )

    if not settings.google_client_id:
        raise HTTPException(
            status_code=500, detail="Google authentication not configured"
        )

    try:
        # Verify Google ID token
        info = id_token.verify_oauth2_token(
            payload.id_token, grequests.Request(), audience=settings.google_client_id
        )
        logger.info(f"Google auth successful for: {info.get('email')}")
    except ValueError as e:
        logger.error(f"Google token verification failed: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid ID token: {e}")
    except Exception as e:
        logger.error(f"Unexpected error during Google token verification: {e}")
        raise HTTPException(status_code=500, detail=f"Authentication error: {str(e)}")

    if not info.get("email_verified"):
        logger.error(f"Email not verified for user: {info.get('email')}")
        raise HTTPException(status_code=400, detail="Email not verified")

    try:
        # Get or create user in our database
        user = await get_or_create_user(
            email=info.get("email"),
            name=info.get("name"),
            picture=info.get("picture"),
            google_id=info.get("sub"),
        )
        logger.info(f"User created/found: {user['id']} - {user['email']}")

        # Create user folders and setup sample data
        user_folders = setup_user_folders(user["id"])
        logger.info(
            f"User folders created for: {user['id']} at {user_folders['user_folder']}"
        )

        # Update user folder path in database
        from db import update_user_folder_path

        await update_user_folder_path(user["id"], str(user_folders["user_folder"]))

        # Ensure sample data is copied to user folder on every login
        from core.utils import copy_sample_data_to_user

        copy_sample_data_to_user(user["id"])
        logger.info(f"Sample data refreshed for user: {user['id']}")

        # Create session token
        session = await create_user_session(user["id"], payload.id_token)
        logger.info(
            f"Session created for user: {user['id']}, token: {session['access_token'][:10]}..."
        )

        return GoogleOut(
            access_token=session["access_token"],
            refresh_token=session["refresh_token"],
            expires_in=session["expires_in"],
            scope="openid email profile",
            token_type="Bearer",
            user=User(
                id=user["id"],
                email=user["email"],
                name=user["name"],
                picture=user["picture"],
            ),
        )

    except Exception as e:
        logger.error(f"Error during user/session creation: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create user session: {str(e)}"
        )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current user information"""
    # Convert datetime objects to ISO format strings
    created_at_str = (
        current_user["created_at"].isoformat() if current_user["created_at"] else ""
    )
    last_login_str = (
        current_user["last_login"].isoformat() if current_user["last_login"] else ""
    )

    return {
        "id": current_user["id"],  # Already a string from validate_access_token
        "email": current_user["email"],
        "name": current_user["name"],
        "picture": current_user["picture"],
        "is_active": current_user["is_active"],
        "is_verified": current_user["is_verified"],
        "created_at": created_at_str,
        "last_login": last_login_str,
    }


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """Logout current user - only meaningful in multi-user mode"""
    if not settings.multi_user:
        return {"message": "Logout not applicable in single-user mode"}

    await cleanup_expired_sessions()
    logger.info(f"User {current_user['email']} logged out successfully")
    return {"message": f"User {current_user['email']} logged out successfully"}


@router.get("/status")
async def auth_status(current_user: dict = Depends(get_current_user)):
    """Check if user is authenticated"""
    return {
        "authenticated": True,
        "user": {
            "id": current_user["id"],
            "email": current_user["email"],
            "name": current_user["name"],
        },
    }


@router.get("/debug/token")
async def debug_token_validation(authorization: str = Header(None)):
    """Debug endpoint to check token validation (remove in production)"""
    if not authorization:
        return {"error": "No authorization header", "header": None}

    try:
        # Extract token from "Bearer <token>"
        token = (
            authorization.split(" ")[1]
            if authorization.startswith("Bearer ")
            else authorization
        )

        from db import validate_access_token

        user = await validate_access_token(token)

        if user:
            return {
                "token_valid": True,
                "user_id": user["id"],
                "email": user["email"],
                "token_preview": f"{token[:10]}...{token[-10:]}",
            }
        else:
            return {
                "token_valid": False,
                "token_preview": f"{token[:10]}...{token[-10:]}"
                if len(token) > 20
                else token,
                "message": "Token not found in database or expired",
            }
    except Exception as e:
        return {
            "error": str(e),
            "token_preview": authorization[:20] if authorization else None,
        }


@router.options("/google")
async def google_auth_options():
    """Handle preflight requests for Google auth"""
    return {"message": "OK"}


@router.options("/status")
async def auth_status_options():
    """Handle preflight requests for auth status"""
    return {"message": "OK"}


@router.get("/health")
async def auth_health():
    """Authentication health check - no auth required"""
    return {
        "status": "healthy",
        "mode": "single-user" if not settings.multi_user else "multi-user",
        "google_configured": bool(settings.google_client_id),
        "endpoints": {
            "auth_info": "/auth/",
            "google_auth": "/auth/google",
            "user_details": "/auth/me",
            "logout": "/auth/logout",
        },
    }
