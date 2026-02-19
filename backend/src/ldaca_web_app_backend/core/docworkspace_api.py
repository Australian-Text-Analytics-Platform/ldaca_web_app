"""
FastAPI utilities for DocWorkspace integration.

This module contains API-specific functionality that was moved from
docworkspace to keep the core library general-purpose.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

import polars as pl

# Import API models
from .api_models import (
    ColumnSchema,
    DataType,
    ErrorResponse,
    NodeSummary,
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
        """Convert Polars data type to JavaScript-compatible type."""
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
        if polars_type == pl.List(pl.String) or polars_type == pl.List(pl.Utf8):
            return "list_string"

        cls_obj = getattr(polars_type, "__class__", None)
        cls_name = getattr(cls_obj, "__name__", "") if cls_obj else ""
        type_name = (
            getattr(polars_type, "__name__", "")
            if hasattr(polars_type, "__name__")
            else ""
        )
        lowered_type = type_name.lower()
        if (
            cls_name == "List"
            or lowered_type == "list"
            or cls_name == "Array"
            or lowered_type == "array"
        ):
            return "unknown"
        if cls_name == "Struct" or lowered_type == "struct":
            return "object"
        return "unknown"

    @staticmethod
    def get_node_schema(node: Any) -> List[ColumnSchema]:
        """Extract schema information from a Node."""
        schema_data = []

        try:
            data_obj = getattr(node, "data", node)

            # Get schema efficiently
            data_schema = None
            if isinstance(data_obj, pl.LazyFrame):
                data_schema = data_obj.collect_schema()

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
        """Determine the DataType enum value for a node.

        Strict-design note:
        - Backend nodes are expected to be LazyFrame-backed.
        """
        data_obj = node.data if hasattr(node, "data") else node
        if isinstance(data_obj, pl.LazyFrame):
            return DataType.POLARS_LAZYFRAME
        return DataType.UNKNOWN

    @staticmethod
    def compute_node_shape(target: Any) -> Tuple[int, int]:
        """Calculate node shape as `(rows, cols)` for LazyFrame-backed nodes."""
        lazyframe = target.data if hasattr(target, "data") else target
        if not isinstance(lazyframe, pl.LazyFrame):
            return (0, 0)

        try:
            schema = lazyframe.collect_schema()
            cols = len(schema)
            rows = int(lazyframe.select(pl.len()).collect().item())
            return (rows, cols)
        except Exception:
            return (0, 0)

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
                schema=DocWorkspaceAPIUtils.get_node_schema(node),
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
                data_type=DataType.UNKNOWN,
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
        """Get paginated rows from a LazyFrame-backed node."""
        try:
            data_obj = node.data if hasattr(node, "data") else node
            if not isinstance(data_obj, pl.LazyFrame):
                raise TypeError("Node data must be a Polars LazyFrame")

            total_rows = int(data_obj.select(pl.len()).collect().item())
            total_pages = math.ceil(total_rows / page_size) if total_rows > 0 else 0
            start_idx = (page - 1) * page_size

            sliced_df = data_obj.slice(start_idx, page_size).collect()
            data_list = sliced_df.to_dicts()
            node_columns = columns or list(data_obj.collect_schema().names())

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
        """Convert workspace graph objects to React Flow-compatible payloads.

        Used by:
        - `WorkspaceManager.get_workspace_graph`

        Why:
        - Centralizes graph serialization and layout defaults.
        """
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
    """Convert exceptions into standardized API error payloads."""
    return ErrorResponse(
        error=type(error).__name__,
        message=str(error),
        details={"exception_type": type(error).__name__},
    )
