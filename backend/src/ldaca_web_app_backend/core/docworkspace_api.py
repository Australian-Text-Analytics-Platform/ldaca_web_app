"""
FastAPI utilities for DocWorkspace integration.

This module contains API-specific functionality that was moved from
docworkspace to keep the core library general-purpose.
"""

import math
from typing import Any, List, Optional, Tuple

import polars as pl

# Import API models
from .api_models import (
    ColumnSchema,
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
    def polars_dtype_to_ldaca_dtype(polars_dtype: pl.DataType) -> str:
        """Convert Polars dtype into LDaCA-controlled dtype categories."""
        if polars_dtype in (
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
        if polars_dtype in (pl.Float32, pl.Float64):
            return "float"
        if polars_dtype == pl.Boolean:
            return "boolean"
        if polars_dtype == pl.Categorical:
            return "categorical"
        if polars_dtype in (pl.Utf8, pl.String):
            return "string"
        if polars_dtype in (pl.Date, pl.Datetime, pl.Time):
            return "datetime"
        if polars_dtype == pl.List(pl.String) or polars_dtype == pl.List(pl.Utf8):
            return "list_string"

        cls_obj = getattr(polars_dtype, "__class__", None)
        cls_name = getattr(cls_obj, "__name__", "") if cls_obj else ""
        type_name = (
            getattr(polars_dtype, "__name__", "")
            if hasattr(polars_dtype, "__name__")
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
    def get_node_schema_json_with_ldaca_dtype(node: Any) -> List[ColumnSchema]:
        """Build JSON-ready column schema with LDaCA dtype mapping."""
        data_schema = node.data.collect_schema()
        return [
            ColumnSchema(
                name=col_name,
                dtype=str(polars_type),
                js_type=DocWorkspaceAPIUtils.polars_dtype_to_ldaca_dtype(polars_type),
            )
            for col_name, polars_type in data_schema.items()
        ]

    @staticmethod
    def compute_node_shape(node: Any) -> Tuple[int, int]:
        """Calculate node shape as `(rows, cols)` for LazyFrame-backed nodes."""
        lazyframe = node.data
        schema = lazyframe.collect_schema()
        cols = len(schema)
        rows = int(lazyframe.select(pl.len()).collect().item())
        return (rows, cols)

    @staticmethod
    def node_to_api_summary(node: Any) -> NodeSummary:
        """Convert a Node to NodeSummary for API responses."""
        node_info = node.info()
        return NodeSummary(
            id=node.id,
            name=node.name,
            operation=node.operation,
            shape=DocWorkspaceAPIUtils.compute_node_shape(node),
            columns=list(node_info.get("columns", [])),
            schema=DocWorkspaceAPIUtils.get_node_schema_json_with_ldaca_dtype(node),
            document=node.document,
            parent_ids=[parent.id for parent in node.parents],
            child_ids=[child.id for child in node.children],
        )

    @staticmethod
    def get_paginated_node_rows(
        node: Any,
        page: int = 1,
        page_size: int = 100,
        columns: Optional[List[str]] = None,
    ) -> PaginatedData:
        """Get paginated rows from a LazyFrame-backed node."""
        data_obj = node.data
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
            schema=DocWorkspaceAPIUtils.get_node_schema_json_with_ldaca_dtype(node),
        )

    @staticmethod
    def workspace_to_ui_graph_payload(workspace: Any) -> WorkspaceGraph:
        """Convert workspace graph objects to React Flow-compatible payloads.

        Used by:
        - `WorkspaceManager.get_workspace_graph`

        Why:
        - Centralizes graph serialization and layout defaults.
        """
        nodes = []
        edges = []

        # Create React Flow nodes
        for node_id, node in workspace.nodes.items():
            shape = DocWorkspaceAPIUtils.compute_node_shape(node)
            node_info = node.info()

            react_node = ReactFlowNode(
                id=node_id,
                type="customNode",
                data={
                    "label": node.name,
                    "shape": shape,
                    "columns": list(node_info.get("columns", [])),
                    "document": node.document,
                },
                connectable=True,
            )
            nodes.append(react_node)

        # Create React Flow edges from parent-child relationships
        edge_id = 0
        for node_id, node in workspace.nodes.items():
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


def exception_to_error_response(error: Exception) -> ErrorResponse:
    """Convert exceptions into standardized API error payloads."""
    return ErrorResponse(
        error=type(error).__name__,
        message=str(error),
        details={"exception_type": type(error).__name__},
    )
