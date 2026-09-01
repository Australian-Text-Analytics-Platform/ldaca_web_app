"""Google GenAI Annotation adapter."""

from __future__ import annotations

from dataclasses import dataclass

from .annotation_adapter import (
    INFERENCE_TIMEOUT_SECONDS,
    MODEL_DISCOVERY_MAX_RETRIES,
    MODEL_DISCOVERY_TIMEOUT_SECONDS,
    AnnotationAiError,
    InferenceConfig,
    completion_error,
    max_completion_tokens,
    reasoning_budget_tokens,
)


def _strip_model_prefix(name: str) -> str:
    return name.removeprefix("models/")


@dataclass(frozen=True, slots=True)
class GoogleAnnotationAdapter:
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
                "Google requires an API key",
                code="annotation_provider_authentication_failed",
            )
        from google import genai
        from google.genai import types

        client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=int(INFERENCE_TIMEOUT_SECONDS * 1000),
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )
        thinking_config = (
            types.ThinkingConfig(
                thinking_budget=reasoning_budget_tokens(config.reasoning_effort)
            )
            if config.reasoning_enabled
            else None
        )
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=config.temperature,
                    max_output_tokens=max_completion_tokens(config),
                    response_mime_type="application/json",
                    thinking_config=thinking_config,
                ),
            )
        except Exception as error:  # noqa: BLE001 - normalize SDK failure shapes
            raise completion_error(error, "Google request failed") from error
        return response.text or ""

    async def list_models(self, api_key: str | None) -> list[str]:
        if api_key is None:
            raise AnnotationAiError(
                "Google requires an API key",
                code="annotation_provider_authentication_failed",
            )
        from google import genai
        from google.genai import types

        client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=int(MODEL_DISCOVERY_TIMEOUT_SECONDS * 1000),
                retry_options=types.HttpRetryOptions(
                    attempts=MODEL_DISCOVERY_MAX_RETRIES + 1
                ),
            ),
        )
        ids: set[str] = set()
        try:
            async for model in await client.aio.models.list():
                if isinstance(model.name, str) and model.name:
                    ids.add(_strip_model_prefix(model.name))
        except Exception as error:  # noqa: BLE001 - normalize SDK failure shapes
            raise completion_error(error, "Model listing failed") from error
        return sorted(ids, key=str.lower)


__all__ = ["GoogleAnnotationAdapter"]
