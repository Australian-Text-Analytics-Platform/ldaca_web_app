"""Reusable error documentation scoped to individual API routers."""

from __future__ import annotations

from typing import Any

from fastapi import Request

from ..models.errors import ApiError


_DESCRIPTIONS = {
    400: "Invalid request",
    401: "Authentication required",
    403: "Origin, CSRF, or access check failed",
    404: "Resource not found",
    409: "Resource state conflict",
    410: "Retained artifact is no longer available",
    413: "Request or resource exceeds the configured size limit",
    415: "Request media type is unsupported",
    422: "Request validation failed",
    500: "Stored resource is corrupt",
    502: "Upstream provider unavailable",
    503: "Backend process capacity is exhausted",
    507: "Storage capacity is exhausted",
}


def api_errors(*status_codes: int) -> dict[int | str, dict[str, Any]]:
    """Build ApiError response metadata for statuses relevant to one router."""

    return {
        status_code: {
            "model": ApiError,
            "description": _DESCRIPTIONS[status_code],
        }
        for status_code in status_codes
    }


def route_path(request: Request, route_name: str, **path_params: object) -> str:
    """Return a named route's origin-relative path, including ASGI root_path.

    Keeping scheme and host out of stored/returned resource links prevents Host
    header injection while still making every link correct behind a prefix.
    """

    return request.url_for(route_name, **path_params).path


def route_path_with_query(
    request: Request,
    route_name: str,
    **query: object,
) -> str:
    """Return a root-path-aware named route with encoded query parameters."""

    url = request.url_for(route_name).include_query_params(**query)
    return f"{url.path}?{url.query}" if url.query else url.path


def workspace_etag(revision: int) -> str:
    """Format one strong Workspace Revision ETag."""

    return f'"{revision}"'


__all__ = ["api_errors", "route_path", "route_path_with_query", "workspace_etag"]
