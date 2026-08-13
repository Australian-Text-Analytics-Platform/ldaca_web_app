"""Strict ephemeral events for authoritative-resource refresh."""

from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from .background import BackgroundState, Progress


class EventResourceType(StrEnum):
    WORKSPACE = "workspace"
    TAB = "tab"
    ANALYSIS = "analysis"
    USER_FILE_IMPORT = "user_file_import"


class _Event(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int = Field(ge=1)
    occurred_at: AwareDatetime


class StreamReadyEvent(_Event):
    type: Literal["stream_ready"] = "stream_ready"


class ResourceChangedEvent(_Event):
    type: Literal["resource_changed"] = "resource_changed"
    resource_type: EventResourceType
    resource_id: uuid.UUID
    workspace_id: uuid.UUID | None = None
    state: BackgroundState | None = None
    progress: Progress | None = None
    revision: int = Field(ge=1)


class ResourceProgressEvent(_Event):
    type: Literal["resource_progress"] = "resource_progress"
    resource_type: Literal[
        EventResourceType.ANALYSIS,
        EventResourceType.USER_FILE_IMPORT,
    ]
    resource_id: uuid.UUID
    workspace_id: uuid.UUID | None = None
    state: Literal[BackgroundState.RUNNING] = BackgroundState.RUNNING
    progress: Progress
    revision: None = None


class ResourceRemovedEvent(_Event):
    type: Literal["resource_removed"] = "resource_removed"
    resource_type: EventResourceType
    resource_id: uuid.UUID
    workspace_id: uuid.UUID | None = None
    revision: int | None = Field(default=None, ge=1)


class WorkspaceRuntimeChangedEvent(_Event):
    type: Literal["workspace_runtime_changed"] = "workspace_runtime_changed"
    resource_type: Literal[EventResourceType.WORKSPACE] = EventResourceType.WORKSPACE
    resource_id: uuid.UUID
    workspace_id: uuid.UUID
    runtime_state: Literal["closed", "open", "closing"]
    revision: None = None


class ResyncRequiredEvent(_Event):
    type: Literal["resync_required"] = "resync_required"


BackendEvent = Annotated[
    StreamReadyEvent
    | ResourceChangedEvent
    | ResourceProgressEvent
    | ResourceRemovedEvent
    | WorkspaceRuntimeChangedEvent
    | ResyncRequiredEvent,
    Field(discriminator="type"),
]


__all__ = [
    "BackendEvent",
    "EventResourceType",
    "ResourceChangedEvent",
    "ResourceRemovedEvent",
    "ResourceProgressEvent",
    "ResyncRequiredEvent",
    "StreamReadyEvent",
    "WorkspaceRuntimeChangedEvent",
]
