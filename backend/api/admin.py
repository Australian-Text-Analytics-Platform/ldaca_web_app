"""
Admin endpoints
"""

from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy import select

from core.auth import get_current_user
from db import async_session_maker, User, UserSession, cleanup_expired_sessions

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
async def list_users(current_user: dict = Depends(get_current_user)):
    """List all users with session info (admin endpoint)"""
    # TODO: Add admin role check in production
    
    async with async_session_maker() as session:
        # Get all users
        result = await session.execute(select(User))
        users = result.scalars().all()
        
        user_list = []
        for user in users:
            # Count active sessions for each user
            session_result = await session.execute(
                select(UserSession).where(
                    UserSession.user_id == user.id
                ).where(
                    UserSession.expires_at > datetime.utcnow()
                )
            )
            active_sessions = len(session_result.scalars().all())
            
            user_list.append({
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
                "created_at": user.created_at,
                "last_login": user.last_login,
                "active_sessions": active_sessions
            })
        
        return {
            "users": user_list,
            "total": len(user_list),
            "requested_by": current_user['email']
        }


@router.get("/cleanup")
async def admin_cleanup(current_user: dict = Depends(get_current_user)):
    """Clean up expired sessions (admin endpoint)"""
    # TODO: Add admin role check in production
    await cleanup_expired_sessions()
    return {
        "message": "Expired sessions cleaned up successfully",
        "performed_by": current_user['email']
    }
