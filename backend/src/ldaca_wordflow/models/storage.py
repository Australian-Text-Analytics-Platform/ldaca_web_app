"""Strict current-principal storage policy resources."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class _StorageResource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class UnlimitedStorageResource(_StorageResource):
    """A principal with no durable storage limit."""

    policy: Literal["unlimited"] = "unlimited"


class QuotaStorageResource(_StorageResource):
    """One point-in-time finite allocation snapshot."""

    policy: Literal["quota"] = "quota"
    limit_bytes: int = Field(ge=1)
    used_bytes: int = Field(ge=0)
    reserved_bytes: int = Field(ge=0)
    available_bytes: int = Field(ge=0)


StorageResource = Annotated[
    UnlimitedStorageResource | QuotaStorageResource,
    Field(discriminator="policy"),
]


__all__ = [
    "QuotaStorageResource",
    "StorageResource",
    "UnlimitedStorageResource",
]
