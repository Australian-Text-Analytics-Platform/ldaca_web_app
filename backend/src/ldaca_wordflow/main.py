"""FastAPI application factory and HTTP-boundary configuration.

Used by:
- Uvicorn/Tauri launchers, OpenAPI export, and tests that need independently
  configured application instances.

Flow:
- callers pass one immutable settings snapshot and a runtime context factory;
- application construction registers only routes, middleware, and handlers;
- FastAPI lifespan invokes the runtime factory, copies its value into typed
  request state, and guarantees teardown; and
- HTTP-only concerns (request IDs, safe errors, CORS, status codes, and optional
  frontend mounting) stay at this boundary.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from importlib.metadata import version
from typing import Any, Literal, cast

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ._middleware import (
    PrivateApiCacheMiddleware,
    RequestBodyLimitMiddleware,
    RequestLoggingMiddleware,
)
from .api.auth import router as auth_router
from .api.annotations import router as annotations_router
from .api.data_portal import router as data_portal_router
from .api.provider_credentials import router as provider_credentials_router
from .api.preferences import router as preferences_router
from .api.error_response import api_error_response
from .api.events import router as events_router
from .api.files import router as files_router
from .api.security import CsrfOriginMiddleware, ExactHostMiddleware
from .api.sample_data import router as sample_data_router
from .api.storage import router as storage_router
from .api.tokenizers import router as tokenizers_router
from .api.user_file_imports import router as user_file_imports_router
from .api.workspaces import router as workspaces_router
from .shared.errors import AppError
from .shared.json_data import JsonData
from .runtime import LifespanState, Runtime, get_runtime, runtime_context
from .settings import Settings

logger = logging.getLogger(__name__)


__version__ = version("ldaca-wordflow")

RuntimeContextFactory = Callable[[Settings], AbstractAsyncContextManager[Runtime]]


class HealthResponse(BaseModel):
    """Minimal public readiness payload for probes and uptime monitors."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ready", "stopping"]
    version: str


def generate_operation_id(route: APIRoute) -> str:
    """Use explicit route names as stable generated-client operation IDs."""

    return route.name


def _request_id(request: Request) -> str:
    """Read the request identity installed by ``RequestLoggingMiddleware``."""

    return cast(str, request.state.request_id)


async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Map framework-neutral domain failures into the public error contract."""

    if exc.status_code >= 500 and not exc.expose_message:
        logger.error(
            "Domain service failure code=%s request_id=%s",
            exc.code,
            _request_id(request),
            exc_info=exc,
        )
        message = (
            "Internal server error"
            if exc.status_code == 500
            else "Upstream service error"
        )
        details = None
    else:
        message = exc.message
        details = exc.details
    return api_error_response(
        request_id=_request_id(request),
        status_code=exc.status_code,
        code=exc.code,
        message=message,
        details=details,
        headers=exc.headers,
    )


async def _validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return validation metadata without echoing bodies, inputs, or secrets."""

    details: list[dict[str, JsonData]] = []
    for error in exc.errors():
        location: list[JsonData] = [
            part if isinstance(part, str | int) else str(part)
            for part in error.get("loc", ())
        ]
        details.append(
            {
                "location": location,
                "type": str(error.get("type", "validation_error")),
                "message": str(error.get("msg", "Invalid value")),
            }
        )
    return api_error_response(
        request_id=_request_id(request),
        status_code=422,
        code="request_validation_failed",
        message="Request validation failed",
        details=details,
    )


async def _unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log unexpected exceptions and expose no internal implementation text."""

    logger.exception(
        "Unhandled request failure request_id=%s",
        _request_id(request),
        exc_info=exc,
    )
    return api_error_response(
        request_id=_request_id(request),
        status_code=500,
        code="internal_server_error",
        message="Internal server error",
    )


class _UnexpectedErrorMiddleware:
    """Render unhandled failures inside the normal CORS and cache boundary."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            if response_started:
                raise
            response = await _unexpected_error_handler(Request(scope), exc)
            await response(scope, receive, send)


