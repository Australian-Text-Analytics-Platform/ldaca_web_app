"""
FastAPI utilities for DocWorkspace integration.

This module contains API-specific functionality that was moved from
docworkspace to keep the core library general-purpose.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

import polars as pl
from docworkspace import Node, Workspace

from docframe import DocLazyFrame

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
            polars_type: Polars data type object (e.g., pl.Int64, pl.Float32)

        Returns:
            JavaScript-compatible type string: 'integer', 'float', 'string', 'boolean', 'datetime', 'array', 'categorical'
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
        if polars_type == pl.Categorical:
            return "categorical"
        if polars_type in (pl.Utf8, pl.String):
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
        return "string"  # To be changed to 'unknown' in future versions

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

        # Remove internal-only fields from display while preserving document metadata
        info.pop("dtype", None)
        document_value = info.pop("document", None)
        if document_value is None:
            document_value = info.pop("document_column", None)
        if document_value is not None:
            info["document"] = document_value

        # Explicitly add columns field for frontend compatibility
        if "columns" not in info:
            cols = []
            try:
                data_obj = getattr(node, "data", node)
                if isinstance(data_obj, DocLazyFrame):
                    data_obj = data_obj.lazyframe

                if hasattr(data_obj, "collect_schema"):
                    cols = data_obj.collect_schema().names()
                elif hasattr(data_obj, "columns"):
                    cols = data_obj.columns
            except Exception:
                pass

            # Sanitize non-serializable objects (e.g., Mock) that could cause recursion
            if isinstance(cols, (list, tuple)):
                safe_cols = list(cols)
            else:
                try:
                    if hasattr(cols, "__iter__") and not isinstance(cols, (str, bytes)):
                        safe_cols = [c for c in list(cols)]  # type: ignore[arg-type]
                    else:
                        safe_cols = []
                except Exception:
                    safe_cols = []
            info["columns"] = safe_cols

        return info

    @staticmethod
    def get_node_schema(node: Any) -> List[ColumnSchema]:
        """Extract schema information from a Node."""
        schema_data = []

        try:
            data_obj = getattr(node, "data", node)

            # Unwrap DocLazyFrame
            if isinstance(data_obj, DocLazyFrame):
                data_obj = data_obj.lazyframe

            # Get schema efficiently
            data_schema = None
            if hasattr(data_obj, "collect_schema"):
                data_schema = data_obj.collect_schema()
            elif hasattr(data_obj, "schema"):
                data_schema = data_obj.schema

            if data_schema:
                # data_schema is Schema object or dict
                items = (
                    data_schema.items()
                    if hasattr(data_schema, "items")
                    else data_schema
                )

                for col_name, polars_type in items:
                    js_type = DocWorkspaceAPIUtils.polars_type_to_js_type(polars_type)
                    schema_data.append(
                        ColumnSchema(
                            name=col_name,
                            dtype=str(polars_type),  # Convert to string for storage
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
    def compute_node_shape(target: Any) -> Tuple[int, int]:
        """Calculate the actual shape of a node.

        Always returns (rows, cols). For lazy frames, this triggers a count query.
        """
        data_obj = getattr(target, "data", target)

        # 1. Try direct shape attribute (e.g. DataFrame)
        if hasattr(data_obj, "shape"):
            try:
                shape = data_obj.shape
                if isinstance(shape, (list, tuple)) and len(shape) >= 2:
                    return (int(shape[0]), int(shape[1]))
            except Exception:
                pass

        # 2. Handle LazyFrame (Polars or DocLazyFrame)
        # Unwrap DocLazyFrame if needed to get to the Polars LazyFrame
        inner_obj = data_obj
        if isinstance(data_obj, DocLazyFrame):
            inner_obj = data_obj.lazyframe

        rows = 0
        cols = 0

        # Get columns count
        try:
            # Prefer collect_schema() for LazyFrame to avoid PerformanceWarning
            if hasattr(inner_obj, "collect_schema"):
                cols = len(inner_obj.collect_schema())
            elif hasattr(inner_obj, "columns"):
                cols = len(inner_obj.columns)
        except Exception:
            pass

        # Get row count (force calculation for lazy frames)
        try:
            if hasattr(inner_obj, "select") and hasattr(inner_obj, "collect"):
                # Efficient count for Polars LazyFrame
                rows = inner_obj.select(pl.len()).collect().item()
        except Exception:
            pass

        return (rows, cols)

    @staticmethod
    def node_to_summary(node: Any) -> NodeSummary:
        """Convert a Node to NodeSummary for API responses."""
        try:
            # Get basic node information
            columns = getattr(node, "columns", [])

            shape = DocWorkspaceAPIUtils.compute_node_shape(node)

            node_summary = NodeSummary(
                id=node.id,
                name=node.name,
                data_type=DocWorkspaceAPIUtils.get_data_type(node),
                operation=getattr(node, "operation", None),
                shape=shape,
                columns=columns,
                schema=DocWorkspaceAPIUtils.get_node_schema(node),  # alias
                document=getattr(node, "document", None),
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
                columns=[],
                schema=[],
                shape=(0, 0),
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

            shape = DocWorkspaceAPIUtils.compute_node_shape(node)

            react_node = ReactFlowNode(
                id=node_id,
                type="customNode",
                position=position,
                data={
                    "label": node.name,
                    "nodeType": DocWorkspaceAPIUtils.get_data_type(node).value,
                    "shape": shape,
                    "columns": getattr(node, "columns", []),
                    "document": getattr(node, "document", None),
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


# Note: We intentionally do NOT auto-extend core classes at import time.
# This preserves the separation between the core docworkspace library and the backend API.
# If extension methods are desired for an interactive session, call the functions
# explicitly: extend_node_with_api_methods(); extend_workspace_with_api_methods().
