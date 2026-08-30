"""Anthropic Annotation adapter."""

from __future__ import annotations

from dataclasses import dataclass

from .annotation_adapter import (
    ANSWER_TOKEN_HEADROOM,
    MODEL_DISCOVERY_MAX_RETRIES,
    REQUEST_TIMEOUT_SECONDS,
    AnnotationAiError,
    InferenceConfig,
    completion_error,
    reasoning_budget_tokens,
)


@dataclass(frozen=True, slots=True)
class AnthropicAnnotationAdapter:
    async def complete(
        self,
        model: str,
        api_key: str | None,
        system: str,
        user: str,
        config: InferenceConfig,
    ) -> str:
        if api_key is None:
            raise AnnotationAiError(
                "Anthropic requires an API key",
                code="annotation_provider_authentication_failed",
            )
        from anthropic import AsyncAnthropic, Omit, omit
        from anthropic.types import TextBlock, ThinkingConfigParam

        client = AsyncAnthropic(
            api_key=api_key,
            timeout=REQUEST_TIMEOUT_SECONDS,
            max_retries=0,
        )
        max_tokens = ANSWER_TOKEN_HEADROOM
        thinking: ThinkingConfigParam | Omit = omit
        if config.reasoning_enabled:
            budget = reasoning_budget_tokens(config.reasoning_effort)
            max_tokens = budget + ANSWER_TOKEN_HEADROOM
            thinking = {"type": "enabled", "budget_tokens": budget}
        try:
            message = await client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                thinking=thinking,
            )
        except Exception as error:  # noqa: BLE001 - normalize SDK failure shapes
            raise completion_error(error, "Anthropic request failed") from error
        return "".join(
            block.text for block in message.content if isinstance(block, TextBlock)
        )

    async def list_models(self, api_key: str | None) -> list[str]:
        if api_key is None:
            raise AnnotationAiError(
                "Anthropic requires an API key",
                code="annotation_provider_authentication_failed",
            )
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(
            api_key=api_key,
            timeout=REQUEST_TIMEOUT_SECONDS,
            max_retries=MODEL_DISCOVERY_MAX_RETRIES,
        )
        ids: set[str] = set()
        try:
            async for model in client.models.list():
                if isinstance(model.id, str) and model.id:
                    ids.add(model.id)
        except Exception as error:  # noqa: BLE001 - normalize SDK failure shapes
            raise completion_error(error, "Model listing failed") from error
        return sorted(ids, key=str.lower)


__all__ = ["AnthropicAnnotationAdapter"]
