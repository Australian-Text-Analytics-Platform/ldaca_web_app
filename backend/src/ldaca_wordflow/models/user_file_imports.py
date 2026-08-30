"""Transport models for available and isolated User File Import resources."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..domain import UserFileImport


class UnavailableUserFileImport(BaseModel):
    """Small safe projection for one invalid persisted import record."""

    model_config = ConfigDict(extra="forbid")

    availability: Literal["unavailable"]
    id: uuid.UUID
    user_id: str = Field(min_length=1)
    reason: Literal["record_invalid"] = "record_invalid"
    warning: str = Field(min_length=1, max_length=500)


UserFileImportItem = Annotated[
    UserFileImport | UnavailableUserFileImport,
    Field(discriminator="availability"),
]


class UserFileImportPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[UserFileImportItem]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_items: int = Field(ge=0)
    total_pages: int = Field(ge=0)


__all__ = [
    "UnavailableUserFileImport",
    "UserFileImportItem",
    "UserFileImportPage",
]
