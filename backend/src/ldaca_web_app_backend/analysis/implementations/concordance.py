"""Concordance analysis implementation."""

from typing import Any, Dict, List, Optional

from pydantic import Field

from ..models import BaseAnalysisRequest
from ..results import BaseAnalysisResult


class ConcordanceRequest(BaseAnalysisRequest):
    """Request for concordance analysis."""

    node_ids: List[str]
    node_columns: Optional[Dict[str, str]] = None
    search_word: str
    num_left_tokens: int = 50
    num_right_tokens: int = 50
    regex: bool = False
    case_sensitive: bool = False
    combined: bool = False


class ConcordanceResult(BaseAnalysisResult):
    """Result for concordance analysis."""

    def __init__(self, results: List[Dict[str, Any]], total_hits: int):
        self.results = results
        self.total_hits = total_hits

    def to_json(self, **kwargs: Any) -> Dict[str, Any]:
        return {
            "results": self.results,
            "total_hits": self.total_hits,
        }
