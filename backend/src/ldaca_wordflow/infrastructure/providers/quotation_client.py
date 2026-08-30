"""Runtime-owned HTTP client adapter for allowlisted quotation engines."""

from __future__ import annotations

import logging
import httpx
from pydantic import ValidationError

from ...models.quotation import (
    RemoteQuotationDocument,
    RemoteQuotationExtractRequest,
    RemoteQuotationExtractResponse,
    RemoteResolvedQuotationEngine,
)

logger = logging.getLogger(__name__)

__all__ = [
    "QuotationProviderClient",
    "QuotationServiceError",
]


class QuotationServiceError(RuntimeError):
    """Raised when a configured quotation provider cannot satisfy a request."""


class QuotationProviderClient:
    """Runtime-owned connection pool for configured quotation providers."""

    def __init__(self, *, default_timeout: float) -> None:
        self._client = httpx.AsyncClient(
            timeout=default_timeout,
            follow_redirects=False,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def extract(
        self,
        engine: RemoteResolvedQuotationEngine,
        documents: list[RemoteQuotationDocument],
    ) -> RemoteQuotationExtractResponse:
        """Call one allowlisted remote engine through the shared client pool."""

        extract_url = f"{str(engine.url).rstrip('/')}/api/v2/quotation/extract"
        request = RemoteQuotationExtractRequest(version=2, documents=documents)

        try:
            response = await self._client.post(
                extract_url,
                json=request.model_dump(mode="json"),
            )
        except httpx.RequestError as exc:
            logger.error("Quotation service unreachable at %s: %s", engine.url, exc)
            raise QuotationServiceError("Failed to reach quotation service") from exc

        if response.status_code >= 400:
            logger.error(
                "Quotation service returned status=%d",
                response.status_code,
            )
            raise QuotationServiceError(
                f"Quotation service responded with {response.status_code}"
            )

        try:
            return RemoteQuotationExtractResponse.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise QuotationServiceError(
                "Quotation service returned an invalid v2 response"
            ) from exc
