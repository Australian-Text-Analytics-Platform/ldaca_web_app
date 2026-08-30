"""Shared annotation values used by durable and stateless requests."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

AnnotationProvider = Literal[
    "openai",
    "openrouter",
    "anthropic",
    "google",
    "custom",
]

AnnotationProviderFailureCode = Literal[
    "annotation_provider_authentication_failed",
    "annotation_provider_access_denied",
    "annotation_provider_rate_limited",
    "annotation_provider_request_rejected",
    "annotation_provider_unavailable",
    "annotation_provider_context_limit",
    "annotation_provider_invalid_response",
    "annotation_provider_failed",
]

ANNOTATION_PROVIDER_SAFE_MESSAGES: dict[AnnotationProviderFailureCode, str] = {
    "annotation_provider_authentication_failed": (
        "Annotation provider authentication failed. Check the saved API key."
    ),
    "annotation_provider_access_denied": (
        "Annotation provider denied access. Check the account and model permissions."
    ),
    "annotation_provider_rate_limited": (
        "Annotation provider rate limit was exceeded. Try again later."
    ),
    "annotation_provider_request_rejected": (
        "Annotation provider rejected the request. Check the selected model and settings."
    ),
    "annotation_provider_unavailable": (
        "Annotation provider is unavailable. Try again later."
    ),
    "annotation_provider_context_limit": (
        "Annotation input exceeds the provider context limit."
    ),
    "annotation_provider_invalid_response": (
        "Annotation provider returned an invalid response."
    ),
    "annotation_provider_failed": "Annotation provider request failed.",
}

AnnotationExampleSamplingMethod = Literal["random", "first_n", "last_n"]

AnnotationClassName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]


class AnnotationClass(BaseModel):
    """One exact label and optional model-facing description."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: AnnotationClassName = Field(max_length=200)
    description: str = Field(default="", max_length=2_000)


def normalize_annotation_provider_base_url(value: str) -> str:
    """Validate and normalize one trusted OpenAI-compatible API root."""

    candidate = value.strip()
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Custom base URL must be an absolute HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Custom base URL cannot contain user information")
    if parsed.query or parsed.fragment:
        raise ValueError("Custom base URL cannot contain a query or fragment")
    return urlunsplit(
        (parsed.scheme.lower(), parsed.netloc, parsed.path.rstrip("/"), "", "")
    )


class AnnotationProviderSnapshot(BaseModel):
    """Safe immutable provider locator captured by an Annotation request."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider_configuration_id: uuid.UUID
    provider: AnnotationProvider
    provider_base_url: str | None = Field(default=None, max_length=2_000)

    @field_validator("provider_base_url", mode="before")
    @classmethod
    def normalize_base_url(cls, value: object) -> object:
        if value is None or not isinstance(value, str):
            return value
        return normalize_annotation_provider_base_url(value)

    @model_validator(mode="after")
    def validate_locator(self) -> AnnotationProviderSnapshot:
        if self.provider == "custom" and self.provider_base_url is None:
            raise ValueError("Custom providers require a base URL")
        if self.provider != "custom" and self.provider_base_url is not None:
            raise ValueError("Built-in providers cannot define a base URL")
        return self


__all__ = [
    "ANNOTATION_PROVIDER_SAFE_MESSAGES",
    "AnnotationClass",
    "AnnotationExampleSamplingMethod",
    "AnnotationProvider",
    "AnnotationProviderFailureCode",
    "AnnotationProviderSnapshot",
    "normalize_annotation_provider_base_url",
]
