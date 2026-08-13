"""Strict resources for remote samples and the LDaCA Data Portal."""

from __future__ import annotations

from enum import StrEnum
from pathlib import PurePosixPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from ..shared.portable_names import portable_collision_key, portable_relative_path_parts


def sample_destination_path(collection_id: str, raw_path: str) -> PurePosixPath:
    """Return a catalogue file's path relative to its declared collection."""

    collection_parts = portable_relative_path_parts(collection_id)
    path_parts = portable_relative_path_parts(raw_path)
    if path_parts[: len(collection_parts)] != collection_parts:
        raise ValueError("Sample file must be contained by its collection")
    relative_parts = path_parts[len(collection_parts) :]
    if not relative_parts:
        raise ValueError("Sample file path must name a file")
    return PurePosixPath(*relative_parts)


class SampleFile(BaseModel):
    """One fetchable file in a remote sample collection."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    path: str
    size: int = Field(ge=0)


class SampleCollection(BaseModel):
    """One importable sample collection from the remote catalogue."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=1_024)
    name: str
    description: str = ""
    language: str = ""
    total_size_bytes: int = Field(ge=0)
    recommended_for: list[str] = Field(default_factory=list)
    files: list[SampleFile] = Field(max_length=10_000)
    installed: bool = False

    @model_validator(mode="after")
    def validate_manifest(self) -> "SampleCollection":
        """Require an internally consistent, platform-unambiguous manifest."""

        try:
            collection_parts = portable_relative_path_parts(self.id)
        except ValueError as exc:
            raise ValueError("Sample collection ID is not portable") from exc
        if "/".join(collection_parts) != self.id:
            raise ValueError("Sample collection ID is not canonical")
        if sum(file.size for file in self.files) != self.total_size_bytes:
            raise ValueError("total_size_bytes must equal the sum of file sizes")
        try:
            normalized_paths = [
                tuple(
                    portable_collision_key(part)
                    for part in sample_destination_path(self.id, file.path).parts
                )
                for file in self.files
            ]
        except ValueError as exc:
            raise ValueError("Sample file path is not valid for its collection") from exc
        if len(normalized_paths) != len(set(normalized_paths)):
            raise ValueError("Sample file paths must be distinct")
        return self


class SampleCatalogueResource(BaseModel):
    """Validated sample catalogue plus per-user installation state."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    collections: list[SampleCollection] = Field(max_length=500)

    @model_validator(mode="after")
    def validate_collection_ids(self) -> "SampleCatalogueResource":
        ids = [portable_collision_key(collection.id) for collection in self.collections]
        if len(ids) != len(set(ids)):
            raise ValueError("Sample collection IDs must be distinct")
        return self


class DataPortalSearchMethod(StrEnum):
    """Supported Data Portal search semantics."""

    KEYWORD = "keyword"
    IDENTIFIER = "identifier"
    COLLECTION = "collection"
    FILE_FORMAT = "file_format"
    ALL = "all"


class DataPortalSearchRequest(BaseModel):
    """One one-based portal search with an optional request-only token."""

    model_config = ConfigDict(extra="forbid")

    method: DataPortalSearchMethod = DataPortalSearchMethod.KEYWORD
    query: str = Field(default="", max_length=2_000)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=100)
    api_token: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=4_000,
        json_schema_extra={"writeOnly": True},
    )


class DataPortalFeaturedRequest(BaseModel):
    """Optional request-only token for configured featured collections."""

    model_config = ConfigDict(extra="forbid")

    api_token: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=4_000,
        json_schema_extra={"writeOnly": True},
    )


class DataPortalRecord(BaseModel):
    """Normalized portal record independent of Oni JSON-LD shapes."""

    model_config = ConfigDict(extra="forbid")

    id: str
    crate_id: str | None = None
    title: str
    description: str | None = None
    types: list[str] = Field(default_factory=list)
    license: str | None = None
    importable: bool
    access: list[str] = Field(default_factory=list)
    collections: list[str] = Field(default_factory=list)
    file_formats: list[str] = Field(default_factory=list)


class DataPortalSearchResource(BaseModel):
    """Direct normalized portal result page."""

    model_config = ConfigDict(extra="forbid")

    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total: int = Field(ge=0)
    items: list[DataPortalRecord]


class DataPortalImportSubmitRequest(BaseModel):
    """Portal import request with a token excluded from retained import state."""

    model_config = ConfigDict(extra="forbid")

    identifier: str = Field(min_length=1, max_length=4_000)
    name: str | None = Field(default=None, min_length=1, max_length=500)
    api_token: SecretStr | None = Field(
        default=None,
        min_length=1,
        max_length=4_000,
        json_schema_extra={"writeOnly": True},
    )


__all__ = [
    "DataPortalFeaturedRequest",
    "DataPortalImportSubmitRequest",
    "DataPortalRecord",
    "DataPortalSearchRequest",
    "DataPortalSearchResource",
    "SampleCatalogueResource",
    "SampleCollection",
    "sample_destination_path",
]
