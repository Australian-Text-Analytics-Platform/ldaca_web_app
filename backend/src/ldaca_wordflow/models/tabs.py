"""Transport requests for strict Workspace-owned Tab resources."""

from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from ..domain.workspace import AnalysisKind, TabName, TopicModelingClusterSelection


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _normalize_stop_words(value: object) -> object:
    if not isinstance(value, list):
        return value
    normalized: list[str] = []
    seen: set[str] = set()
    for candidate in value:
        if not isinstance(candidate, str):
            return value
        word = candidate.strip().lower()
        if word and word not in seen:
            seen.add(word)
            normalized.append(word)
    return normalized


class TabCreate(_StrictModel):
    kind: AnalysisKind
    name: TabName


class TabUpdate(_StrictModel):
    name: TabName | None = None
    annotation_correction_columns: dict[uuid.UUID, TabName] | None = None
    stop_words: Annotated[list[str], BeforeValidator(_normalize_stop_words)] | None = None
    topic_modeling_words_per_topic: int | None = Field(default=None, ge=3, le=100)
    topic_modeling_cluster_selection: TopicModelingClusterSelection | None = None

    @model_validator(mode="after")
    def require_update(self) -> "TabUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one Tab field must be provided")
        return self
__all__ = ["TabCreate", "TabUpdate"]
