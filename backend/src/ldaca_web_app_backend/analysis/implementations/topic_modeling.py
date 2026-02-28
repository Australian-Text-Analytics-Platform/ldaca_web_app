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

    """

    node_ids: List[str] = Field(..., description="List of node IDs to analyze")
    node_columns: Optional[Dict[str, str]] = Field(
        None, description="Map of node_id to column name"
    )
    min_topic_size: Optional[int] = Field(
        5, description="DBSCAN min_points (minimum cluster size)"
    )
