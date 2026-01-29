"""Analysis data models."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, Generic, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from .results import BaseAnalysisResult


class AnalysisStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BaseAnalysisRequest(BaseModel):
    """Base request model for all analyses."""

    model_config = ConfigDict(extra="allow")
    # Additional common fields can go here


TRequest = TypeVar("TRequest", bound=BaseAnalysisRequest)
TResult = TypeVar("TResult", bound=BaseAnalysisResult)


class AnalysisTask(BaseModel, Generic[TRequest, TResult]):
    """Container for a single analysis task."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    task_id: str
    user_id: str
    workspace_id: str
    status: AnalysisStatus = AnalysisStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    request: TRequest
    result: Optional[TResult] = None
    error: Optional[str] = None

    def complete(self, result: TResult) -> None:
        self.result = result
        self.status = AnalysisStatus.COMPLETED
        self.updated_at = datetime.now()

    def fail(self, error: str) -> None:
        self.error = error
        self.status = AnalysisStatus.FAILED
        self.updated_at = datetime.now()
