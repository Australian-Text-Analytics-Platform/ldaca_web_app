"""Cookie-session bootstrap, logout, and provider callback routes.

No bearer token is returned, persisted in browser storage, or placed in a URL.
Hosted callbacks issue one HttpOnly cookie and redirect only to a validated
relative path. Desktop mode is an explicit process identity and never issues an
authentication cookie.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import unquote, urlencode, urlsplit

from fastapi import APIRouter, Form, Query, Request, Response, status
from starlette.responses import RedirectResponse

from ..shared.errors import AccessDeniedError, InvalidInputError, UnauthenticatedError
from ..models.session import AuthProvider, SessionResponse
from ..services.sessions import IssuedSession, SessionService
from .dependencies import RuntimeDep
from .responses import api_errors, route_path
from .security import (
    SESSION_COOKIE_NAME,
    OptionalSessionDep,
    SessionCookieDep,
)

router = APIRouter(tags=["session"])


def _token_hash(value: str) -> str:
    """Hash opaque provider state before durable storage and lookup."""

    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _pkce_challenge(verifier: str) -> str:
    """Return the RFC 7636 S256 challenge for one high-entropy verifier."""

    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _cookie_path(request: Request) -> str:
    """Match cookie creation/deletion to the externally visible ASGI root."""

    root_path = str(request.scope.get("root_path") or "").rstrip("/")
    return root_path or "/"


def _validated_return_to(request: Request, value: str | None) -> str:
    """Accept only a path inside the externally visible application root."""

    root_path = str(request.scope.get("root_path") or "").rstrip("/")
    candidate = value or root_path or "/"
    parsed = urlsplit(candidate)
    decoded_path = parsed.path
    for _ in range(3):
        further_decoded = unquote(decoded_path)
        if further_decoded == decoded_path:
            break
        decoded_path = further_decoded
    if (
        not candidate.startswith("/")
        or candidate.startswith("//")
        or "\\" in decoded_path
        or any(ord(character) < 32 for character in candidate + decoded_path)
        or any(part in {".", ".."} for part in decoded_path.split("/"))
        or parsed.scheme
        or parsed.netloc
        or (
            root_path
            and candidate != root_path
            and not candidate.startswith(f"{root_path}/")
        )
    ):
        raise InvalidInputError("Invalid return path")
    return candidate


def _set_session_cookie(
    response: Response,
    request: Request,
    issued: IssuedSession,
    sessions: SessionService,
) -> None:
    """Apply the complete hosted cookie contract in one place."""

    max_age = max(
        0,
        int(
            (issued.expires_at - datetime.now(issued.expires_at.tzinfo)).total_seconds()
        ),
    )
    response.set_cookie(
        SESSION_COOKIE_NAME,
        issued.session_token,
        max_age=max_age,
        expires=issued.expires_at,
        path=_cookie_path(request),
        secure=sessions.settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _delete_session_cookie(
    response: Response,
    request: Request,
    sessions: SessionService,
) -> None:
    """Delete with the exact path/security attributes used at creation."""

    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path=_cookie_path(request),
        secure=sessions.settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _providers(request: Request, sessions: SessionService) -> list[AuthProvider]:
    providers: list[AuthProvider] = []
    if sessions.settings.multi_user and sessions.settings.google_client_id:
        providers.append(
            AuthProvider(
                id="google",
                display_name="Google",
                entrypoint_url=route_path(request, "google_callback"),
            )
        )
    if sessions.settings.multi_user and sessions.settings.cilogon_client_id:
        providers.append(
            AuthProvider(
                id="cilogon",
                display_name="CILogon",
                entrypoint_url=route_path(request, "cilogon_login"),
            )
        )
    return providers


@router.get(
    "/session",
    response_model=SessionResponse,
    openapi_extra={"security": [{}, {"WordflowSession": []}]},
)
async def get_session(
    request: Request,
    response: Response,
    runtime: RuntimeDep,
) -> SessionResponse:
    """Return the complete no-store client bootstrap and session-bound CSRF token."""

    response.headers["Cache-Control"] = "no-store"
    sessions = runtime.session_service
    token = request.cookies.get(SESSION_COOKIE_NAME)
    principal = await sessions.current_principal(token)
    if not sessions.settings.multi_user:
        return SessionResponse(
            mode="single_user",
            authenticated=True,
            user=principal.user if principal is not None else None,
            providers=[],
            csrf_token=sessions.desktop_csrf_token,
        )
    return SessionResponse(
        mode="multi_user",
        authenticated=principal is not None,
        user=principal.user if principal is not None else None,
        providers=_providers(request, sessions),
        google_client_id=sessions.settings.google_client_id or None,
        csrf_token=(
            sessions.csrf_token_for_session(token)
            if principal is not None and token is not None
            else None
        ),
    )


@router.delete(
    "/session",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=api_errors(401, 403),
)
async def delete_session(
    request: Request,
    runtime: RuntimeDep,
    principal: OptionalSessionDep,
    token: SessionCookieDep = None,
) -> Response:
    """Revoke exactly the presented session, close its streams, and clear its cookie."""

    if runtime.settings.multi_user and principal is None:
        raise UnauthenticatedError("Authentication required")
    revoked_session_id = await runtime.session_service.revoke(token)
    if revoked_session_id is not None:
        await runtime.event_hub.close_session_streams(revoked_session_id)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _delete_session_cookie(response, request, runtime.session_service)
    return response


@router.post(
    "/auth/google/callback",
    response_class=RedirectResponse,
    status_code=status.HTTP_303_SEE_OTHER,
    responses=api_errors(400, 403, 422, 502),
)
async def google_callback(
    request: Request,
    credential: Annotated[str, Form()],
    g_csrf_token: Annotated[str, Form()],
    runtime: RuntimeDep,
    return_to: Annotated[str | None, Form()] = None,
) -> RedirectResponse:
    """Validate Google's double-submit callback and issue an HttpOnly session."""

    cookie_token = request.cookies.get("g_csrf_token")
    if not cookie_token or not hmac.compare_digest(cookie_token, g_csrf_token):
        raise AccessDeniedError("Google callback CSRF validation failed")
    redirect_target = _validated_return_to(request, return_to)
    user = await runtime.oauth_service.verify_google(credential)
    issued = await runtime.session_service.issue(user)
    response = RedirectResponse(
        url=redirect_target,
        status_code=status.HTTP_303_SEE_OTHER,
    )
    _set_session_cookie(response, request, issued, runtime.session_service)
    response.delete_cookie("g_csrf_token", path="/")
    return response


