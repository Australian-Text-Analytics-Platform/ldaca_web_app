"""Dependency-light private types shared by Analysis execution components."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
import uuid

from ..workers.invocations import AnalysisWorkerInput


class AnalysisSchedulingStopped(RuntimeError):
    """The process-local scheduler no longer accepts durable Analyses."""


@dataclass(frozen=True, slots=True)
class AnalysisExecutionKey:
    """Deployment identity used only by the process-local execution runtime."""

    user_id: str
    workspace_id: uuid.UUID
    analysis_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class AnalysisInvocation:
    """Private snapshotted callable and paths that never enter Analysis JSON."""

    input: AnalysisWorkerInput
    storage_roots: tuple[str, ...]
    max_storage_bytes: int
    max_storage_files: int


class AnalysisExecutionControl(Protocol):
    """Narrow process-local scheduler control used by Analysis commands."""

    async def enqueue(
        self,
        key: AnalysisExecutionKey,
        *,
        created_at: datetime,
        credential: str | None,
    ) -> None: ...

    async def cancel(self, key: AnalysisExecutionKey) -> None: ...


__all__ = [
    "AnalysisExecutionControl",
    "AnalysisExecutionKey",
    "AnalysisInvocation",
    "AnalysisSchedulingStopped",
]
