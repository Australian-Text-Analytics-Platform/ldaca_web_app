"""Single error-envelope encoder for handlers and ASGI middleware."""

from __future__ import annotations

from collections.abc import Mapping

from fastapi.responses import JSONResponse

from ..models.errors import ApiError
from ..shared.json_data import JsonData


def api_error_response(
    *,
    request_id: str,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, JsonData] | list[dict[str, JsonData]] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    """Encode the canonical public error without inspecting request content.

    Used by FastAPI exception handlers and low-level Host/CSRF middleware. The
    caller supplies the selected message and correlation ID, keeping
    all HTTP failure paths structurally identical without coupling domain errors
    to FastAPI.
    """

    payload = ApiError(
        code=code,
        message=message,
        details=details,
        request_id=request_id,
    )
    response_headers = dict(headers) if headers is not None else {}
    response_headers.setdefault("X-Request-ID", request_id)
    return JSONResponse(
        status_code=status_code,
        content=payload.model_dump(exclude_none=True),
        headers=response_headers,
    )


__all__ = ["api_error_response"]
