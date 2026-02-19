"""Remote quotation engine client utilities."""

from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

from ...models import QuotationEngineConfig, QuotationEngineType
from ...settings import settings

__all__ = [
    "QuotationServiceError",
    "normalise_engine_base_url",
    "extract_remote_quotations",
]


class QuotationServiceError(RuntimeError):
    """Raised when remote quotation extraction fails.

    Used by:
    - quotation core/worker paths calling remote extraction

    Why:
    - Provides a domain-specific error type for consistent API translation.
    """


def normalise_engine_base_url(raw_url: str) -> str:
    """Normalise user-provided engine URL to the `/api/v1/quotation` root.

    Accepts roots that may already include `/api/v1/quotation` or `/extract` suffixes
    and trims redundant segments. Trailing slashes are stripped for consistency.

    Used by:
    - `extract_remote_quotations`

    Why:
    - Prevents endpoint concatenation bugs from user-supplied base URLs.
    """

    base = (raw_url or "").strip()
    if not base:
        raise ValueError("Quotation engine URL cannot be empty")

    base = base.rstrip("/")

    # Remove terminal endpoint fragments so we always target the API root
    if base.endswith("/extract"):
        base = base[: -len("/extract")]
    if base.endswith("/health"):
        base = base[: -len("/health")]

    if not base.endswith("/api/v1/quotation"):
        base = f"{base}/api/v1/quotation"

    return base.rstrip("/")


async def extract_remote_quotations(
    engine: QuotationEngineConfig,
    documents: Dict[str, Dict[str, Any]],
    *,
    options: Optional[Dict[str, Any]] = None,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """Call remote quotation extraction API and return decoded JSON payload.

    Used by:
    - `quotation_core.extract_remote_paginated`

    Why:
    - Encapsulates transport, timeout, and error normalization for remote engine calls.

    Refactor note:
    - If additional remote analysis engines are added, consider a shared HTTP
        client abstraction to consolidate retry/auth/error policy.
    """

    if engine.type is not QuotationEngineType.REMOTE:
        raise QuotationServiceError(
            "Remote extraction requested with non-remote engine config"
        )
    if not engine.url:
        raise QuotationServiceError("Remote quotation engine URL is required")

    base_url = normalise_engine_base_url(str(engine.url))
    extract_url = f"{base_url}/extract"

    payload: Dict[str, Any] = {"documents": documents}
    if options:
        payload["options"] = options

    request_timeout = (
        timeout if timeout is not None else settings.quotation_service_timeout
    )

    try:
        async with httpx.AsyncClient(
            timeout=request_timeout, follow_redirects=True
        ) as client:
            response = await client.post(extract_url, json=payload)
    except httpx.RequestError as exc:
        raise QuotationServiceError(
            f"Failed to reach quotation service at {engine.url}: {exc}"
        ) from exc

    if response.status_code >= 400:
        detail: Any = response.text
        try:
            body = response.json()
            if isinstance(body, dict):
                if isinstance(body.get("error"), dict):
                    detail = body["error"].get("message", detail)
                elif "message" in body:
                    detail = body["message"]
        except ValueError:
            pass
        raise QuotationServiceError(
            f"Quotation service responded with {response.status_code}: {detail}"
        )

    try:
        return response.json()
    except ValueError as exc:  # pragma: no cover - unexpected payload
        raise QuotationServiceError(
            "Quotation service returned non-JSON response"
        ) from exc
