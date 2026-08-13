"""Shared strict lifecycle values for durable background resources."""

from __future__ import annotations

import unicodedata
from enum import StrEnum
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
)


def _safe_text(value: str) -> str:
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise ValueError("Public text cannot contain control characters")
    return value


SafePublicText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=500),
    AfterValidator(_safe_text),
]


class BackgroundState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Progress(BaseModel):
    """Exact live and durable progress value shared by background resources."""

    model_config = ConfigDict(extra="forbid", strict=True)

    fraction: float | None = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    message: SafePublicText | None


class Failure(BaseModel):
    """Safe durable terminal failure with no internal diagnostics."""

    model_config = ConfigDict(extra="forbid", strict=True)

    code: str = Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=100)
    message: SafePublicText


__all__ = ["BackgroundState", "Failure", "Progress"]
