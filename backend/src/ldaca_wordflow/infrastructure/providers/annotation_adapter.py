"""Shared contract and safe policy primitives for Annotation providers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from ...domain.annotation import AnnotationProviderFailureCode

REQUEST_TIMEOUT_SECONDS = 90.0
MODEL_DISCOVERY_MAX_RETRIES = 1
ANSWER_TOKEN_HEADROOM = 4096

_CONTEXT_LIMIT_ERROR_MARKERS = (
    "context_length_exceeded",
    "maximum context length",
    "context window",
    "prompt is too long",
    "input token count",
    "too many input tokens",
    "exceeds the maximum number of tokens",
)
_REASONING_BUDGET_TOKENS: dict[str, int] = {
    "low": 1024,
    "medium": 4096,
    "high": 12000,
}


class AnnotationAiError(Exception):
    """One provider failure with a stable classification code."""

    def __init__(
        self,
        message: str,
        *,
        code: AnnotationProviderFailureCode = "annotation_provider_failed",
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class AnnotationContextLimitError(AnnotationAiError):
    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            code="annotation_provider_context_limit",
            retryable=False,
        )


class AnnotationResponseError(AnnotationAiError):
    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            code="annotation_provider_invalid_response",
            retryable=True,
        )


def completion_error(error: Exception, fallback: str) -> AnnotationAiError:
    """Normalize SDK status and transport failures into stable safe categories."""

    message = str(error) or fallback
    details = " ".join(
        (
            message,
            str(getattr(error, "code", "")),
            str(getattr(error, "body", "")),
        )
    ).casefold()
    if any(marker in details for marker in _CONTEXT_LIMIT_ERROR_MARKERS):
        return AnnotationContextLimitError(message)
    status = getattr(error, "status_code", None)
    if not isinstance(status, int):
        status = getattr(getattr(error, "response", None), "status_code", None)
    if not isinstance(status, int):
        candidate = getattr(error, "code", None)
        status = candidate if isinstance(candidate, int) else None
    if status == 401:
        code: AnnotationProviderFailureCode = (
            "annotation_provider_authentication_failed"
        )
    elif status == 403:
        code = "annotation_provider_access_denied"
    elif status == 429:
        code = "annotation_provider_rate_limited"
    elif status in {408} or (isinstance(status, int) and status >= 500):
        code = "annotation_provider_unavailable"
    elif isinstance(status, int) and 400 <= status < 500:
        code = "annotation_provider_request_rejected"
    else:
        error_name = type(error).__name__.casefold()
        if isinstance(error, (ConnectionError, TimeoutError)) or any(
            marker in error_name
            for marker in ("connection", "connect", "network", "timeout")
        ):
            code = "annotation_provider_unavailable"
        else:
            code = "annotation_provider_failed"
    return AnnotationAiError(
        message,
        code=code,
        retryable=code
        in {
            "annotation_provider_rate_limited",
            "annotation_provider_unavailable",
        },
    )


@dataclass(frozen=True, slots=True)
class InferenceConfig:
    temperature: float
    reasoning_enabled: bool
    reasoning_effort: Literal["low", "medium", "high"]


def reasoning_budget_tokens(effort: str) -> int:
    return _REASONING_BUDGET_TOKENS[effort]


def max_completion_tokens(config: InferenceConfig) -> int:
    if not config.reasoning_enabled:
        return ANSWER_TOKEN_HEADROOM
    return reasoning_budget_tokens(config.reasoning_effort) + ANSWER_TOKEN_HEADROOM


class AnnotationProviderAdapter(Protocol):
    """Minimal provider-specific surface consumed by shared orchestration."""

    async def complete(
        self,
        model: str,
        api_key: str | None,
        system: str,
        user: str,
        config: InferenceConfig,
    ) -> str: ...

    async def list_models(self, api_key: str | None) -> list[str]: ...


__all__ = [
    "ANSWER_TOKEN_HEADROOM",
    "AnnotationAiError",
    "AnnotationContextLimitError",
    "AnnotationProviderAdapter",
    "AnnotationResponseError",
    "InferenceConfig",
    "MODEL_DISCOVERY_MAX_RETRIES",
    "REQUEST_TIMEOUT_SECONDS",
    "completion_error",
    "max_completion_tokens",
    "reasoning_budget_tokens",
]
