"""Resolved internal quotation-provider configuration."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

from ..domain.workspace.analysis import QuotationEngineType


class LocalResolvedQuotationEngine(BaseModel):
    """The bundled quotation engine after request resolution."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal[QuotationEngineType.LOCAL] = QuotationEngineType.LOCAL


class RemoteResolvedQuotationEngine(BaseModel):
    """One allowlist-resolved remote quotation v2 origin."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal[QuotationEngineType.REMOTE] = QuotationEngineType.REMOTE
    url: AnyHttpUrl


type ResolvedQuotationEngine = Annotated[
    LocalResolvedQuotationEngine | RemoteResolvedQuotationEngine,
    Field(discriminator="type"),
]


class RemoteQuotationDocument(BaseModel):
    """One ordered document sent to a v2 remote Quotation engine."""

    model_config = ConfigDict(extra="forbid", strict=True)

    id: str = Field(min_length=1)
    text: str


class RemoteQuotationQuote(BaseModel):
    """One strict remote quote with complete source-offset coverage."""

    model_config = ConfigDict(extra="forbid", strict=True)

    speaker: str | None
    speaker_start_idx: int | None = Field(ge=0)
    speaker_end_idx: int | None = Field(ge=0)
    quote: str
    quote_start_idx: int = Field(ge=0)
    quote_end_idx: int = Field(ge=0)
    verb: str | None
    verb_start_idx: int | None = Field(ge=0)
    verb_end_idx: int | None = Field(ge=0)
    quote_type: str | None
    quote_token_count: int = Field(ge=0)
    is_floating_quote: bool
    quote_row_idx: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_offset_pairs(self) -> RemoteQuotationQuote:
        for value, start, end, label in (
            (self.speaker, self.speaker_start_idx, self.speaker_end_idx, "speaker"),
            (self.verb, self.verb_start_idx, self.verb_end_idx, "verb"),
        ):
            if value is None and (start is not None or end is not None):
                raise ValueError(f"Remote quotation {label} offsets require a value")
            if value is not None and (start is None or end is None):
                raise ValueError(f"Remote quotation {label} requires both offsets")
            if start is not None and end is not None and start > end:
                raise ValueError(f"Remote quotation {label} offsets are reversed")
        if self.quote_start_idx > self.quote_end_idx:
            raise ValueError("Remote quotation quote offsets are reversed")
        return self


class RemoteQuotationResult(BaseModel):
    """All quotes for exactly one requested document identity."""

    model_config = ConfigDict(extra="forbid", strict=True)

    id: str = Field(min_length=1)
    quotes: list[RemoteQuotationQuote]


class RemoteQuotationExtractRequest(BaseModel):
    """Versioned wire request for `/api/v2/quotation/extract`."""

    model_config = ConfigDict(extra="forbid", strict=True)

    version: Literal[2]
    documents: list[RemoteQuotationDocument] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_document_ids(self) -> RemoteQuotationExtractRequest:
        ids = [document.id for document in self.documents]
        if len(ids) != len(set(ids)):
            raise ValueError("Remote quotation document IDs must be unique")
        return self


class RemoteQuotationExtractResponse(BaseModel):
    """Versioned wire response containing one item per request identity."""

    model_config = ConfigDict(extra="forbid", strict=True)

    version: Literal[2]
    results: list[RemoteQuotationResult]


__all__ = [
    "LocalResolvedQuotationEngine",
    "RemoteQuotationDocument",
    "RemoteQuotationExtractRequest",
    "RemoteQuotationExtractResponse",
    "RemoteQuotationQuote",
    "RemoteQuotationResult",
    "RemoteResolvedQuotationEngine",
    "ResolvedQuotationEngine",
]
