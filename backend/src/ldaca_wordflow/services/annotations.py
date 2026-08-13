"""Annotation provider-discovery application service."""

from __future__ import annotations

from ..infrastructure.providers.annotation_ai import (
    AnnotationAiError,
    list_models,
    resolve_provider_wire,
)
from ..shared.errors import (
    AnnotationProviderError,
)
from ..models.annotations import (
    AnnotationModelsRequest,
    AnnotationModelsResource,
)
from .provider_credentials import ProviderCredentialStore


class AnnotationService:
    """Own Annotation provider discovery outside FastAPI routers."""

    def __init__(
        self,
        *,
        credentials: ProviderCredentialStore,
    ) -> None:
        self._credentials = credentials

    async def models(
        self,
        request: AnnotationModelsRequest,
    ) -> AnnotationModelsResource:
        """List models for one verified built-in or trusted Custom configuration."""

        api_key = await self._credentials.resolve_annotation_provider(
            request,
            supplied=request.api_key,
        )
        try:
            discovered = await list_models(
                resolve_provider_wire(request.provider, request.provider_base_url),
                api_key,
            )
        except AnnotationAiError as exc:
            raise AnnotationProviderError(exc.code, exc.safe_message) from exc
        return AnnotationModelsResource(
            provider_configuration_id=request.provider_configuration_id,
            provider=request.provider,
            provider_base_url=request.provider_base_url,
            models=discovered,
        )

__all__ = ["AnnotationService"]
