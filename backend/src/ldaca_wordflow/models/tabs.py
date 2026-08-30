"""Transport requests for strict Workspace-owned Tab resources."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..domain.workspace import (
    AnalysisKind,
    StopWordSettings,
    TabName,
    TopicModelingProjectionSelection,
)


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TabCreate(_StrictModel):
    kind: AnalysisKind
    name: TabName


class _TabUpdate(_StrictModel):
    name: TabName | None = None

    @model_validator(mode="after")
    def require_update(self) -> _TabUpdate:
        if self.model_fields_set <= {"kind"}:
            raise ValueError("At least one Tab field must be provided")
        return self


class AnnotationTabUpdate(_TabUpdate):
    kind: Literal[AnalysisKind.ANNOTATION]
    correction_columns: dict[uuid.UUID, TabName] | None = None


class ConcordanceTabUpdate(_TabUpdate):
    kind: Literal[AnalysisKind.CONCORDANCE]


class QuotationTabUpdate(_TabUpdate):
    kind: Literal[AnalysisKind.QUOTATION]


class SequentialTabUpdate(_TabUpdate):
    kind: Literal[AnalysisKind.SEQUENTIAL]


class TokenFrequencyTabUpdate(_TabUpdate):
    kind: Literal[AnalysisKind.TOKEN_FREQUENCY]
    stop_words: StopWordSettings | None = None


class TopicModelingTabUpdate(_TabUpdate):
    kind: Literal[AnalysisKind.TOPIC_MODELING]
    stop_words: StopWordSettings | None = None
    words_per_topic: int | None = Field(default=None, ge=3, le=100)
    projection_selection: TopicModelingProjectionSelection | None = None


type TabUpdate = Annotated[
    AnnotationTabUpdate
    | ConcordanceTabUpdate
    | QuotationTabUpdate
    | SequentialTabUpdate
    | TokenFrequencyTabUpdate
    | TopicModelingTabUpdate,
    Field(discriminator="kind"),
]


__all__ = [
    "AnnotationTabUpdate",
    "ConcordanceTabUpdate",
    "QuotationTabUpdate",
    "SequentialTabUpdate",
    "TabCreate",
    "TabUpdate",
    "TokenFrequencyTabUpdate",
    "TopicModelingTabUpdate",
]
