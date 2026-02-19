"""Sequential analysis request schema module.

Used by:
- sequential analysis routes and task persistence models

Why:
- Keeps sequential-analysis specific request fields versioned in one place.
"""

from typing import List, Optional

from pydantic import Field

from ..models import BaseAnalysisRequest


class SequentialAnalysisRequest(BaseAnalysisRequest):
    """
    Request model for sequential analysis.

    Used by:
    - sequential analysis run/update endpoints

    Why:
    - Validates temporal grouping and binning parameters.

    Refactor note:
    - `column_type`, `numeric_origin`, and `numeric_interval` are declared twice;
        remove duplicated declarations to reduce schema ambiguity.
    """

    node_id: Optional[str] = Field(None, description="Node ID to analyze")
    time_column: str = Field(..., description="Column containing time/numeric data")
    group_by_columns: Optional[List[str]] = Field(
        None, description="Columns to group by"
    )
    frequency: str = Field(
        "monthly", description="Frequency (daily, weekly, monthly, yearly)"
    )
    sort_by_time: bool = Field(True, description="Whether to sort by time")
    column_type: str = Field(
        "datetime", description="Column type (datetime or numeric)"
    )
    numeric_origin: Optional[float] = Field(
        None, description="Origin for numeric binning"
    )
    numeric_interval: Optional[float] = Field(
        None, description="Interval for numeric binning"
    )
    column_type: str = Field(
        "datetime", description="Column type (datetime or numeric)"
    )
    numeric_origin: Optional[float] = Field(
        None, description="Origin for numeric binning"
    )
    numeric_interval: Optional[float] = Field(
        None, description="Interval for numeric binning"
    )
