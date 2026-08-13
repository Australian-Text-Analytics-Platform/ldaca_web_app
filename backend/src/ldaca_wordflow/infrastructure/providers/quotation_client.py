"""Runtime-owned HTTP client adapter for allowlisted quotation engines."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ...models.quotation import QuotationEngineType, ResolvedQuotationEngine

logger = logging.getLogger(__name__)

__all__ = [
    "QuotationProviderClient",
    "QuotationServiceError",
    "normalise_engine_base_url",
]


class QuotationServiceError(RuntimeError):
    """Raised when a configured quotation provider cannot satisfy a request."""


def normalise_engine_base_url(raw_url: str) -> str:
    """Normalise user-provided engine URL to the `/api/v1/quotation` root.

    Accepts roots that may already include `/api/v1/quotation` or `/extract` suffixes
    and trims redundant segments. Trailing slashes are stripped for consistency.

    Prevents endpoint concatenation bugs from configured provider URLs.
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


class QuotationProviderClient:
    """Runtime-owned connection pool for configured quotation providers."""

    def __init__(self, *, default_timeout: float) -> None:
        self._default_timeout = default_timeout
        self._client = httpx.AsyncClient(
            timeout=default_timeout,
            follow_redirects=False,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def extract(
        self,
        engine: ResolvedQuotationEngine,
        documents: dict[str, dict[str, Any]],
        *,
        options: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Call one allowlisted remote engine through the shared client pool."""

        if engine.type is not QuotationEngineType.REMOTE:
            raise QuotationServiceError(
                "Remote extraction requested with non-remote engine config"
            )
        if not engine.url:
            raise QuotationServiceError("Remote quotation engine URL is required")

        extract_url = f"{normalise_engine_base_url(str(engine.url))}/extract"
        payload: dict[str, Any] = {"documents": documents}
        if options:
            payload["options"] = options

        try:
            response = await self._client.post(
                extract_url,
                json=payload,
                timeout=timeout if timeout is not None else self._default_timeout,
            )
        except httpx.RequestError as exc:
            logger.error("Quotation service unreachable at %s: %s", engine.url, exc)
            raise QuotationServiceError("Failed to reach quotation service") from exc

        if response.status_code >= 400:
            detail: Any = response.text
            try:
                body = response.json()
                if isinstance(body, dict):
                    error = body.get("error")
                    if isinstance(error, dict):
                        detail = error.get("message", detail)
                    elif "message" in body:
                        detail = body["message"]
            except ValueError:
                pass
            logger.error(
                "Quotation service returned %d: %s",
                response.status_code,
                detail,
            )
            raise QuotationServiceError(
                f"Quotation service responded with {response.status_code}"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise QuotationServiceError(
                "Quotation service returned non-JSON response"
            ) from exc
        if not isinstance(payload, dict):
            raise QuotationServiceError("Quotation service returned invalid JSON")
        return payload