def _cilogon_redirect_uri(sessions: SessionService) -> str:
    """Return the startup-validated provider callback without Host inference."""

    configured = sessions.settings.cilogon_redirect_uri
    if not configured:
        raise InvalidInputError("CILogon authentication is not configured")
    return configured


@router.get(
    "/auth/cilogon/login",
    response_class=RedirectResponse,
    status_code=status.HTTP_302_FOUND,
    responses=api_errors(400, 422, 502),
)
async def cilogon_login(
    request: Request,
    runtime: RuntimeDep,
    return_to: str | None = Query(None),
) -> RedirectResponse:
    """Start CILogon with an opaque one-use persisted state transaction."""

    settings = runtime.settings
    if not settings.multi_user or not settings.cilogon_client_id:
        raise InvalidInputError("CILogon authentication is not configured")
    config = await runtime.oauth_service.cilogon_config()
    state_token = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    return_path = _validated_return_to(request, return_to)
    now = datetime.now(UTC)
    await runtime.database.create_oauth_transaction(
        state_hash=_token_hash(state_token),
        provider="cilogon",
        code_verifier=code_verifier,
        return_to=return_path,
        expires_at=int((now + timedelta(minutes=10)).timestamp()),
        created_at=now.isoformat(),
    )
    params = urlencode(
        {
            "response_type": "code",
            "client_id": settings.cilogon_client_id,
            "redirect_uri": _cilogon_redirect_uri(runtime.session_service),
            "scope": "openid email profile org.cilogon.userinfo",
            "state": state_token,
            "code_challenge": _pkce_challenge(code_verifier),
            "code_challenge_method": "S256",
        }
    )
    response = RedirectResponse(
        f"{config['authorization_endpoint']}?{params}",
        status_code=status.HTTP_302_FOUND,
    )
    return response


@router.get(
    "/auth/cilogon/callback",
    response_class=RedirectResponse,
    status_code=status.HTTP_303_SEE_OTHER,
    responses=api_errors(400, 403, 422, 502),
)
async def cilogon_callback(
    request: Request,
    runtime: RuntimeDep,
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
) -> RedirectResponse:
    """Validate state, complete the provider exchange, and issue a cookie."""

    if not state:
        raise AccessDeniedError("CILogon callback state validation failed")
    transaction = await runtime.database.consume_oauth_transaction(
        state_hash=_token_hash(state),
        provider="cilogon",
    )
    if transaction is None:
        raise AccessDeniedError("CILogon callback state validation failed")
    code_verifier, return_to = transaction
    if error or not code:
        raise InvalidInputError("CILogon authentication failed")
    user = await runtime.oauth_service.complete_cilogon(
        code=code,
        redirect_uri=_cilogon_redirect_uri(runtime.session_service),
        code_verifier=code_verifier,
    )
    issued = await runtime.session_service.issue(user)
    response = RedirectResponse(
        url=_validated_return_to(
            request,
            return_to,
        ),
        status_code=status.HTTP_303_SEE_OTHER,
    )
    _set_session_cookie(response, request, issued, runtime.session_service)
    return response
