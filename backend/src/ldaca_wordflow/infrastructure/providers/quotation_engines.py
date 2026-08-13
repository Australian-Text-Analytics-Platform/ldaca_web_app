"""Resolve quotation selections through the operator-owned provider allowlist."""

from ...shared.errors import InvalidInputError
from ...models.quotation import (
    QuotationEngineSelection,
    QuotationEngineType,
    ResolvedQuotationEngine,
)
from ...settings import Settings


def resolve_quotation_engine(
    selection: QuotationEngineSelection,
    settings: Settings,
) -> ResolvedQuotationEngine:
    """Return a worker-only URL config or reject an unknown remote identity."""

    if selection.type is QuotationEngineType.LOCAL:
        return ResolvedQuotationEngine()
    endpoint = next(
        (
            engine.url
            for engine in settings.quotation_remote_engines
            if engine.id == selection.engine_id
        ),
        None,
    )
    if endpoint is None:
        raise InvalidInputError("Quotation engine is not configured")
    return ResolvedQuotationEngine(type=QuotationEngineType.REMOTE, url=endpoint)


__all__ = ["resolve_quotation_engine"]
