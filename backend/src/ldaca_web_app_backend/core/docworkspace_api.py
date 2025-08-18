"""
FastAPI utilities for DocWorkspace integration.

This module contains API-specific functionality that was moved from
docworkspace to keep the core library general-purpose.
"""

import math
from typing import Any, Dict, List, Optional

import polars as pl

from docworkspace import Node, Workspace

# Import API models
from .api_models import (
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
    def polars_type_to_js_type(polars_type: pl.DataType) -> str:
        """Convert Polars data type to JavaScript-compatible type.

        Args:
            polars_type: Polars data type object (e.g., pl.Int64, pl.Float32) or string representation

        Returns:
            JavaScript-compatible type string: 'integer', 'float', 'string', 'boolean', 'datetime', 'array'
        """
        # Identity-based classification (no pattern matching) to support wider runtime versions.
        if polars_type in (
            pl.Int8,
            pl.Int16,
            pl.Int32,
            pl.Int64,
            pl.UInt8,
            pl.UInt16,
            pl.UInt32,
            pl.UInt64,
        ):
            return "integer"
        if polars_type in (pl.Float32, pl.Float64):
            return "float"
        if polars_type == pl.Boolean:
            return "boolean"
        if polars_type in (pl.Utf8, getattr(pl, "String", pl.Utf8)):
            return "string"
        if polars_type in (pl.Date, pl.Datetime, pl.Time):
            return "datetime"
        # Detect list/struct types safely
        cls_obj = getattr(polars_type, "__class__", None)
        cls_name = getattr(cls_obj, "__name__", "") if cls_obj else ""
        type_name = (
            getattr(polars_type, "__name__", "")
            if hasattr(polars_type, "__name__")
            else ""
        )
        lowered_type = type_name.lower()
        if cls_name == "List" or lowered_type == "list":
            return "array"
        if cls_name == "Struct" or lowered_type == "struct":
            return "object"
        return "string"

    @staticmethod
    def convert_schema_to_js_types(schema) -> Dict[str, str]:
        """Convert a Polars schema to JavaScript-compatible types.

        This function handles the conversion that was previously done in
        docworkspace's schema_to_json function, but belongs in the API layer.
        """
        if schema is None:
            return {}

        # Handle both dict-like schemas and Polars Schema objects
        if hasattr(schema, "items"):
            # Polars Schema object or dict - pass the actual type objects
            return {
                col_name: DocWorkspaceAPIUtils.polars_type_to_js_type(col_type)
                for col_name, col_type in schema.items()
            }
        elif isinstance(schema, dict):
            # Already a dict - pass the values as-is (could be type objects or strings)
            return {
                col_name: DocWorkspaceAPIUtils.polars_type_to_js_type(col_type)
                for col_name, col_type in schema.items()
            }
        else:
            return {}

    @staticmethod
    def convert_node_info_for_api(node: Any) -> Dict[str, Any]:
        """Convert node info to API-compatible format with JS types.

        This replaces the node.info(json=True) pattern by getting raw node info
        and converting the schema to JS types in the API layer.
        """
        # Get raw node info (no JSON conversion in core library)
        info = node.info()

        # Convert schema to JS types if present
        if "schema" in info and info["schema"] is not None:
            info["schema"] = DocWorkspaceAPIUtils.convert_schema_to_js_types(
                info["schema"]
            )

        # Ensure dtype is a string for JSON serialization
        if "dtype" in info and not isinstance(info["dtype"], str):
            dtype = info["dtype"]
            info["dtype"] = f"{dtype.__module__}.{dtype.__name__}"

        return info

    @staticmethod
    def get_node_schema(node: Any) -> List[ColumnSchema]:
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
                            polars_type = data_schema[col_name]  # Keep as type object
                            # Pass the actual type object, not string
                            js_type = DocWorkspaceAPIUtils.polars_type_to_js_type(
                                polars_type
                            )
                            schema_data.append(
                                ColumnSchema(
                                    name=col_name,
                                    dtype=str(
                                        polars_type
                                    ),  # Convert to string for storage
                                    js_type=js_type,
                                )
                            )
        except Exception:
            # Fallback for any schema extraction issues
            pass

        return schema_data

    @staticmethod
    def get_data_type(node: Any) -> DataType:
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
    def node_to_summary(node: Any) -> NodeSummary:
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
                schema=DocWorkspaceAPIUtils.get_node_schema(node),  # alias
                document_column=getattr(node, "document_column", None),
                parent_ids=[parent.id for parent in getattr(node, "parents", [])],
                child_ids=[child.id for child in getattr(node, "children", [])],
            )

            return node_summary

        except Exception:
            # Return minimal summary if detailed extraction fails
            return NodeSummary(
                id=getattr(node, "id", "unknown"),
                name=getattr(node, "name", "unknown"),
                data_type=DataType.POLARS_DATAFRAME,  # Default fallback
                is_lazy=getattr(node, "is_lazy", False),
                columns=[],
                schema=[],
            )

    @staticmethod
    def get_paginated_data(
        node: Any,
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
                schema=DocWorkspaceAPIUtils.get_node_schema(node),
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
                schema=[],
            )

    @staticmethod
    def workspace_to_react_flow(
        workspace: Any, layout_algorithm: str = "grid", node_spacing: int = 250
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
                    "documentColumn": getattr(node, "document_column", None),
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

    # Dynamic monkey patching (acceptable here) - ignore type checker
    Node.to_api_summary = to_api_summary  # type: ignore[attr-defined]
    Node.get_paginated_data = get_paginated_data  # type: ignore[attr-defined]


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
                # Node can be None at import time; guard before isinstance
                if Node is not None and isinstance(result, Node):  # type: ignore[arg-type]
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

    Workspace.to_api_graph = to_api_graph  # type: ignore[attr-defined]
    Workspace.get_node_summaries = get_node_summaries  # type: ignore[attr-defined]
    Workspace.safe_operation = safe_operation  # type: ignore[attr-defined]


# Auto-extend classes when module is imported
extend_node_with_api_methods()
extend_workspace_with_api_methods()
