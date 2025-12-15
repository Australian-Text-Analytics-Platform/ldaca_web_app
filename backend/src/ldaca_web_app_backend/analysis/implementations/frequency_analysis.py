from typing import List, Optional

from pydantic import Field

from ..models import AnalysisRequest


class FrequencyAnalysisRequest(AnalysisRequest):
    """
    Request model for Frequency Analysis.
    """

    node_id: Optional[str] = Field(None, description="Node ID to analyze")
    time_column: str = Field(..., description="Column containing time data")
    group_by_columns: Optional[List[str]] = Field(
        None, description="Columns to group by"
    )
    frequency: str = Field(
        "monthly", description="Frequency (daily, weekly, monthly, yearly)"
    )
    sort_by_time: bool = Field(True, description="Whether to sort by time")
    group_by_columns: Optional[List[str]] = Field(
        None, description="Columns to group by"
    )
    frequency: str = Field(
        "monthly", description="Frequency (daily, weekly, monthly, yearly)"
    )
    sort_by_time: bool = Field(True, description="Whether to sort by time")
