"""FastAPI integration models for DocWorkspace."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ColumnSchema(BaseModel):
    """Schema information for a single column."""

    name: str
    dtype: str
    js_type: str = Field(
        ...,
        description=(
            "JavaScript-compatible type "
            "(string, categorical, integer, float, boolean, datetime, "
            "list_string, unknown)"
        ),
    )


class NodeSummary(BaseModel):
    """Summary information about a Node for API responses."""

    id: str
    name: str
    operation: Optional[str] = None
    shape: tuple[int, int] = (0, 0)
    columns: List[str] = Field(default_factory=list)
    node_schema: List[ColumnSchema] = Field(default_factory=list, alias="schema")
    document: Optional[str] = None
    parent_ids: List[str] = Field(default_factory=list)
    child_ids: List[str] = Field(default_factory=list)


class PaginatedData(BaseModel):
    """Paginated data response for large datasets."""

    data: List[Dict[str, Any]]
    pagination: Dict[str, Any] = Field(
        default_factory=lambda: {
            "page": 1,
            "page_size": 100,
            "total_rows": 0,
            "total_pages": 0,
            "has_next": False,
            "has_previous": False,
        }
    )
    columns: List[str] = Field(default_factory=list)
    data_schema: List[ColumnSchema] = Field(default_factory=list, alias="schema")


class ErrorResponse(BaseModel):
    """Standard error response format."""

    error: str
    message: str
    details: Optional[Dict[str, Any]] = None


class OperationResult(BaseModel):
    """Result of a workspace operation."""

    success: bool
    message: str
    node_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    errors: List[str] = Field(default_factory=list)
