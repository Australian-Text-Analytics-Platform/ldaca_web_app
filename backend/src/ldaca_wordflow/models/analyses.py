"""Transport models for Workspace-owned Analysis collections."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..domain.workspace import (
    Analysis,
    AnalysisExecutionScope,
    AnalysisSubmission,
    CorruptAnalysis,
)


class AnalysisCreate(BaseModel):
    """One complete immutable Analysis submission owned by a Tab."""

    model_config = ConfigDict(extra="forbid")

    execution_scope: AnalysisExecutionScope
    request: AnalysisSubmission
    parent_analysis_id: uuid.UUID | None = None
    supersedes_analysis_ids: list[uuid.UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_ids(self) -> "AnalysisCreate":
        if len(self.supersedes_analysis_ids) != len(
            set(self.supersedes_analysis_ids)
        ):
            raise ValueError("Superseded Analysis IDs must be distinct")
        return self


class AnalysisPage(BaseModel):
    """One-based stable page of live valid and corrupt Analyses."""

    model_config = ConfigDict(extra="forbid")

    items: list[Analysis | CorruptAnalysis]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_items: int = Field(ge=0)
    total_pages: int = Field(ge=0)


__all__ = ["AnalysisCreate", "AnalysisPage"]
