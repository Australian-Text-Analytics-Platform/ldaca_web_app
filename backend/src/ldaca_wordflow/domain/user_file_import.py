"""Strict durable lifecycle for one remote User File publication."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from ..shared.portable_names import portable_relative_path_parts
from .background import BackgroundState, Failure, Progress


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


NonEmptyText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]


def _validate_public_path(path: str) -> str:
    return "/".join(portable_relative_path_parts(path))


def _validate_collection_id(value: str) -> str:
    try:
        canonical = "/".join(portable_relative_path_parts(value))
    except ValueError as exc:
        raise ValueError("Sample collection ID is not portable") from exc
    if canonical != value:
        raise ValueError("Sample collection ID is not canonical")
    return value


PublicUserFilePath = Annotated[str, StringConstraints(min_length=1, max_length=4_000)]


class SampleUserFileImportRequest(_StrictModel):
    kind: Literal["sample"] = "sample"
    collection_id: str = Field(min_length=1, max_length=1_024)

    @field_validator("collection_id")
    @classmethod
    def validate_collection_id(cls, value: str) -> str:
        return _validate_collection_id(value)


class DataPortalUserFileImportRequest(_StrictModel):
    kind: Literal["data_portal"] = "data_portal"
    identifier: NonEmptyText = Field(max_length=4_000)
    name: NonEmptyText | None = Field(default=None, max_length=500)


UserFileImportRequest = Annotated[
    SampleUserFileImportRequest | DataPortalUserFileImportRequest,
    Field(discriminator="kind"),
]


class SampleUserFileImportResult(_StrictModel):
    kind: Literal["sample"] = "sample"
    collection_id: str = Field(min_length=1, max_length=1_024)
    destination_path: PublicUserFilePath
    file_count: int = Field(ge=0)
    bytes_written: int = Field(ge=0)

    @field_validator("collection_id")
    @classmethod
    def validate_collection_id(cls, value: str) -> str:
        return _validate_collection_id(value)

    @model_validator(mode="after")
    def validate_path(self) -> SampleUserFileImportResult:
        if _validate_public_path(self.destination_path) != self.destination_path:
            raise ValueError("User File import paths must be canonical")
        return self


class DataPortalUserFileImportResult(_StrictModel):
    kind: Literal["data_portal"] = "data_portal"
    destination_path: PublicUserFilePath
    file_count: int = Field(ge=0)
    bytes_written: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_path(self) -> DataPortalUserFileImportResult:
        if _validate_public_path(self.destination_path) != self.destination_path:
            raise ValueError("User File import paths must be canonical")
        return self


UserFileImportResult = Annotated[
    SampleUserFileImportResult | DataPortalUserFileImportResult,
    Field(discriminator="kind"),
]


class UserFileImport(_StrictModel):
    """One complete public and persisted import resource."""

    availability: Literal["available"]
    id: uuid.UUID
    request: UserFileImportRequest
    state: BackgroundState
    progress: Progress
    cancellation_requested_at: AwareDatetime | None
    error: Failure | None
    result: UserFileImportResult | None
    created_at: AwareDatetime
    started_at: AwareDatetime | None
    finished_at: AwareDatetime | None
    revision: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_lifecycle(self) -> UserFileImport:
        terminal = self.state in {
            BackgroundState.SUCCEEDED,
            BackgroundState.FAILED,
            BackgroundState.CANCELLED,
        }
        if terminal != (self.finished_at is not None):
            raise ValueError("Terminal imports and finished_at must agree")
        if self.state is BackgroundState.QUEUED and self.started_at is not None:
            raise ValueError("Queued imports cannot have started_at")
        if self.state in {BackgroundState.RUNNING, BackgroundState.SUCCEEDED} and (
            self.started_at is None
        ):
            raise ValueError("Running and successful imports require started_at")
        if (self.state is BackgroundState.FAILED) != (self.error is not None):
            raise ValueError("Only failed imports contain a Failure")
        if (self.state is BackgroundState.SUCCEEDED) != (self.result is not None):
            raise ValueError("Only successful imports contain a Result")
        if self.result is not None and self.result.kind != self.request.kind:
            raise ValueError("Import request and Result kinds must match")
        if self.state is BackgroundState.CANCELLED and (
            self.cancellation_requested_at is None
        ):
            raise ValueError("Cancelled imports require a cancellation request")
        if self.state is BackgroundState.SUCCEEDED and self.progress.fraction != 1.0:
            raise ValueError("Successful imports require complete Progress")
        if self.state is not BackgroundState.SUCCEEDED and (
            self.progress.fraction == 1.0
        ):
            raise ValueError("Only successful imports may persist complete Progress")
        if self.started_at is not None and self.started_at < self.created_at:
            raise ValueError("started_at cannot precede created_at")
        if (
            self.cancellation_requested_at is not None
            and self.cancellation_requested_at < self.created_at
        ):
            raise ValueError("cancellation_requested_at cannot precede created_at")
        if self.finished_at is not None:
            lower_bound = self.started_at or self.created_at
            if self.finished_at < lower_bound:
                raise ValueError("finished_at precedes the import lifecycle")
        return self

    def _transition(self, **changes: object) -> UserFileImport:
        payload = self.model_dump()
        payload.update(changes)
        payload["revision"] = self.revision + 1
        return UserFileImport.model_validate(payload)

    def start(self, timestamp: datetime) -> UserFileImport:
        if self.state is not BackgroundState.QUEUED:
            raise ValueError("Only a queued import can start")
        return self._transition(
            state=BackgroundState.RUNNING,
            started_at=timestamp,
        )

    def cancel_queued(self, timestamp: datetime) -> UserFileImport:
        if self.state is not BackgroundState.QUEUED:
            raise ValueError("Only a queued import can be cancelled immediately")
        return self._transition(
            state=BackgroundState.CANCELLED,
            cancellation_requested_at=timestamp,
            finished_at=timestamp,
        )

    def request_running_cancellation(self, timestamp: datetime) -> UserFileImport:
        if self.state is not BackgroundState.RUNNING:
            raise ValueError("Only a running import can request cancellation")
        if self.cancellation_requested_at is not None:
            return self
        return self._transition(cancellation_requested_at=timestamp)

    def confirm_cancelled(
        self,
        timestamp: datetime,
        *,
        progress: Progress,
    ) -> UserFileImport:
        if (
            self.state is not BackgroundState.RUNNING
            or self.cancellation_requested_at is None
        ):
            raise ValueError("Import cancellation has not been requested")
        return self._transition(
            state=BackgroundState.CANCELLED,
            progress=progress,
            finished_at=timestamp,
        )

    def fail(
        self,
        timestamp: datetime,
        *,
        failure: Failure,
        progress: Progress,
    ) -> UserFileImport:
        if self.state not in {BackgroundState.QUEUED, BackgroundState.RUNNING}:
            raise ValueError("Only a non-terminal import can fail")
        return self._transition(
            state=BackgroundState.FAILED,
            progress=progress,
            error=failure,
            finished_at=timestamp,
        )

    def succeed(
        self,
        timestamp: datetime,
        *,
        result: UserFileImportResult,
    ) -> UserFileImport:
        if self.state is not BackgroundState.RUNNING:
            raise ValueError("Only a running import can succeed")
        return self._transition(
            state=BackgroundState.SUCCEEDED,
            progress=Progress(fraction=1.0, message="Complete"),
            result=result,
            finished_at=timestamp,
        )

    @classmethod
    def create(
        cls,
        request: UserFileImportRequest,
        *,
        timestamp: datetime,
        import_id: uuid.UUID | None = None,
    ) -> UserFileImport:
        return cls(
            availability="available",
            id=import_id or uuid.uuid4(),
            request=request,
            state=BackgroundState.QUEUED,
            progress=Progress(fraction=0.0, message="Queued"),
            cancellation_requested_at=None,
            error=None,
            result=None,
            created_at=timestamp,
            started_at=None,
            finished_at=None,
            revision=1,
        )


__all__ = [
    "DataPortalUserFileImportRequest",
    "DataPortalUserFileImportResult",
    "SampleUserFileImportRequest",
    "SampleUserFileImportResult",
    "UserFileImport",
    "UserFileImportRequest",
    "UserFileImportResult",
]
