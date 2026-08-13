"""Helpers for serving the packaged React SPA."""

import json
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from starlette.responses import Response

logger = logging.getLogger(__name__)


def _get_frontend_build_dir() -> Path:
    """Locate the packaged frontend build directory."""
    from importlib import resources

    pkg = resources.files("ldaca_wordflow.resources.frontend")
    build_dir = Path(str(pkg / "build"))
    if not build_dir.is_dir():
        logger.error("Frontend build not found at %s", build_dir)
        logger.error(
            "Run `pnpm -C frontend build` and then `pnpm deploy_frontend_to_backend`."
        )
        raise FileNotFoundError(f"Frontend build not found at {build_dir}")
    return build_dir


def _normalized_root_path(root_path: str | None) -> str:
    """Normalize ASGI root_path for frontend runtime config."""
    return (root_path or "").rstrip("/")


def _runtime_config_js(root_path: str | None) -> str:
    """Return the non-sensitive request-time SPA bootstrap payload.

    Provider/auth metadata is session state and comes from ``GET /api/session``;
    this static bootstrap only adapts reverse-proxy path mounting.
    """

    config = {"basePath": _normalized_root_path(root_path)}
    return f"window.__WORDFLOW_CONFIG__ = {json.dumps(config)};"


def _mount_frontend(target_app: FastAPI) -> None:
    """Attach packaged frontend routes once during application construction."""
    build_dir = _get_frontend_build_dir()

    @target_app.get("/runtime-config.js", include_in_schema=False)
    async def _runtime_config(request: Request):
        return Response(
            _runtime_config_js(request.scope.get("root_path")),
            media_type="application/javascript",
            headers={"Cache-Control": "no-store"},
        )

    target_app.frontend("/", directory=str(build_dir), fallback="index.html")
