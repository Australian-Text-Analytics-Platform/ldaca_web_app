"""
Admin endpoints
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from ..core.auth import get_current_user
from ..db import User, UserSession, async_session_maker, cleanup_expired_sessions
from ..settings import settings

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(current_user: dict) -> None:
    """Authorize admin routes.

    - Single-user mode: always allowed.
    - Multi-user mode: requires current user email to be in `ADMIN_EMAILS`.
    """
    if not settings.multi_user:
        return

    current_email = str(current_user.get("email") or "").strip().lower()
    admin_allowlist = settings.get_admin_emails()

    if current_email and current_email in admin_allowlist:
        return

    raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/users")
async def list_users(current_user: dict = Depends(get_current_user)):
    """List users with active-session counts.

    Used by:
    - admin dashboard/user management views

    Why:
    - Provides operational visibility into user and session activity.

    Refactor note:
    - Add `require_admin` dependency before wider deployment to avoid role drift.
    """
    _require_admin(current_user)

    async with async_session_maker() as session:
        # Get all users
        result = await session.execute(select(User))
        users = result.scalars().all()

        user_list = []
        for user in users:
            # Count active sessions for each user
            session_result = await session.execute(
                select(UserSession)
                .where(UserSession.user_id == user.id)
                .where(UserSession.expires_at > datetime.now(UTC).replace(tzinfo=None))
            )
            active_sessions = len(session_result.scalars().all())

            user_list.append({
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
                "created_at": user.created_at,
                "last_login": user.last_login,
                "active_sessions": active_sessions,
            })

        return {
            "users": user_list,
            "total": len(user_list),
            "requested_by": current_user["email"],
        }


@router.get("/cleanup")
async def admin_cleanup(current_user: dict = Depends(get_current_user)):
    """Trigger cleanup of expired session rows.

    Used by:
    - admin maintenance actions

    Why:
    - Allows manual session-store maintenance in addition to automatic cleanup.

    Refactor note:
    - Add `require_admin` dependency before wider deployment.
    """
    _require_admin(current_user)
    await cleanup_expired_sessions()
    return {
        "message": "Expired sessions cleaned up successfully",
        "performed_by": current_user["email"],
    }
