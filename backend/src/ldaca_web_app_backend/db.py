import secrets
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import Depends
from fastapi_users.db import SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func

from .settings import settings


# SQLAlchemy setup
class Base(DeclarativeBase):
    pass


class User(SQLAlchemyBaseUserTableUUID, Base):
    """User model with additional fields"""

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    picture: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    google_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, unique=True
    )
    user_folder_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class UserSession(Base):
    """User session model for token management"""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id"), nullable=False)
    access_token: Mapped[str] = mapped_column(String(255), nullable=False)
    refresh_token: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


# Create async engine and session maker
# Use derived URL which respects DATA_ROOT
engine = create_async_engine(settings.get_database_url())
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


async def create_db_and_tables():
    """Create all configured SQLAlchemy tables.

    Used by:
    - `init_db`

    Why:
    - Ensures schema exists before auth/session operations begin.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async SQLAlchemy session for dependency injection.

    Used by:
    - FastAPI DB dependencies (`get_user_db`)

    Why:
    - Centralizes session lifecycle and transaction scope.
    """
    async with async_session_maker() as session:
        yield session


async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    """Yield FastAPI Users DB adapter bound to current async session.

    Used by:
    - auth/user management dependencies

    Why:
    - Bridges app user model with fastapi-users integration points.
    """
    yield SQLAlchemyUserDatabase(session, User)


# Compatibility functions for existing code
async def init_db():
    """Initialize persistent DB environment and schema.

    Used by:
    - app startup lifespan hook

    Why:
    - Creates data root + schema before handling API traffic.
    """
    # Ensure DATA_ROOT exists before creating/opening DB file
    data_root = settings.get_data_root()
    data_root.mkdir(parents=True, exist_ok=True)
    await create_db_and_tables()
    print(f"SUCCESS: Database initialized at: {settings.get_database_url()}")


async def get_or_create_user(
    email: str, name: str, picture: str, google_id: str
) -> Dict[str, Any]:
    """Fetch existing user by email or create/update OAuth user record.

    Used by:
    - `api.auth.google_auth`

    Why:
    - Maintains idempotent user provisioning from Google identity payloads.
    """
    async with async_session_maker() as session:
        # Try to get existing user by email
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if user:
            # Update existing user info and last login
            user.name = name
            user.picture = picture
            user.google_id = google_id
            user.last_login = datetime.now(UTC).replace(tzinfo=None)
            await session.commit()
            await session.refresh(user)
        else:
            # Create new user
            user = User(
                email=email,
                name=name,
                picture=picture,
                google_id=google_id,
                user_folder_path=None,  # Will be set when folders are created
                last_login=datetime.now(UTC).replace(tzinfo=None),
                is_active=True,
                is_superuser=False,
                is_verified=True,  # Auto-verify Google users
                hashed_password="oauth_user",  # Placeholder for OAuth users
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)

        return {
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "picture": user.picture,
            "google_id": user.google_id,
            "user_folder_path": user.user_folder_path,
            "created_at": user.created_at,
            "last_login": user.last_login,
            "is_active": user.is_active,
            "is_superuser": user.is_superuser,
            "is_verified": user.is_verified,
        }


async def create_user_session(user_id: str, google_token: str) -> Dict[str, Any]:
    """Create/replace active session token pair for a user.

    Used by:
    - `api.auth.google_auth`

    Why:
    - Enforces single active session row per user in current design.

    Refactor note:
    - `google_token` argument is currently unused; remove parameter or persist
        provenance metadata if multi-token support is planned.
    """
    async with async_session_maker() as session:
        # Generate our own access token
        access_token = secrets.token_urlsafe(32)
        refresh_token = secrets.token_urlsafe(32)

        # Calculate expiry time
        expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(
            hours=settings.token_expire_hours
        )

        # Clean up old sessions for this user (optional - keep only latest)
        result = await session.execute(
            select(UserSession).where(UserSession.user_id == uuid.UUID(user_id))
        )
        old_sessions = result.scalars().all()
        for old_session in old_sessions:
            await session.delete(old_session)

        # Create new session
        new_session = UserSession(
            user_id=uuid.UUID(user_id),
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=expires_at,
        )
        session.add(new_session)
        await session.commit()

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": settings.token_expire_hours * 3600,  # in seconds
            "expires_at": expires_at,
        }


async def validate_access_token(access_token: str) -> Optional[Dict[str, Any]]:
    """Validate access token and return user/session payload when active.

    Used by:
    - auth dependency validation paths

    Why:
    - Centralizes token expiry and join logic for user identity resolution.
    """
    async with async_session_maker() as session:
        result = await session.execute(
            select(User, UserSession)
            .join(UserSession, User.id == UserSession.user_id)
            .where(UserSession.access_token == access_token)
            .where(UserSession.expires_at > datetime.now(UTC).replace(tzinfo=None))
        )
        row = result.first()

        if row:
            user, session_data = row
            return {
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
                "picture": user.picture,
                "google_id": user.google_id,
                "user_folder_path": user.user_folder_path,
                "created_at": user.created_at,
                "last_login": user.last_login,
                "is_active": user.is_active,
                "is_superuser": user.is_superuser,
                "is_verified": user.is_verified,
                "access_token": session_data.access_token,
                "expires_at": session_data.expires_at,
            }
        return None


async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Return user payload by email when present.

    Used by:
    - auth/user administration lookup paths

    Why:
    - Provides a consistent dict payload shape for caller code.
    """
    async with async_session_maker() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if user:
            return {
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
                "picture": user.picture,
                "google_id": user.google_id,
                "user_folder_path": user.user_folder_path,
                "created_at": user.created_at,
                "last_login": user.last_login,
                "is_active": user.is_active,
                "is_superuser": user.is_superuser,
                "is_verified": user.is_verified,
            }
        return None


async def cleanup_expired_sessions():
    """Delete expired session rows from storage.

    Used by:
    - app startup/shutdown maintenance and logout flows

    Why:
    - Prevents stale sessions from accumulating indefinitely.
    """
    async with async_session_maker() as session:
        result = await session.execute(
            select(UserSession).where(
                UserSession.expires_at <= datetime.now(UTC).replace(tzinfo=None)
            )
        )
        expired_sessions = result.scalars().all()
        for expired_session in expired_sessions:
            await session.delete(expired_session)
        await session.commit()


async def update_user_folder_path(user_id: str, folder_path: str) -> None:
    """Persist user folder location after storage provisioning.

    Used by:
    - `api.auth.google_auth`

    Why:
    - Keeps DB user metadata aligned with filesystem initialization.
    """
    async with async_session_maker() as session:
        result = await session.execute(
            select(User).where(User.id == uuid.UUID(user_id))
        )
        user = result.scalar_one_or_none()

        if user:
            user.user_folder_path = folder_path
            await session.commit()
            print(f"SUCCESS: Updated user {user_id} folder path to: {folder_path}")
        else:
            print(f"WARNING: User {user_id} not found for folder path update")
