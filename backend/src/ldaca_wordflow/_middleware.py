"""ASGI request-logging middleware.

Used by:
- ``main.py`` application startup.

Why:
- Logs every request with method, path, status, and wall-clock duration as
  structured JSON so operators can diagnose latency and errors without
  instrumenting individual route handlers.

Flow:
- Wrap ``app`` in ``RequestLoggingMiddleware``.
- On each request: capture start time, delegate to downstream ASGI app,
  capture end time, log the outcome at the appropriate level (INFO for 2xx/3xx,
  WARNING for 4xx, ERROR for 5xx).
"""

from __future__ import annotations

import logging
import re
import secrets
import time
from collections.abc import Mapping
from typing import Any, Callable, MutableMapping

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger("ldaca_wordflow.request")

REQUEST_ID_HEADER = b"x-request-id"
_REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")


def _request_id_from_scope(scope: Scope) -> str:
    """Return a valid caller request ID or generate an opaque replacement."""

    for name, raw_value in scope.get("headers", []):
        if name.lower() != REQUEST_ID_HEADER:
            continue
        try:
            value = raw_value.decode("ascii")
        except UnicodeDecodeError:
            break
        if _REQUEST_ID_PATTERN.fullmatch(value):
            return value
        break
    return secrets.token_hex(16)


class RequestLoggingMiddleware:
    """Log HTTP method, path, status, and duration for every request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status_code: int = 500
        request_id = _request_id_from_scope(scope)
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_wrapper(message: MutableMapping[str, Any]) -> None:
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = message["status"]
                headers = list(message.get("headers", []))
                headers = [
                    (name, value)
                    for name, value in headers
                    if name.lower() != REQUEST_ID_HEADER
                ]
                headers.append((REQUEST_ID_HEADER, request_id.encode("ascii")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            status_code = 500
            raise
        finally:
            duration_ms = (time.perf_counter() - start) * 1000
            log_fn: Callable[..., None]
            if status_code >= 500:
                log_fn = logger.error
            elif status_code >= 400:
                log_fn = logger.warning
            else:
                log_fn = logger.info
            log_fn(
                "%s %s → %s (%.1fms) request_id=%s",
                scope.get("method", "?"),
                scope.get("path", "?"),
                status_code,
                duration_ms,
                request_id,
            )


class PrivateApiCacheMiddleware:
    """Prevent shared/browser caches from retaining any API representation.

    Added around the complete API stack so JSON, redirects, errors, downloads,
    and streaming responses receive the same cookie-varying private policy.
    Static frontend assets and the public health probe remain unaffected.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not _normalized_path(scope).startswith("/api"):
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: MutableMapping[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers", []))
                vary_values: list[str] = []
                retained: list[tuple[bytes, bytes]] = []
                for name, value in headers:
                    lowered = name.lower()
                    if lowered == b"cache-control":
                        continue
                    if lowered == b"vary":
                        vary_values.extend(
                            part.strip()
                            for part in value.decode("latin-1").split(",")
                            if part.strip()
                        )
                        continue
                    retained.append((name, value))
                if not any(value.casefold() == "cookie" for value in vary_values):
                    vary_values.append("Cookie")
                retained.extend(
                    [
                        (b"cache-control", b"private, no-store"),
                        (b"vary", ", ".join(vary_values).encode("latin-1")),
                    ]
                )
                message["headers"] = retained
            await send(message)

        await self.app(scope, receive, send_wrapper)


def _normalized_path(scope: Scope) -> str:
    path = str(scope.get("path") or "/")
    root_path = str(scope.get("root_path") or "").rstrip("/")
    if root_path and (path == root_path or path.startswith(f"{root_path}/")):
        return path[len(root_path) :] or "/"
    return path


class _RequestBodyTooLarge(Exception):
    pass


class RequestBodyLimitMiddleware:
    """Bound selected request bodies before Starlette's multipart spooling.

    The receive wrapper counts actual ASGI bytes, so chunked bodies and lying
    Content-Length headers cannot bypass the configured route-specific limits.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        limits: Mapping[tuple[str, str], int],
        default_limit: int,
    ) -> None:
        self.app = app
        self.limits = {
            (method.upper(), path): limit for (method, path), limit in limits.items()
        }
        self.default_limit = default_limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        key = (str(scope.get("method", "GET")).upper(), _normalized_path(scope))
        limit = self.limits.get(key, self.default_limit)

        for name, value in scope.get("headers", []):
            if name.lower() != b"content-length":
                continue
            try:
                if int(value) > limit:
                    await self._reject(scope, receive, send)
                    return
            except ValueError:
                pass
            break

        received = 0

        async def limited_receive() -> MutableMapping[str, Any]:
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _RequestBodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _RequestBodyTooLarge:
            await self._reject(scope, receive, send)

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        state = scope.get("state", {})
        request_id = (
            str(state.get("request_id", "missing-request-id"))
            if isinstance(state, dict)
            else "missing-request-id"
        )
        await JSONResponse(
            status_code=413,
            content={
                "code": "request_body_too_large",
                "message": "Request body exceeds the configured limit",
                "request_id": request_id,
            },
            headers={"Connection": "close", "X-Request-ID": request_id},
        )(scope, receive, send)
