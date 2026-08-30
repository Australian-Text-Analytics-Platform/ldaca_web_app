"""Strict canonical workspace, graph, and node resources."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from .names import NodeName
from ..domain.workspace import (
    AnalysisRecord,
    AnalysisState,
    NodeProvenance,
    Tab,
    analysis_snapshot_input_ids,
)


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DtypeNormalizationChange(_StrictModel):
    """One source-file dtype normalization applied during node creation."""

    column: str
    from_dtype: str
    to_dtype: str
    reason: str


class WorkspaceNodeInfo(_StrictModel):
    """Complete addressable node metadata returned by node routes."""

    availability: Literal["available"] = "available"
    id: uuid.UUID
    name: NodeName
    provenance: NodeProvenance
    derivation_description: str
    parent_ids: list[uuid.UUID] = Field(default_factory=list)
    child_ids: list[uuid.UUID] = Field(default_factory=list)
    document: str | None = None
    color: str | None = None
    shape: tuple[int | None, int | None] = (None, None)
    dtype_normalization: list[DtypeNormalizationChange] | None = None
    tokenizer_model: str | None = Field(default=None, max_length=500)
    can_undo: bool
    can_redo: bool


class UnavailableDataBlock(_StrictModel):
    """Minimal safe projection of one isolated current-schema Data Block."""

    availability: Literal["unavailable"] = "unavailable"
    id: uuid.UUID
    workspace_id: uuid.UUID
    reason: Literal["record_invalid"] = "record_invalid"
    warning: str


DataBlockResource = Annotated[
    WorkspaceNodeInfo | UnavailableDataBlock,
    Field(discriminator="availability"),
]


class WorkspaceResource(_StrictModel):
    """Lightweight Workspace metadata plus process-local runtime state."""

    id: uuid.UUID
    name: str
    description: str
    created_at: AwareDatetime
    modified_at: AwareDatetime
    total_nodes: int = Field(ge=0)
    root_nodes: int = Field(ge=0)
    leaf_nodes: int = Field(ge=0)
    revision: int = Field(ge=0)
    runtime_state: Literal["closed", "open", "closing"]


class AvailableWorkspaceListItem(WorkspaceResource):
    """Available Workspace entry returned by catalogue discovery."""

    availability: Literal["available"] = "available"


class UnavailableWorkspaceListItem(_StrictModel):
    """Catalogue entry for an owned Workspace that cannot open."""

    availability: Literal["unavailable"] = "unavailable"
    id: uuid.UUID
    reason: Literal[
        "incompatible_format",
        "corrupt_snapshot",
        "configured_limit",
    ]
    message: str
    name: str | None = None
    description: str | None = None
    created_at: str | None = None
    modified_at: str | None = None
    stored_schema_version: int | None = None
    supported_schema_version: int | None = None

    @model_validator(mode="after")
    def validate_schema_versions(self) -> UnavailableWorkspaceListItem:
        versions = (self.stored_schema_version, self.supported_schema_version)
        if self.reason == "incompatible_format":
            if any(version is None for version in versions):
                raise ValueError("Incompatible Workspace formats require both versions")
        elif any(version is not None for version in versions):
            raise ValueError("Only incompatible Workspace formats expose versions")
        return self


WorkspaceListItem = Annotated[
    AvailableWorkspaceListItem | UnavailableWorkspaceListItem,
    Field(discriminator="availability"),
]


class WorkspaceNodeReorderRequest(_StrictModel):
    """Complete desired workspace node order."""

    ordered_ids: list[uuid.UUID]


class WorkspaceCreateRequest(_StrictModel):
    """Create one workspace resource."""

    name: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=10_000)


class WorkspaceUpdateRequest(_StrictModel):
    """Partial workspace metadata update."""

    name: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10_000)

    @model_validator(mode="after")
    def validate_patch(self) -> WorkspaceUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Workspace patch must contain at least one field")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Workspace name cannot be null")
        return self


class WorkspaceArchiveMetadata(_StrictModel):
    """Safe portable workspace metadata stored in archive manifest version 15."""

    id: uuid.UUID
    name: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=10_000)
    created_at: AwareDatetime | None = None
    modified_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def validate_timestamp_order(self) -> WorkspaceArchiveMetadata:
        if (
            self.created_at is not None
            and self.modified_at is not None
            and self.modified_at < self.created_at
        ):
            raise ValueError("Workspace modified_at cannot precede created_at")
        return self


class WorkspaceArchiveNode(_StrictModel):
    """Declarative materialized node entry with no executable plan payload."""

    id: uuid.UUID
    name: NodeName
    provenance: NodeProvenance
    document: str | None = None
    color: str | None = None
    tokenizer_model: str | None = Field(default=None, min_length=1, max_length=500)
    data_file: str = Field(min_length=1)

    @field_validator("tokenizer_model", mode="before")
    @classmethod
    def normalize_tokenizer_model(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return value.strip() or None


class WorkspaceArchiveAnalysisInput(_StrictModel):
    """One materialized immutable run input used to rebuild a query snapshot."""

    id: uuid.UUID
    name: NodeName
    document: str | None = None
    color: str | None = None
    data_file: str = Field(min_length=1)


class WorkspaceArchiveAnalysis(_StrictModel):
    """One terminal Analysis plus safe materialized query inputs, when needed."""

    record: AnalysisRecord
    query_inputs: list[WorkspaceArchiveAnalysisInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_query_inputs(self) -> WorkspaceArchiveAnalysis:
        expected_ids = list(analysis_snapshot_input_ids(self.record.request))
        actual_ids = [item.id for item in self.query_inputs]
        if self.record.query_snapshot is None:
            if actual_ids:
                raise ValueError("Only a queryable Analysis has archived query inputs")
            return self
        if actual_ids != expected_ids:
            raise ValueError("Archived query inputs must match the Analysis request")
        analysis_id = str(self.record.id)
        for item in self.query_inputs:
            expected_file = f"analyses/{analysis_id}/query-data/{item.id}.parquet"
            if item.data_file != expected_file:
                raise ValueError("Archived query input path is invalid")
        return self


class WorkspaceArchiveManifest(_StrictModel):
    """Only accepted client workspace archive manifest."""

    format: Literal["wordflow-materialized-workspace"]
    version: Literal[21]
    workspace: WorkspaceArchiveMetadata
    nodes: list[WorkspaceArchiveNode]
    tabs: list[Tab]
    analyses: list[WorkspaceArchiveAnalysis]

    @model_validator(mode="after")
    def validate_analysis_ownership(self) -> WorkspaceArchiveManifest:
        analysis_ids = [str(item.record.id) for item in self.analyses]
        if len(analysis_ids) != len(set(analysis_ids)):
            raise ValueError("Workspace archive has duplicate Analysis IDs")
        by_id = {str(item.record.id): item.record for item in self.analyses}
        if any(
            record.state
            not in {
                AnalysisState.SUCCEEDED,
                AnalysisState.FAILED,
                AnalysisState.CANCELLED,
            }
            for record in by_id.values()
        ):
            raise ValueError("Workspace archives contain only terminal Analyses")
        tab_analysis_ids = [
            str(analysis_id)
            for tab in self.tabs
            for analysis_id in tab.analysis_ids
        ]
        if len(tab_analysis_ids) != len(set(tab_analysis_ids)):
            raise ValueError("An Analysis may belong to only one archived Tab")
        if set(tab_analysis_ids) != set(by_id):
            raise ValueError("Archived Analyses must belong to exactly one Tab")
        for tab in self.tabs:
            for analysis_id in tab.analysis_ids:
                record = by_id[str(analysis_id)]
                if record.tab_id != tab.id:
                    raise ValueError("Archived Tab and Analysis ownership is invalid")
        for record in by_id.values():
            if record.parent_analysis_id is None:
                continue
            parent = by_id.get(str(record.parent_analysis_id))
            if parent is None or parent.tab_id != record.tab_id:
                raise ValueError("Archived Sub-Analysis parent is invalid")
        return self


__all__ = [
    "DataBlockResource",
    "UnavailableDataBlock",
    "WorkspaceCreateRequest",
    "WorkspaceArchiveAnalysis",
    "WorkspaceArchiveAnalysisInput",
    "WorkspaceArchiveManifest",
    "WorkspaceNodeInfo",
    "WorkspaceNodeReorderRequest",
    "WorkspaceResource",
    "WorkspaceUpdateRequest",
]
