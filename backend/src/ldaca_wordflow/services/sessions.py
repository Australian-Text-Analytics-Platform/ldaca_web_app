"""Runtime-owned users, hashed hosted sessions, and single-user CSRF.

Used by authentication routes and dependencies. Single-user identity is
process-local and database-free. Hosted raw session and CSRF tokens exist only
at issuance/request boundaries; SQLite stores unique SHA-256 hashes. Multiple
rows per hosted user are intentional so logging in on one device never revokes
another device.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from base64 import urlsafe_b64encode
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

import anyio
from anyio.to_thread import run_sync as run_sync_in_worker_thread

from ..infrastructure.database import Database
from ..infrastructure.storage.durable_fs import mkdir_durable
from ..infrastructure.storage.layout import user_root
from ..models.session import SessionUser
from ..settings import Settings
from ..shared.errors import InvalidInputError, ResourceConflictError

SINGLE_USER = SessionUser(
    id="root",
    email="root@localhost",
    name="Root User",
)


def _now() -> datetime:
    return datetime.now(UTC)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _csrf_for_session(session_token: str) -> str:
    """Derive the retrievable opaque CSRF token from the HttpOnly secret.

    The database stores only this value's hash. ``GET /api/session`` can
    reproduce the raw value from the presented session cookie without storing
    plaintext server-side or exposing the cookie to JavaScript.
    """

    digest = hmac.new(
        session_token.encode("utf-8"),
        b"wordflow-csrf-v1",
        hashlib.sha256,
    ).digest()
    return urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


@dataclass(frozen=True, slots=True)
class SessionPrincipal:
    """Authenticated runtime identity and stream-ownership session id."""

    session_id: str
    user: SessionUser
    expires_at: datetime | None


@dataclass(frozen=True, slots=True)
class IssuedSession:
    """Raw browser credentials returned exactly once to the cookie boundary."""

    principal: SessionPrincipal
    session_token: str
    csrf_token: str
    expires_at: datetime


class SessionService:
    """Own hosted sessions and the desktop process identity."""

    def __init__(
        self,
        settings: Settings,
        database: Database | None,
        *,
        io_limiter: anyio.CapacityLimiter,
    ) -> None:
        self.settings = settings
        self._database = database
        self._io_limiter = io_limiter
        self._desktop_csrf_token: str | None = None
        self._desktop_principal: SessionPrincipal | None = None
        if not settings.multi_user:
            self._desktop_csrf_token = secrets.token_urlsafe(32)
            self._desktop_principal = SessionPrincipal(
                session_id=f"desktop-{uuid.uuid4()}",
                user=SINGLE_USER,
                expires_at=None,
            )

    async def initialize(self) -> None:
        """Provision only the active deployment identity and expire sessions."""

        if self._desktop_principal is not None:
            await self._provision_user_root(self._desktop_principal.user.id)
        await self.cleanup_expired()

    @property
    def hosted_database(self) -> Database:
        """Return the database required by hosted-only identity operations."""

        if self._database is None:
            raise RuntimeError("Single-user mode has no identity database")
        return self._database

    @property
    def desktop_csrf_token(self) -> str:
        """Return the process-lifetime desktop token exposed by ``GET /session``."""

        if self._desktop_csrf_token is None:
            raise RuntimeError("Hosted mode has no desktop CSRF token")
        return self._desktop_csrf_token

    def csrf_token_for_session(self, session_token: str) -> str:
        """Return the raw CSRF value bound to a presented hosted cookie."""

        return _csrf_for_session(session_token)

    async def current_principal(
        self,
        session_token: str | None,
    ) -> SessionPrincipal | None:
        """Resolve the supported deployment profile into one current identity."""

        if not self.settings.multi_user:
            if self._desktop_principal is None:
                raise RuntimeError("Desktop identity was not initialized")
            return self._desktop_principal
        if not session_token:
            return None
        token_hash = _hash_token(session_token)
        now = _iso(_now())
        async with self.hosted_database.connection() as connection:
            row = await (
                await connection.execute(
                    """
                    SELECT
                        s.id AS session_id, s.expires_at AS session_expires_at,
                        u.id, u.email, u.name, u.picture
                    FROM user_sessions AS s
                    JOIN users AS u ON u.id = s.user_id
                    WHERE s.token_hash = ?
                      AND s.revoked_at IS NULL
                      AND s.expires_at > ?
                      AND u.is_active = 1
                    """,
                    (token_hash, now),
                )
            ).fetchone()
        if row is None:
            return None
        return SessionPrincipal(
            session_id=str(row["session_id"]),
            user=_row_to_user(cast(Mapping[str, object], row)),
            expires_at=datetime.fromisoformat(str(row["session_expires_at"])),
        )

    async def validate_csrf(
        self,
        session_token: str | None,
        csrf_token: str | None,
    ) -> bool:
        """Validate the CSRF secret bound to the current browser/process session."""

        if not csrf_token:
            return False
        if not self.settings.multi_user:
            if self._desktop_csrf_token is None:
                raise RuntimeError("Desktop CSRF token was not initialized")
            return hmac.compare_digest(csrf_token, self._desktop_csrf_token)
        if not session_token:
            return False
        async with self.hosted_database.connection() as connection:
            row = await (
                await connection.execute(
                    """
                    SELECT csrf_hash
                    FROM user_sessions
                    WHERE token_hash = ?
                      AND revoked_at IS NULL
                      AND expires_at > ?
                    """,
                    (_hash_token(session_token), _iso(_now())),
                )
            ).fetchone()
        if row is None:
            return False
        return hmac.compare_digest(str(row["csrf_hash"]), _hash_token(csrf_token))

    async def upsert_oidc_user(
        self,
        *,
        issuer: str,
        subject: str,
        email: str,
        name: str,
        picture: str | None,
    ) -> SessionUser:
        """Provision a provider-validated identity without implicit account linking."""

        normalized_email = email.strip().lower()
        if not normalized_email:
            raise InvalidInputError("OAuth identity is missing an email")
        normalized_name = name.strip() or normalized_email
        normalized_picture = picture.strip() if picture and picture.strip() else None

        now = _iso(_now())
        async with self.hosted_database.connection() as connection:
            await connection.execute("BEGIN IMMEDIATE")
            identity = await (
                await connection.execute(
                    """
                    SELECT u.id, u.email, u.name, u.picture
                    FROM user_identities AS i
                    JOIN users AS u ON u.id = i.user_id
                    WHERE i.issuer = ? AND i.subject = ?
                    """,
                    (issuer, subject),
                )
            ).fetchone()
            if identity is not None:
                user_id = str(identity["id"])
                conflicting_email = await (
                    await connection.execute(
                        "SELECT id FROM users WHERE email = ? AND id != ?",
                        (normalized_email, user_id),
                    )
                ).fetchone()
                if conflicting_email is not None:
                    await connection.rollback()
                    raise ResourceConflictError(
                        "Email belongs to a different identity provider"
                    )
            else:
                existing = await (
                    await connection.execute(
                        "SELECT id FROM users WHERE email = ?",
                        (normalized_email,),
                    )
                ).fetchone()
                if existing is not None:
                    await connection.rollback()
                    raise ResourceConflictError(
                        "Email belongs to a different identity provider"
                    )
                user_id = str(uuid.uuid4())
                await connection.execute(
                    """
                    INSERT INTO users (
                        id, email, name, picture, is_active, created_at, last_login
                    ) VALUES (?, ?, ?, ?, 1, ?, ?)
                    """,
                    (
                        user_id,
                        normalized_email,
                        normalized_name,
                        normalized_picture,
                        now,
                        now,
                    ),
                )
                await connection.execute(
                    """
                    INSERT INTO user_identities (issuer, subject, user_id, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (issuer, subject, user_id, now),
                )

            await connection.execute(
                """
                UPDATE users
                SET email = ?, name = ?, picture = ?, last_login = ?
                WHERE id = ?
                """,
                (
                    normalized_email,
                    normalized_name,
                    normalized_picture,
                    now,
                    user_id,
                ),
            )
            row = await (
                await connection.execute(
                    "SELECT id, email, name, picture FROM users WHERE id = ?",
                    (user_id,),
                )
            ).fetchone()
            await connection.commit()

        # Folder provisioning happens only after the DB transaction succeeds.
        # It is idempotent and uses the same immutable runtime settings.
        await self._provision_user_root(user_id)
        return _row_to_user(cast(Mapping[str, object], row))

    async def issue(self, user: SessionUser) -> IssuedSession:
        """Create an independent 256-bit session and CSRF-token pair."""

        if not self.settings.multi_user:
            raise RuntimeError("Desktop single-user mode does not issue auth cookies")
        session_token = secrets.token_urlsafe(32)
        csrf_token = _csrf_for_session(session_token)
        session_id = str(uuid.uuid4())
        created_at = _now()
        expires_at = created_at + timedelta(hours=self.settings.session_ttl_hours)
        async with self.hosted_database.connection() as connection:
            await connection.execute(
                """
                INSERT INTO user_sessions (
                    id, user_id, token_hash, csrf_hash,
                    expires_at, created_at, revoked_at
                ) VALUES (?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    session_id,
                    user.id,
                    _hash_token(session_token),
                    _hash_token(csrf_token),
                    _iso(expires_at),
                    _iso(created_at),
                ),
            )
            await connection.commit()
        return IssuedSession(
            principal=SessionPrincipal(
                session_id=session_id,
                user=user,
                expires_at=expires_at,
            ),
            session_token=session_token,
            csrf_token=csrf_token,
            expires_at=expires_at,
        )

    async def revoke(self, session_token: str | None) -> str | None:
        """Transactionally revoke exactly the presented hosted session."""

        if not self.settings.multi_user or not session_token:
            return None
        async with self.hosted_database.connection() as connection:
            await connection.execute("BEGIN IMMEDIATE")
            row = await (
                await connection.execute(
                    """
                    SELECT id FROM user_sessions
                    WHERE token_hash = ? AND revoked_at IS NULL
                    """,
                    (_hash_token(session_token),),
                )
            ).fetchone()
            if row is not None:
                await connection.execute(
                    "UPDATE user_sessions SET revoked_at = ? WHERE id = ?",
                    (_iso(_now()), str(row["id"])),
                )
            await connection.commit()
        return str(row["id"]) if row is not None else None

    async def cleanup_expired(self) -> None:
        """Delete expired/revoked rows during bounded runtime maintenance."""

        if not self.settings.multi_user:
            return
        async with self.hosted_database.connection() as connection:
            await connection.execute(
                "DELETE FROM user_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL",
                (_iso(_now()),),
            )
            await connection.commit()

    async def _provision_user_root(self, user_id: str) -> None:
        """Create runtime-owned user directories off the event loop."""

        await run_sync_in_worker_thread(
            _provision_user_root,
            user_root(self.settings, user_id),
            abandon_on_cancel=False,
            limiter=self._io_limiter,
        )


def _row_to_user(row: Mapping[str, object]) -> SessionUser:
    picture = row["picture"]
    return SessionUser(
        id=str(row["id"]),
        email=str(row["email"]),
        name=str(row["name"]),
        picture=str(picture) if picture is not None else None,
    )


def _provision_user_root(root: Path) -> None:
    for name in ("files", "imports"):
        mkdir_durable(root / name)
