"""Cookie authentication dependencies and unsafe-request CSRF/Origin guard.

Protected operations use ``APIKeyCookie`` through ``Security`` so OpenAPI
describes the actual transport. The ASGI middleware covers every unsafe API
method centrally, exempting only the Google provider callback that carries its
own double-submit token.
"""

from __future__ import annotations

from typing import Annotated, cast
from urllib.parse import urlsplit

from fastapi import Depends, Request, Security
from fastapi.security import APIKeyCookie
from starlette.datastructures import Headers
from starlette.requests import Request as StarletteRequest
from starlette.types import ASGIApp, Receive, Scope, Send

from .._middleware import normalized_scope_path
from ..models.session import SessionUser
from ..runtime import Runtime, RuntimeManager, get_runtime
from ..services.sessions import SessionPrincipal
from ..shared.errors import UnauthenticatedError
from .error_response import api_error_response

SESSION_COOKIE_NAME = "wordflow_session"
session_cookie = APIKeyCookie(
    name=SESSION_COOKIE_NAME,
    scheme_name="WordflowSession",
    description="HttpOnly hosted-browser session cookie",
    auto_error=False,
)
SessionCookieDep = Annotated[str | None, Security(session_cookie)]


async def get_optional_session(
    request: Request,
    token: SessionCookieDep = None,
) -> SessionPrincipal | None:
    """Resolve the current cookie/process identity without requiring login."""

    return await get_runtime(request).session_service.current_principal(token)


OptionalSessionSecurityDep = Annotated[
    SessionPrincipal | None,
    Security(get_optional_session),
]


async def get_current_session(
    principal: OptionalSessionSecurityDep,
) -> SessionPrincipal:
    """Require an authenticated hosted session or desktop process identity."""

    if principal is None:
        raise UnauthenticatedError("Authentication required")
    return principal


CurrentSessionSecurityDep = Annotated[
    SessionPrincipal,
    Security(get_current_session),
]


async def get_current_user(
    principal: CurrentSessionSecurityDep,
) -> SessionUser:
    """Return the typed identity consumed by protected route adapters."""

    return principal.user


OptionalSessionDep = Annotated[
    SessionPrincipal | None,
    Depends(get_optional_session),
]
CurrentUserDep = Annotated[SessionUser, Depends(get_current_user)]


class CsrfOriginMiddleware:
    """Reject every unsafe API request lacking exact Origin and CSRF proof."""

    _unsafe_methods = {"POST", "PUT", "PATCH", "DELETE"}
    _provider_exemptions = {("POST", "/api/auth/google/callback")}

    def __init__(self, app: ASGIApp, *, allowed_origins: tuple[str, ...]) -> None:
        self.app = app
        canonical_origins: set[str] = set()
        for raw in allowed_origins:
            canonical = _canonical_origin(raw)
            if canonical is None:
                raise ValueError(f"Invalid allowed Origin: {raw}")
            canonical_origins.add(canonical)
        self.allowed_origins = frozenset(canonical_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        method = str(scope.get("method", "GET")).upper()
        path = normalized_scope_path(scope)
        if (
            method not in self._unsafe_methods
            or not path.startswith("/api")
            or (method, path) in self._provider_exemptions
        ):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        request_id = cast(dict[str, object], scope.get("state", {})).get(
            "request_id", "missing-request-id"
        )
        origin = _canonical_origin(headers.get("origin"))
        request_origin = _canonical_origin(
            f"{scope.get('scheme', 'http')}://{headers.get('host', '')}"
        )
        if origin is None or (
            origin != request_origin and origin not in self.allowed_origins
        ):
            await api_error_response(
                request_id=str(request_id),
                status_code=403,
                code="origin_not_allowed",
                message="Request origin is not allowed",
            )(scope, receive, send)
            return

        state = cast(dict[str, object], scope.get("state", {}))
        manager = state.get("runtime_manager")
        if path == "/api/data-root":
            if not isinstance(manager, RuntimeManager) or not manager.validate_change_token(
                headers.get("x-data-root-token")
            ):
                await api_error_response(
                    request_id=str(request_id),
                    status_code=403,
                    code="csrf_failed",
                    message="CSRF validation failed",
                )(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return

        runtime = state.get("runtime")
        if not isinstance(runtime, Runtime):
            await api_error_response(
                request_id=str(request_id),
                status_code=503,
                code="runtime_unavailable",
                message="The Data Root runtime is not ready",
            )(scope, receive, send)
            return
        request = StarletteRequest(scope, receive=receive)
        csrf_valid = await runtime.session_service.validate_csrf(
            request.cookies.get(SESSION_COOKIE_NAME),
            headers.get("x-csrf-token"),
        )
        if not csrf_valid:
            await api_error_response(
                request_id=str(request_id),
                status_code=403,
                code="csrf_failed",
                message="CSRF validation failed",
            )(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _canonical_origin(raw: str | None) -> str | None:
    """Return an exact scheme/host/port origin without path components."""

    if not raw:
        return None
    parsed = urlsplit(raw)
    if (
        parsed.scheme not in {"http", "https", "tauri"}
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    host = parsed.hostname.casefold().rstrip(".")
    rendered_host = f"[{host}]" if ":" in host else host
    default_port = (
        80 if parsed.scheme == "http" else 443 if parsed.scheme == "https" else None
    )
    rendered_port = f":{port}" if port is not None and port != default_port else ""
    return f"{parsed.scheme}://{rendered_host}{rendered_port}"


class ExactHostMiddleware:
    """Reject DNS-rebinding and Host-header aliases before public endpoints."""

    def __init__(self, app: ASGIApp, *, trusted_hosts: tuple[str, ...]) -> None:
        self.app = app
        self.trusted_hosts = frozenset(host.casefold() for host in trusted_hosts)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        request = StarletteRequest(scope)
        host = (request.url.hostname or "").casefold().rstrip(".")
        if host in self.trusted_hosts:
            await self.app(scope, receive, send)
            return
        state = cast(dict[str, object], scope.get("state", {}))
        request_id = str(state.get("request_id", "missing-request-id"))
        await api_error_response(
            request_id=request_id,
            status_code=400,
            code="host_not_allowed",
            message="Request host is not allowed",
        )(scope, receive, send)
