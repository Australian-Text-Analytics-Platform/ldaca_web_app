"""Public tokenizer catalogue resources."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class TokenizerModelResource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1, max_length=500)
    label: str = Field(min_length=1, max_length=500)
    languages: list[str] = Field(default_factory=list, max_length=32)


__all__ = ["TokenizerModelResource"]
