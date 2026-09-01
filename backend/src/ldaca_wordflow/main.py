"""FastAPI application factory and HTTP-boundary configuration.

Used by:
- Uvicorn/Tauri launchers, OpenAPI export, and tests that need independently
  configured application instances.

Flow:
- callers pass one immutable settings snapshot and a runtime context factory;
- application construction registers only routes, middleware, and handlers;
- FastAPI lifespan invokes the runtime factory, copies its value into typed
  request state, and guarantees teardown; and
- HTTP-only concerns (request IDs, diagnostic errors, CORS, status codes, and optional
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
from .api.data_root import router as data_root_router
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
from .shared.errors import AppError, format_exception_diagnostic
from .shared.json_data import JsonData
from .runtime import (
    LifespanState,
    Runtime,
    RuntimeManager,
    RuntimeManagerState,
    get_runtime_manager,
    runtime_context,
    runtime_manager_context,
)
from .settings import Settings
from .data_root_config import DataRootConfigStore
from .shared.errors import RuntimeUnavailableError

logger = logging.getLogger(__name__)


__version__ = version("ldaca-wordflow")

RuntimeContextFactory = Callable[[Settings], AbstractAsyncContextManager[Runtime]]


class LivenessResponse(BaseModel):
    """Minimal public process-liveness payload."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["live"]
    version: str


class ReadinessResponse(BaseModel):
    """Public Runtime readiness without component or filesystem details."""

    model_config = ConfigDict(extra="forbid")

    status: RuntimeManagerState
    version: str


def generate_operation_id(route: APIRoute) -> str:
    """Use explicit route names as stable generated-client operation IDs."""

    return route.name


def _request_id(request: Request) -> str:
    """Read the request identity installed by ``RequestLoggingMiddleware``."""

    return cast(str, request.state.request_id)


async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Map framework-neutral domain failures into the public error contract."""

    if exc.status_code >= 500:
        logger.error(
            "Domain service failure code=%s request_id=%s",
            exc.code,
            _request_id(request),
            exc_info=exc,
        )
        message = format_exception_diagnostic(exc)
    else:
        message = exc.message
    return api_error_response(
        request_id=_request_id(request),
        status_code=exc.status_code,
        code=exc.code,
        message=message,
        details=exc.details,
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
    """Log unexpected exceptions and expose their type and message."""

    logger.exception(
        "Unhandled request failure request_id=%s",
        _request_id(request),
        exc_info=exc,
    )
    return api_error_response(
        request_id=_request_id(request),
        status_code=500,
        code="internal_server_error",
        message=format_exception_diagnostic(exc),
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


class _RuntimeLeaseMiddleware:
    """Pin finite API requests to one Runtime while a root switch drains."""

    _control_paths = {"/api/data-root", "/api/openapi.json"}
    _control_prefixes = ("/api/docs", "/api/redoc")

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = self._route_path(scope)
        if (
            not path.startswith("/api")
            or path in self._control_paths
            or path.startswith(self._control_prefixes)
        ):
            await self.app(scope, receive, send)
            return
        state = cast(dict[str, object], scope.setdefault("state", {}))
        manager = state.get("runtime_manager")
        if not isinstance(manager, RuntimeManager):
            await self.app(scope, receive, send)
            return
        try:
            if path == "/api/events":
                state["runtime"] = manager.current_runtime()
                await self.app(scope, receive, send)
                return
            async with manager.lease() as runtime:
                state["runtime"] = runtime
                await self.app(scope, receive, send)
        except RuntimeUnavailableError:
            request_id = str(state.get("request_id", "missing-request-id"))
            await api_error_response(
                request_id=request_id,
                status_code=503,
                code="runtime_unavailable",
                message="The Data Root runtime is not ready",
            )(scope, receive, send)

    @staticmethod
    def _route_path(scope: Scope) -> str:
        path = str(scope.get("path") or "/")
        root_path = str(scope.get("root_path") or "").rstrip("/")
        if root_path and (path == root_path or path.startswith(f"{root_path}/")):
            return path[len(root_path) :] or "/"
        return path


async def _http_error_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    """Normalize framework statuses while retaining diagnostics for 5xx errors."""

    code, message = {
        400: ("bad_request", "Bad request"),
        401: ("unauthenticated", "Authentication required"),
        403: ("access_denied", "Access denied"),
        404: ("not_found", "Resource not found"),
        405: ("method_not_allowed", "Method not allowed"),
        413: ("request_body_too_large", "Request body is too large"),
        415: ("unsupported_media_type", "Unsupported media type"),
    }.get(exc.status_code, ("http_error", "Request failed"))
    if exc.status_code >= 500:
        message = format_exception_diagnostic(exc)
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
        data_root_router,
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
    data_root_config_store: DataRootConfigStore | None = None,
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
        async with runtime_manager_context(
            settings,
            runtime_context_factory,
            config_store=data_root_config_store,
        ) as manager:
            yield LifespanState(runtime_manager=manager)

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
    app.add_middleware(cast(Any, _RuntimeLeaseMiddleware))
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
            "X-Data-Root-Token",
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
        "/health/live",
        response_model=LivenessResponse,
        tags=["health"],
        name="liveness_check",
    )
    async def liveness_check() -> LivenessResponse:
        """Report that the HTTP control plane is responsive."""

        return LivenessResponse(status="live", version=__version__)

    @app.get(
        "/health/ready",
        response_model=ReadinessResponse,
        responses={503: {"model": ReadinessResponse, "description": "Not ready"}},
        tags=["health"],
        name="readiness_check",
    )
    async def readiness_check(
        request: Request,
        response: Response,
    ) -> ReadinessResponse:
        """Report whether the complete Data Root Runtime accepts requests."""

        status = get_runtime_manager(request).state
        if status != "ready":
            response.status_code = 503
        return ReadinessResponse(status=status, version=__version__)

    if serve_frontend:
        from .spa import _mount_frontend

        _mount_frontend(app)

    return app
