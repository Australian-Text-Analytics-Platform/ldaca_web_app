"""Resolved internal quotation-provider configuration."""

from __future__ import annotations

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, model_validator

from ..domain.workspace.analysis import QuotationEngineSelection, QuotationEngineType


class ResolvedQuotationEngine(BaseModel):
    """Exact process input after a public engine selection is allowlist-resolved."""

    model_config = ConfigDict(extra="forbid")

    type: QuotationEngineType = QuotationEngineType.LOCAL
    url: AnyHttpUrl | None = None

    @model_validator(mode="after")
    def validate_location(self) -> ResolvedQuotationEngine:
        if self.type is QuotationEngineType.LOCAL and self.url is not None:
            raise ValueError("A local quotation engine has no URL")
        if self.type is QuotationEngineType.REMOTE and self.url is None:
            raise ValueError("A remote quotation engine requires a URL")
        return self


__all__ = [
    "QuotationEngineSelection",
    "QuotationEngineType",
    "ResolvedQuotationEngine",
]
