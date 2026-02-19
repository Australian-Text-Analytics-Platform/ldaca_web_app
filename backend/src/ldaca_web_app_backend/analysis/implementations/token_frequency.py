"""Token-frequency analysis request schema module.

Used by:
- token-frequency routes and worker task request validation

Why:
- Keeps token-frequency analysis input contract centralized.
"""

from typing import Dict, List, Optional

from pydantic import Field

from ..models import BaseAnalysisRequest


class TokenFrequencyRequest(BaseAnalysisRequest):
    """
    Request model for token-frequency analysis.

    Used by:
    - token-frequency run/update endpoints

    Why:
    - Validates node selection, stop-word, and token-limit parameters.
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
