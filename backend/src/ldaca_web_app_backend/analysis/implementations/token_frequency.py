from typing import Dict, List, Optional

from pydantic import Field

from ..models import BaseAnalysisRequest


class TokenFrequencyRequest(BaseAnalysisRequest):
    """
    Request model for Token Frequency analysis.
    """

    node_ids: List[str] = Field(..., description="List of node IDs to analyze (1 or 2)")
    node_columns: Optional[Dict[str, str]] = Field(
        None, description="Map of node_id to column name"
    )
    stop_words: Optional[List[str]] = Field(
        None, description="List of stop words to exclude"
    )
    token_limit: Optional[int] = Field(
        None, description="Limit on number of tokens returned"
    )
