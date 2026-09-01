"""Provider discovery preserves classified failures and diagnostics."""

from __future__ import annotations

import uuid
from typing import cast

import pytest

from ldaca_wordflow.infrastructure.providers.annotation_ai import AnnotationAiError
from ldaca_wordflow.models.annotations import AnnotationModelsRequest
from ldaca_wordflow.services.annotations import AnnotationService
from ldaca_wordflow.services.provider_credentials import ProviderCredentialStore
from ldaca_wordflow.shared.errors import AnnotationProviderError


class _Credentials:
    """Minimal credential resolver used by ``AnnotationService`` unit probes."""

    async def resolve_annotation_provider(self, _request, *, supplied=None):
        return "saved-key"


@pytest.mark.parametrize(
    "code",
    [
        "annotation_provider_authentication_failed",
        "annotation_provider_access_denied",
        "annotation_provider_rate_limited",
        "annotation_provider_request_rejected",
        "annotation_provider_unavailable",
        "annotation_provider_context_limit",
        "annotation_provider_invalid_response",
        "annotation_provider_failed",
    ],
)
async def test_model_discovery_maps_each_provider_category_to_diagnostic_502(
    monkeypatch,
    code,
) -> None:
    class _FailingAdapter:
        async def complete(self, *_args, **_kwargs):
            raise AssertionError("model discovery must not run completion")

        async def list_models(self, _api_key):
            raise AnnotationAiError("private SDK body https://secret.invalid", code=code)

    monkeypatch.setattr(
        "ldaca_wordflow.services.annotations.resolve_provider_adapter",
        lambda *_args: _FailingAdapter(),
    )
    service = AnnotationService(
        credentials=cast("ProviderCredentialStore", _Credentials())
    )
    request = AnnotationModelsRequest(
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
    )

    with pytest.raises(AnnotationProviderError) as exc_info:
        await service.models(request)

    assert exc_info.value.status_code == 502
    assert exc_info.value.code == code
    assert exc_info.value.message == "private SDK body https://secret.invalid"
