"""Public table-delivery contracts shared by API resources."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CompleteTableResource(_StrictModel):
    """One immutable table fetched as a complete Arrow IPC stream."""

    delivery: Literal["complete"] = "complete"
    table_id: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1)


class PagedTableResource(_StrictModel):
    """One open-ended table fetched as independent Arrow IPC pages."""

    delivery: Literal["paged"] = "paged"
    table_id: str = Field(min_length=1, max_length=200)
    schema_url: str = Field(min_length=1)
    rows_url: str = Field(min_length=1)


class TableProjectionResource(_StrictModel):
    schema_url: str = Field(min_length=1)
    rows_url: str = Field(min_length=1)


class ProjectedTableResource(_StrictModel):
    """One immutable nested table exposed through document and match rows."""

    delivery: Literal["projected"] = "projected"
    table_id: str = Field(min_length=1, max_length=200)
    documents: TableProjectionResource
    matches: TableProjectionResource
    density_url: str | None = None


__all__ = [
    "CompleteTableResource",
    "PagedTableResource",
    "ProjectedTableResource",
    "TableProjectionResource",
]
