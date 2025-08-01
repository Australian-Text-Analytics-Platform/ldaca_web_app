"""
FastAPI utilities for DocWorkspace integration.

This module contains API-specific functionality that was moved from
docworkspace to keep the core library general-purpose.
"""

import math
from typing import Any, Dict, List, Optional

import polars as pl
from core.utils import DOCWORKSPACE_AVAILABLE

if DOCWORKSPACE_AVAILABLE:
    from docworkspace import Node, Workspace
else:
    Node = None
    Workspace = None

# Import API models
from core.api_models import (
    ColumnSchema,
    DataType,
    ErrorResponse,
    NodeSummary,
    OperationResult,
    PaginatedData,
    ReactFlowEdge,
    ReactFlowNode,
    WorkspaceGraph,
    WorkspaceInfo,
)


class DocWorkspaceAPIUtils:
    """Utility class for FastAPI integration with DocWorkspace."""

    @staticmethod
    def polars_type_to_js_type(polars_type: str) -> str:
        """Convert Polars data type to JavaScript-compatible type."""
        type_str = str(polars_type).lower()

        if any(x in type_str for x in ["int", "float", "double", "decimal"]):
            return "number"
        elif any(x in type_str for x in ["str", "string", "utf8"]):
            return "string"
        elif any(x in type_str for x in ["bool", "boolean"]):
            return "boolean"
        elif any(x in type_str for x in ["date", "time", "datetime"]):
            return "datetime"
        elif "list" in type_str:
            return "string"  # Simplified for now, could be enhanced
        else:
            return "string"  # Default fallback

    @staticmethod
    def get_node_schema(node: "Node") -> List[ColumnSchema]:
        """Extract schema information from a Node."""
        schema_data = []

        try:
            # Get the underlying data schema
            if hasattr(node, "columns"):
                columns = node.columns
                # Try to get schema from underlying data
                if hasattr(node.data, "schema"):
                    data_schema = node.data.schema
                    for col_name in columns:
                        if col_name in data_schema:
                            polars_type = str(data_schema[col_name])
                            js_type = DocWorkspaceAPIUtils.polars_type_to_js_type(
                                polars_type
                            )
                            schema_data.append(
                                ColumnSchema(
                                    name=col_name, dtype=polars_type, js_type=js_type
                                )
                            )
        except Exception:
            # Fallback for any schema extraction issues
            pass

        return schema_data

    @staticmethod
    def get_data_type(node: "Node") -> DataType:
        """Determine the DataType enum value for a node."""
        data_type_name = type(node.data).__name__

        if "DocDataFrame" in data_type_name:
            return DataType.DOC_DATAFRAME
        elif "DocLazyFrame" in data_type_name:
            return DataType.DOC_LAZYFRAME
        elif "LazyFrame" in data_type_name:
            return DataType.POLARS_LAZYFRAME
        else:
            return DataType.POLARS_DATAFRAME

    @staticmethod
    def node_to_summary(node: "Node") -> NodeSummary:
        """Convert a Node to NodeSummary for API responses."""
        try:
            # Get basic node information
            columns = getattr(node, "columns", [])

            # Implement two-tier shape interface for performance:
            # For LazyFrames: return (None, column_count) to avoid expensive row calculation
            # For DataFrames: return full (row_count, column_count)
            shape = None
            try:
                if node.is_lazy:
                    # For lazy frames, only get column count without materializing
                    if hasattr(node.data, "collect_schema"):
                        column_count = len(node.data.collect_schema().names())
                        shape = (None, column_count)
                    elif hasattr(node.data, "columns"):
                        column_count = len(node.data.columns)
                        shape = (None, column_count)
                else:
                    # For materialized DataFrames, get full shape
                    if hasattr(node.data, "shape"):
                        shape = node.data.shape
            except (AttributeError, Exception):
                shape = None

            node_summary = NodeSummary(
                id=node.id,
                name=node.name,
                data_type=DocWorkspaceAPIUtils.get_data_type(node),
                is_lazy=node.is_lazy,
                operation=getattr(node, "operation", None),
                shape=shape,
                columns=columns,
                node_schema=DocWorkspaceAPIUtils.get_node_schema(node),
                document_column=getattr(node, "document_column", None),
                parent_ids=[parent.id for parent in getattr(node, "parents", [])],
                child_ids=[child.id for child in getattr(node, "children", [])],
            )

            return node_summary

        except Exception:
            # Return minimal summary if detailed extraction fails
            return NodeSummary(
                id=node.id,
                name=node.name,
                data_type=DataType.POLARS_DATAFRAME,  # Default fallback
                is_lazy=getattr(node, "is_lazy", False),
                columns=[],
                node_schema=[],
            )

    @staticmethod
    def get_paginated_data(
        node: "Node",
        page: int = 1,
        page_size: int = 100,
        columns: Optional[List[str]] = None,
    ) -> PaginatedData:
        """Get paginated data from a Node."""
        try:
            # Calculate pagination
            total_rows = node.shape[0] if hasattr(node, "shape") else 0
            total_pages = math.ceil(total_rows / page_size) if total_rows > 0 else 0
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size

            # Get data slice
            if hasattr(node, "slice"):
                sliced_data = node.slice(start_idx, end_idx)
            else:
                # Fallback to head if slice not available
                sliced_data = node.head(page_size) if page == 1 else node

            # Convert to dict format for API
            data_list = []
            if hasattr(sliced_data, "to_dicts"):
                data_list = sliced_data.to_dicts()
            elif hasattr(sliced_data.data, "to_dicts"):
                data_list = sliced_data.data.to_dicts()

            # Get columns
            node_columns = columns or getattr(node, "columns", [])

            return PaginatedData(
                data=data_list,
                pagination={
                    "page": page,
                    "page_size": page_size,
                    "total_rows": total_rows,
                    "total_pages": total_pages,
                    "has_next": page < total_pages,
                    "has_previous": page > 1,
                },
                columns=node_columns,
                data_schema=DocWorkspaceAPIUtils.get_node_schema(node),
            )

        except Exception:
            # Return empty paginated data on error
            return PaginatedData(
                data=[],
                pagination={
                    "page": page,
                    "page_size": page_size,
                    "total_rows": 0,
                    "total_pages": 0,
                    "has_next": False,
                    "has_previous": False,
                },
                columns=[],
                data_schema=[],
            )

    @staticmethod
    def workspace_to_react_flow(
        workspace: "Workspace", layout_algorithm: str = "grid", node_spacing: int = 250
    ) -> WorkspaceGraph:
        """Convert workspace to React Flow compatible graph."""
        nodes = []
        edges = []

        # Create React Flow nodes
        for i, (node_id, node) in enumerate(workspace.nodes.items()):
            # Calculate position based on layout algorithm
            position = DocWorkspaceAPIUtils._calculate_layout(
                i, len(workspace.nodes), layout_algorithm, node_spacing
            )

            # Get shape using the same logic as node_to_summary
            shape = None
            try:
                if node.is_lazy:
                    # For lazy frames, only get column count without materializing
                    if hasattr(node.data, "collect_schema"):
                        column_count = len(node.data.collect_schema().names())
                        shape = [None, column_count]  # Use list for JSON compatibility
                    elif hasattr(node.data, "columns"):
                        column_count = len(node.data.columns)
                        shape = [None, column_count]
                else:
                    # For materialized DataFrames, get full shape
                    if hasattr(node.data, "shape"):
                        shape = list(node.data.shape)  # Convert tuple to list for JSON
            except (AttributeError, Exception):
                shape = None

            react_node = ReactFlowNode(
                id=node_id,
                type="customNode",
                position=position,
                data={
                    "label": node.name,
                    "nodeType": DocWorkspaceAPIUtils.get_data_type(node).value,
                    "isLazy": node.is_lazy,
                    "shape": shape,
                    "columns": getattr(node, "columns", []),
                },
                connectable=True,
            )
            nodes.append(react_node)

        # Create React Flow edges from parent-child relationships
        edge_id = 0
        for node_id, node in workspace.nodes.items():
            if hasattr(node, "parents"):
                for parent in node.parents:
                    edge = ReactFlowEdge(
                        id=f"edge-{edge_id}",
                        source=parent.id,
                        target=node_id,
                        type="smoothstep",
                        animated=False,
                    )
                    edges.append(edge)
                    edge_id += 1

        # Create workspace info
        workspace_info = WorkspaceInfo(
            id=workspace.id,
            name=workspace.name,
            total_nodes=len(workspace.nodes),
            root_nodes=len(workspace.get_root_nodes()),
            leaf_nodes=len(workspace.get_leaf_nodes()),
            created_at=getattr(workspace, "created_at", None),
            modified_at=getattr(workspace, "modified_at", None),
        )

        return WorkspaceGraph(nodes=nodes, edges=edges, workspace_info=workspace_info)

    @staticmethod
    def _calculate_layout(
        index: int, total_nodes: int, algorithm: str, spacing: int
    ) -> Dict[str, float]:
        """Calculate node position based on layout algorithm."""
        if algorithm == "grid":
            cols = math.ceil(math.sqrt(total_nodes))
            row = index // cols
            col = index % cols
            return {"x": col * spacing, "y": row * spacing}

        elif algorithm == "circular":
            angle = (2 * math.pi * index) / total_nodes
            radius = max(100, total_nodes * 20)
            return {"x": radius * math.cos(angle), "y": radius * math.sin(angle)}

        elif algorithm == "hierarchical":
            # Simple hierarchical layout - could be enhanced
            return {"x": index * spacing, "y": 0}

        else:
            # Default to grid
            return DocWorkspaceAPIUtils._calculate_layout(
                index, total_nodes, "grid", spacing
            )


