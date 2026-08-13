"""Strict resources for the runtime-owned user file store."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FileResource(_StrictModel):
    """One addressable regular file or directory below the user's data root."""

    name: str
    path: str
    type: Literal["file", "directory"]
    size_bytes: int | None = Field(default=None, ge=0)
    modified_at: float
    file_type: str | None = None
    loadable: bool

    @model_validator(mode="after")
    def validate_kind_fields(self) -> "FileResource":
        if self.type == "directory":
            if self.size_bytes is not None or self.file_type is not None:
                raise ValueError("directory resources cannot contain file metadata")
            self.loadable = False
        elif self.size_bytes is None or self.file_type is None:
            raise ValueError("file resources require size and file type metadata")
        return self


class FileWorksheetsResource(_StrictModel):
    """Worksheet selection metadata for one Excel user file."""

    sheets: list[str] = Field(min_length=1)
    default_sheet: str = Field(min_length=1)


class CreateFolderRequest(_StrictModel):
    """Create one validated child under a relative parent path."""

    name: str = Field(min_length=1, max_length=500)
    parent_path: str = ""


class MoveFileRequest(_StrictModel):
    """Move one file into an existing relative directory."""

    source_path: str = Field(min_length=1)
    target_directory_path: str = ""


__all__ = [
    "CreateFolderRequest",
    "FileWorksheetsResource",
    "FileResource",
    "MoveFileRequest",
]
