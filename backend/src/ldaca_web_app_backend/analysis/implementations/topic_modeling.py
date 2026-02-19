"""Topic-modeling analysis request schema module.

Used by:
- topic-modeling routes and worker task request validation

Why:
- Keeps topic-modeling specific input contract centralized.
"""

from typing import Dict, List, Optional

from pydantic import Field

from ..models import BaseAnalysisRequest


class TopicModelingRequest(BaseAnalysisRequest):
    """
    Request model for topic-modeling analysis.

    Used by:
    - topic-modeling run/update endpoints

    Why:
    - Validates node selection and clustering configuration inputs.

    Refactor note:
    - `use_ctfidf` is marked unused compatibility field; remove when frontend/API
        contract no longer depends on it.
    """

    node_ids: List[str] = Field(..., description="List of node IDs to analyze")
    node_columns: Optional[Dict[str, str]] = Field(
        None, description="Map of node_id to column name"
    )
    min_topic_size: Optional[int] = Field(
        5, description="DBSCAN min_points (minimum cluster size)"
    )
    use_ctfidf: Optional[bool] = Field(
        False, description="Unused (kept for compatibility)"
    )
