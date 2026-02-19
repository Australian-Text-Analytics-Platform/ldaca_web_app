"""Concordance analysis request/result schema module.

Used by:
- concordance analysis API routes and task persistence payloads

Why:
- Keeps concordance-specific request/result contracts separated from route logic.
"""

from typing import Any, Dict, List, Optional

from pydantic import Field

from ..models import BaseAnalysisRequest
from ..results import BaseAnalysisResult


class ConcordanceRequest(BaseAnalysisRequest):
    """Request payload schema for concordance runs.

    Used by:
    - concordance route/task creation flows

    Why:
    - Validates all search/context/pagination-related analysis inputs.
    """

    node_ids: List[str]
    node_columns: Optional[Dict[str, str]] = None
    search_word: str
    num_left_tokens: int = 50
    num_right_tokens: int = 50
    regex: bool = False
    case_sensitive: bool = False
    combined: bool = False


class ConcordanceResult(BaseAnalysisResult):
    """Serializable concordance result wrapper.

    Used by:
    - analysis task result serialization helpers

    Why:
    - Provides a consistent JSON output shape for concordance payloads.
    """

    def __init__(self, results: List[Dict[str, Any]], total_hits: int):
        self.results = results
        self.total_hits = total_hits

    def to_json(self, **kwargs: Any) -> Dict[str, Any]:
        """Return JSON-serializable concordance payload."""
        return {
            "results": self.results,
            "total_hits": self.total_hits,
        }
