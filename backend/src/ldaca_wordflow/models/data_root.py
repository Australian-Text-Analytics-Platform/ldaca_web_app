"""Public control-plane schemas for Data Root bootstrap and switching."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DataRootErrorResource(BaseModel):
    """Runtime diagnostic shown by the unauthenticated loading screen."""

    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class DataRootResource(BaseModel):
    """Current process-wide Data Root and Runtime state."""

    model_config = ConfigDict(extra="forbid")

    state: Literal[
        "unconfigured",
        "initializing",
        "ready",
        "reconfiguring",
        "configuration_error",
        "stopping",
    ]
    source: Literal["environment", "config", "none"]
    data_root: str | None = None
    suggested_data_root: str | None = None
    mutable: bool
    runtime_generation: int = Field(ge=0)
    error: DataRootErrorResource | None = None
    change_token: str | None = None


class DataRootUpdateRequest(BaseModel):
    """One server filesystem path selected by a single-user client."""

    model_config = ConfigDict(extra="forbid")

    data_root: Path

    @field_validator("data_root", mode="before")
    @classmethod
    def expand_current_user_home(cls, value: object) -> object:
        """Expand only ``~`` for the account running the backend process."""

        if not isinstance(value, (str, Path)):
            return value
        raw_path = str(value)
        if raw_path == "~":
            return Path.home()
        if raw_path.startswith("~/"):
            return Path(f"{Path.home()}{raw_path[1:]}")
        return value

    @field_validator("data_root")
    @classmethod
    def require_absolute_path(cls, value: Path) -> Path:
        if not value.is_absolute():
            raise ValueError("Data Root must be an absolute path")
        return value


__all__ = ["DataRootErrorResource", "DataRootResource", "DataRootUpdateRequest"]
