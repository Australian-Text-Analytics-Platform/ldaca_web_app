from typing import Dict, List, Optional

from pydantic import Field

from ..models import BaseAnalysisRequest


class TopicModelingRequest(BaseAnalysisRequest):
    """
    Request model for Topic Modeling analysis.
    """

    node_ids: List[str] = Field(..., description="List of node IDs to analyze")
    node_columns: Optional[Dict[str, str]] = Field(
        None, description="Map of node_id to column name"
    )
    min_topic_size: Optional[int] = Field(5, description="Minimum topic size")
    use_ctfidf: Optional[bool] = Field(False, description="Whether to use c-TF-IDF")
