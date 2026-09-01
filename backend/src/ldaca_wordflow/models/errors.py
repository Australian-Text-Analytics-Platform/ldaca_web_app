"""Public request-correlated API error resource."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from ..shared.json_data import JsonData


class ApiError(BaseModel):
    """Request-correlated error body returned by every JSON HTTP error handler."""

    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    details: dict[str, JsonData] | list[dict[str, JsonData]] | None = None
    request_id: str


__all__ = ["ApiError"]
