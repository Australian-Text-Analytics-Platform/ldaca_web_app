"""Topic-modeling analysis request schema module.

Used by:
- topic-modeling routes and worker task request validation

Why:
- Keeps topic-modeling specific input contract centralized.
"""

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

    node_ids: list[str] = Field(..., description="List of node IDs to analyze")
    node_columns: dict[str, str] | None = Field(
        None, description="Map of node_id to column name"
    )
    min_topic_size: int = Field(
        5, description="DBSCAN min_points (minimum cluster size)"
    )
    random_seed: int = Field(
        42, description="Random seed used for reproducible topic-modeling runs"
    )
    representative_words_count: int = Field(
        5, description="Number of representative words to keep per topic"
    )