async def _http_error_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    """Normalize every framework-generated status without leaking its detail."""

    code, message = {
        400: ("bad_request", "Bad request"),
        401: ("unauthenticated", "Authentication required"),
        403: ("access_denied", "Access denied"),
        404: ("not_found", "Resource not found"),
        405: ("method_not_allowed", "Method not allowed"),
        413: ("request_body_too_large", "Request body is too large"),
        415: ("unsupported_media_type", "Unsupported media type"),
    }.get(exc.status_code, ("http_error", "Request failed"))
    return api_error_response(
        request_id=_request_id(request),
        status_code=exc.status_code,
        code=code,
        message=message,
        headers=exc.headers,
    )


def _register_routers(app: FastAPI) -> None:
    """Attach API routers in one deterministic order."""

    for router in (
        auth_router,
        annotations_router,
        data_portal_router,
        preferences_router,
        provider_credentials_router,
        events_router,
        files_router,
        sample_data_router,
        storage_router,
        tokenizers_router,
        user_file_imports_router,
        workspaces_router,
    ):
        app.include_router(router, prefix="/api")


def create_app(
    settings: Settings,
    runtime_context_factory: RuntimeContextFactory = runtime_context,
    *,
    serve_frontend: bool = True,
) -> FastAPI:
    """Construct a side-effect-free FastAPI application.

    Args:
        settings: Immutable configuration snapshot owned by this app instance.
        runtime_context_factory: Factory called only after lifespan starts. Its
            async context manager owns all stateful resources and teardown.
        serve_frontend: Mount the packaged SPA and fallback when true. OpenAPI
            export disables this so schema construction never probes assets.
    """

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[LifespanState]:
        async with runtime_context_factory(settings) as runtime:
            yield LifespanState(runtime=runtime)

    app = FastAPI(
        title="LDaCA Wordflow API",
        version=__version__,
        description="Workspace-oriented text analysis API",
        lifespan=lifespan,
        generate_unique_id_function=generate_operation_id,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    app.add_exception_handler(AppError, cast(Any, _app_error_handler))
    app.add_exception_handler(
        RequestValidationError, cast(Any, _validation_error_handler)
    )
    app.add_exception_handler(StarletteHTTPException, cast(Any, _http_error_handler))
    app.add_exception_handler(Exception, cast(Any, _unexpected_error_handler))

    app.add_middleware(
        cast(Any, CsrfOriginMiddleware),
        allowed_origins=settings.get_allowed_origins(),
    )
    app.add_middleware(
        cast(Any, ExactHostMiddleware),
        trusted_hosts=settings.get_trusted_hosts(),
    )
    app.add_middleware(
        cast(Any, RequestBodyLimitMiddleware),
        default_limit=settings.max_default_request_body_bytes,
        limits={
            ("POST", "/api/user-files/uploads"): (settings.max_file_upload_bytes),
            ("POST", "/api/workspaces/imports"): (settings.max_workspace_archive_bytes),
        },
    )
    # Specialized middleware handles its own sentinels first; anything that
    # still escapes is rendered before CORS/cache decorate the response.
    app.add_middleware(cast(Any, _UnexpectedErrorMiddleware))
    app.add_middleware(
        cast(Any, CORSMiddleware),
        allow_origins=list(settings.get_allowed_origins()),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Accept",
            "Content-Type",
            "X-CSRF-Token",
            "X-Request-ID",
        ],
        expose_headers=[
            "ETag",
            "Location",
            "X-Request-ID",
            "X-Wordflow-Has-Next",
            "X-Wordflow-Total-Rows",
        ],
    )
    app.add_middleware(cast(Any, PrivateApiCacheMiddleware))
    # Added last so request identity wraps CORS and every exception response.
    app.add_middleware(cast(Any, RequestLoggingMiddleware))

    _register_routers(app)

    @app.get(
        "/health",
        response_model=HealthResponse,
        response_model_exclude_none=True,
        responses={503: {"model": HealthResponse, "description": "Stopping"}},
        tags=["health"],
    )
    async def health_check(request: Request, response: Response) -> HealthResponse:
        """Report only process readiness and the installed package version."""

        status = get_runtime(request).readiness.status
        if status == "stopping":
            response.status_code = 503
        return HealthResponse(status=status, version=__version__)

    if serve_frontend:
        from .spa import _mount_frontend

        _mount_frontend(app)

    return app
