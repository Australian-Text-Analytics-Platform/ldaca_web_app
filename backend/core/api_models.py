"""FastAPI integration models for DocWorkspace."""

from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field


class DataType(str, Enum):
    """Supported data types in DocWorkspace."""

    POLARS_DATAFRAME = "polars.DataFrame"
    POLARS_LAZYFRAME = "polars.LazyFrame"
    DOC_DATAFRAME = "docframe.DocDataFrame"
    DOC_LAZYFRAME = "docframe.DocLazyFrame"


class ColumnSchema(BaseModel):
    """Schema information for a single column."""

    name: str
    dtype: str
    js_type: str = Field(
        ...,
        description="JavaScript-compatible type (string, number, boolean, datetime)",
    )


class NodeSummary(BaseModel):
    """Summary information about a Node for API responses."""

    id: str
    name: str
    data_type: DataType
    is_lazy: bool
    operation: Optional[str] = None
    shape: Optional[tuple[Optional[int], int]] = None
    columns: List[str] = Field(default_factory=list)
    node_schema: List[ColumnSchema] = Field(default_factory=list, alias="schema")
    document_column: Optional[str] = None
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


class ReactFlowNode(BaseModel):
    """React Flow compatible node representation."""

    id: str
    type: str = "customNode"
    position: Dict[str, float] = Field(default_factory=lambda: {"x": 0, "y": 0})
    data: Dict[str, Any]
    connectable: bool = True


class ReactFlowEdge(BaseModel):
    """React Flow compatible edge representation."""

    id: str
    source: str
    target: str
    type: str = "smoothstep"
    animated: bool = False
    markerEnd: Dict[str, Any] = Field(
        default_factory=lambda: {"type": "arrowclosed", "width": 20, "height": 20}
    )


class WorkspaceInfo(BaseModel):
    """Workspace metadata information."""

    id: str
    name: str
    total_nodes: int
    root_nodes: int
    leaf_nodes: int
    created_at: Optional[str] = None
    modified_at: Optional[str] = None


class WorkspaceGraph(BaseModel):
    """Complete workspace graph for React Flow."""

    nodes: List[ReactFlowNode]
    edges: List[ReactFlowEdge]
    workspace_info: WorkspaceInfo


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


# Type aliases for FastAPI route annotations
NodeResponse = Union[NodeSummary, ErrorResponse]
WorkspaceResponse = Union[WorkspaceGraph, ErrorResponse]
DataResponse = Union[PaginatedData, ErrorResponse]
