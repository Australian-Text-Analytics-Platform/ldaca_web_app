"""Quotation analysis implementation."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from ..models import BaseAnalysisRequest
from ..results import BaseAnalysisResult


class QuotationEngineConfig(BaseModel):
    type: str = "local"  # "local" or "remote"
    model: Optional[str] = None
    url: Optional[str] = None
    api_key: Optional[str] = None


class QuotationRequest(BaseAnalysisRequest):
    """Request for quotation analysis."""

    node_id: str
    column: str
    engine: Optional[QuotationEngineConfig] = None
    page: Optional[int] = 1
    page_size: Optional[int] = 50
    sort_by: Optional[str] = None
    sort_order: Optional[str] = "asc"
    context_length: Optional[int] = None


class QuotationResult(BaseAnalysisResult):
    """Result for quotation analysis."""

    def __init__(self, data: Dict[str, Any]):
        self.data = data

    def to_json(self, **kwargs: Any) -> Dict[str, Any]:
        return self.data
