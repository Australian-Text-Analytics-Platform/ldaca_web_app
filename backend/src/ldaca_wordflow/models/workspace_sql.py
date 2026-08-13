"""Strict workspace-level SQL query and creation commands."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .names import NodeName


class _WorkspaceSqlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_ids: list[uuid.UUID] = Field(min_length=1)
    sql: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_command(self) -> "_WorkspaceSqlRequest":
        if not self.sql.strip():
            raise ValueError("SQL must not be blank")
        if len(self.node_ids) != len(set(self.node_ids)):
            raise ValueError("SQL Data Block inputs must be unique")
        return self


class WorkspaceSqlQueryRequest(_WorkspaceSqlRequest):
    mode: Literal["query"] = "query"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=500)


class WorkspaceSqlCreateRequest(_WorkspaceSqlRequest):
    mode: Literal["create"] = "create"
    name: NodeName


WorkspaceSqlRequest = Annotated[
    WorkspaceSqlQueryRequest | WorkspaceSqlCreateRequest,
    Field(discriminator="mode"),
]


__all__ = [
    "WorkspaceSqlCreateRequest",
    "WorkspaceSqlQueryRequest",
    "WorkspaceSqlRequest",
]
