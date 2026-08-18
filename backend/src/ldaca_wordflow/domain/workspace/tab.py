"""Strict portable Tab state owned by a Workspace aggregate."""

from __future__ import annotations

import unicodedata
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)


def _reject_control_characters(value: str) -> str:
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise ValueError("Tab name cannot contain control characters")
    return value


TabName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=500),
    AfterValidator(_reject_control_characters),
]
"""One non-unique display-label contract shared by HTTP and persistence."""


class AnalysisKind(StrEnum):
    """Function identity fixed when a Workspace Tab is created."""

    ANNOTATION = "annotation"
    CONCORDANCE = "concordance"
    QUOTATION = "quotation"
    SEQUENTIAL = "sequential"
    TOKEN_FREQUENCY = "token_frequency"
    TOPIC_MODELING = "topic_modeling"


class TopicModelingClusterSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_id: uuid.UUID
    cluster_count: int = Field(ge=0)


class Tab(BaseModel):
    """Complete strict public and persisted Tab representation."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    id: uuid.UUID
    kind: AnalysisKind
    name: TabName
    analysis_ids: list[uuid.UUID] = Field(default_factory=list)
    annotation_correction_columns: dict[uuid.UUID, TabName] = Field(
        default_factory=dict
    )
    stop_words: list[str] = Field(default_factory=list)
    topic_modeling_words_per_topic: int | None = Field(default=None, ge=3, le=100)
    topic_modeling_cluster_selection: TopicModelingClusterSelection | None = None
    created_at: AwareDatetime
    modified_at: AwareDatetime
    revision: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_presentation_settings(self) -> "Tab":
        if self.stop_words and self.kind not in {
            AnalysisKind.TOKEN_FREQUENCY,
            AnalysisKind.TOPIC_MODELING,
        }:
            raise ValueError(
                "Stop words belong only to Token Frequency and Topic Modelling Tabs"
            )
        if self.kind is AnalysisKind.TOPIC_MODELING:
            if self.topic_modeling_words_per_topic is None:
                raise ValueError("Topic Modelling Tabs require a word display count")
        elif self.topic_modeling_words_per_topic is not None:
            raise ValueError("Words per topic belongs only to Topic Modelling Tabs")
        if (
            self.topic_modeling_cluster_selection is not None
            and self.kind is not AnalysisKind.TOPIC_MODELING
        ):
            raise ValueError("Topic cluster selection belongs only to Topic Modelling Tabs")
        return self

    @classmethod
    def create(
        cls,
        *,
        kind: AnalysisKind,
        name: str,
        timestamp: datetime,
    ) -> "Tab":
        return cls(
            id=uuid.uuid4(),
            kind=kind,
            name=name,
            analysis_ids=[],
            annotation_correction_columns={},
            stop_words=[],
            topic_modeling_words_per_topic=(
                15 if kind is AnalysisKind.TOPIC_MODELING else None
            ),
            topic_modeling_cluster_selection=None,
            created_at=timestamp,
            modified_at=timestamp,
            revision=1,
        )


__all__ = ["AnalysisKind", "Tab", "TabName", "TopicModelingClusterSelection"]