def handle_api_error(error: Exception) -> ErrorResponse:
    """Convert exception to standardized API error response."""
    return ErrorResponse(
        error=type(error).__name__,
        message=str(error),
        details={"exception_type": type(error).__name__},
    )


def create_operation_result(
    success: bool,
    message: str,
    node_id: Optional[str] = None,
    data: Optional[Dict[str, Any]] = None,
    errors: Optional[List[str]] = None,
) -> OperationResult:
    """Create standardized operation result."""
    return OperationResult(
        success=success,
        message=message,
        node_id=node_id,
        data=data or {},
        errors=errors or [],
    )


# Extension methods for Node and Workspace classes
def extend_node_with_api_methods():
    """Add API methods to Node class if available."""
    if Node is not None:

        def to_api_summary(self):
            """Convert node to API summary."""
            return DocWorkspaceAPIUtils.node_to_summary(self)

        def get_paginated_data(
            self,
            page: int = 1,
            page_size: int = 100,
            columns: Optional[List[str]] = None,
        ):
            """Get paginated data for API responses."""
            return DocWorkspaceAPIUtils.get_paginated_data(
                self, page, page_size, columns
            )

        Node.to_api_summary = to_api_summary
        Node.get_paginated_data = get_paginated_data


def extend_workspace_with_api_methods():
    """Add API methods to Workspace class if available."""
    if Workspace is not None:

        def to_api_graph(self, layout_algorithm: str = "grid", node_spacing: int = 250):
            """Convert workspace to React Flow graph."""
            return DocWorkspaceAPIUtils.workspace_to_react_flow(
                self, layout_algorithm, node_spacing
            )

        def get_node_summaries(self):
            """Get API summaries of all nodes."""
            return [
                DocWorkspaceAPIUtils.node_to_summary(node)
                for node in self.nodes.values()
            ]

        def safe_operation(self, operation_func, *args, **kwargs):
            """Execute operation safely and return result."""
            try:
                result = operation_func(*args, **kwargs)
                if isinstance(result, Node):
                    return create_operation_result(
                        success=True,
                        message="Operation completed successfully",
                        node_id=result.id,
                        data={
                            "node_name": result.name,
                            "data_type": type(result.data).__name__,
                        },
                    )
                else:
                    return create_operation_result(
                        success=True,
                        message="Operation completed successfully",
                        data={"result": str(result)},
                    )
            except Exception as e:
                error_response = handle_api_error(e)
                return create_operation_result(
                    success=False,
                    message=f"Operation failed: {error_response.message}",
                    errors=[error_response.error],
                )

        Workspace.to_api_graph = to_api_graph
        Workspace.get_node_summaries = get_node_summaries
        Workspace.safe_operation = safe_operation


# Auto-extend classes when module is imported
if DOCWORKSPACE_AVAILABLE:
    extend_node_with_api_methods()
    extend_workspace_with_api_methods()
