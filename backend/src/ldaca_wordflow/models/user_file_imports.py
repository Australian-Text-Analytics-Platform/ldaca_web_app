"""Transport model for the retained User File Import collection."""

from pydantic import BaseModel, ConfigDict, Field

from ..domain import UserFileImport


class UserFileImportPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[UserFileImport]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_items: int = Field(ge=0)
    total_pages: int = Field(ge=0)


__all__ = ["UserFileImportPage"]
