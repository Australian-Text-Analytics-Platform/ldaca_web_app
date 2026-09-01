"""Strict portable Tab state owned by a Workspace aggregate."""

from __future__ import annotations

import unicodedata
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
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


class TopicModelingProjectionSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_id: uuid.UUID
    cluster_count: int = Field(ge=0)
    top_n_topics: int = Field(ge=0)


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


class StopWordSettings(BaseModel):
    """Shared normalized stop-word value object."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    words: Annotated[list[str], BeforeValidator(_normalize_stop_words)]


class _TabSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class AnnotationTabSettings(_TabSettings):
    kind: Literal[AnalysisKind.ANNOTATION]
    correction_columns: dict[uuid.UUID, TabName]


class ConcordanceTabSettings(_TabSettings):
    kind: Literal[AnalysisKind.CONCORDANCE]


class QuotationTabSettings(_TabSettings):
    kind: Literal[AnalysisKind.QUOTATION]


class SequentialTabSettings(_TabSettings):
    kind: Literal[AnalysisKind.SEQUENTIAL]


class TokenFrequencyTabSettings(_TabSettings):
    kind: Literal[AnalysisKind.TOKEN_FREQUENCY]
    stop_words: StopWordSettings


class TopicModelingTabSettings(_TabSettings):
    kind: Literal[AnalysisKind.TOPIC_MODELING]
    stop_words: StopWordSettings
    words_per_topic: int = Field(ge=3, le=100)
    projection_selection: TopicModelingProjectionSelection | None


type TabSettings = Annotated[
    AnnotationTabSettings
    | ConcordanceTabSettings
    | QuotationTabSettings
    | SequentialTabSettings
    | TokenFrequencyTabSettings
    | TopicModelingTabSettings,
    Field(discriminator="kind"),
]


class Tab(BaseModel):
    """Complete strict public and persisted Tab representation."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    availability: Literal["available"]
    id: uuid.UUID
    kind: AnalysisKind
    name: TabName
    analysis_ids: list[uuid.UUID] = Field(default_factory=list)
    settings: TabSettings
    created_at: AwareDatetime
    modified_at: AwareDatetime
    revision: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_settings_kind(self) -> Tab:
        if self.settings.kind is not self.kind:
            raise ValueError("Tab settings kind must match the Tab kind")
        return self

    @classmethod
    def create(
        cls,
        *,
        kind: AnalysisKind,
        name: str,
        timestamp: datetime,
    ) -> Tab:
        settings_by_kind: dict[AnalysisKind, TabSettings] = {
            AnalysisKind.ANNOTATION: AnnotationTabSettings(
                kind=AnalysisKind.ANNOTATION,
                correction_columns={},
            ),
            AnalysisKind.CONCORDANCE: ConcordanceTabSettings(
                kind=AnalysisKind.CONCORDANCE
            ),
            AnalysisKind.QUOTATION: QuotationTabSettings(
                kind=AnalysisKind.QUOTATION
            ),
            AnalysisKind.SEQUENTIAL: SequentialTabSettings(
                kind=AnalysisKind.SEQUENTIAL
            ),
            AnalysisKind.TOKEN_FREQUENCY: TokenFrequencyTabSettings(
                kind=AnalysisKind.TOKEN_FREQUENCY,
                stop_words=StopWordSettings(words=[]),
            ),
            AnalysisKind.TOPIC_MODELING: TopicModelingTabSettings(
                kind=AnalysisKind.TOPIC_MODELING,
                stop_words=StopWordSettings(words=[]),
                words_per_topic=15,
                projection_selection=None,
            ),
        }
        return cls(
            availability="available",
            id=uuid.uuid4(),
            kind=kind,
            name=name,
            analysis_ids=[],
            settings=settings_by_kind[kind],
            created_at=timestamp,
            modified_at=timestamp,
            revision=1,
        )


class UnavailableTab(BaseModel):
    """Minimal safe item for an unavailable persisted Tab record."""

    model_config = ConfigDict(extra="forbid")

    availability: Literal["unavailable"]
    id: uuid.UUID
    workspace_id: uuid.UUID
    reason: Literal["record_invalid", "incompatible_schema"]
    analysis_kind: AnalysisKind | None = None
    stored_schema_version: int | None = None
    supported_schema_version: int | None = None
    warning: str

    @model_validator(mode="after")
    def validate_schema_versions(self) -> UnavailableTab:
        versions = (self.stored_schema_version, self.supported_schema_version)
        if self.reason == "incompatible_schema":
            if self.analysis_kind is None or any(version is None for version in versions):
                raise ValueError(
                    "Incompatible Tabs require kind and schema versions"
                )
        elif any(version is not None for version in versions):
            raise ValueError("Invalid Tabs cannot expose schema versions")
        return self

    @classmethod
    def create(
        cls,
        *,
        tab_id: uuid.UUID,
        workspace_id: uuid.UUID,
        reason: Literal["record_invalid", "incompatible_schema"],
        analysis_kind: AnalysisKind | None = None,
        stored_schema_version: int | None = None,
        supported_schema_version: int | None = None,
    ) -> UnavailableTab:
        warning = (
            "This Tab is unavailable because its stored schema is not supported."
            if reason == "incompatible_schema"
            else "This Tab is unavailable because its stored record is invalid."
        )
        return cls(
            availability="unavailable",
            id=tab_id,
            workspace_id=workspace_id,
            reason=reason,
            analysis_kind=analysis_kind,
            stored_schema_version=stored_schema_version,
            supported_schema_version=supported_schema_version,
            warning=warning,
        )


type TabResource = Annotated[Tab | UnavailableTab, Field(discriminator="availability")]


__all__ = [
    "AnalysisKind",
    "AnnotationTabSettings",
    "ConcordanceTabSettings",
    "QuotationTabSettings",
    "SequentialTabSettings",
    "StopWordSettings",
    "Tab",
    "TabName",
    "TabResource",
    "TabSettings",
    "TokenFrequencyTabSettings",
    "TopicModelingProjectionSelection",
    "TopicModelingTabSettings",
    "UnavailableTab",
]
