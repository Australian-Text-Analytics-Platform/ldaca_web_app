"""
Refactored workspace API endpoints - thin HTTP layer over DocWorkspace.

These endpoints are now simple HTTP wrappers around DocWorkspace methods.
All business logic is handled by the DocWorkspace library itself.
"""

import logging
from typing import Any, Optional, cast

import polars as pl
from core.auth import get_current_user

# Note: DocWorkspace API helpers are not used directly in this HTTP layer
from core.utils import DOCWORKSPACE_AVAILABLE, get_user_data_folder, load_data_file
from core.workspace import workspace_manager
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from models import (
    ConcordanceDetachRequest,
    ConcordanceRequest,
    FilterRequest,
    FrequencyAnalysisRequest,
    MultiNodeConcordanceRequest,
    SliceRequest,
    TokenFrequencyData,
    TokenFrequencyRequest,
    TokenFrequencyResponse,
    TokenStatisticsData,
    WorkspaceCreateRequest,
    WorkspaceInfo,
)

if DOCWORKSPACE_AVAILABLE:
    try:
        from docworkspace import Node
    except ImportError:
        Node = None
else:
    Node = None

# Optional imports for docframe conversions
try:
    from docframe.core.docframe import DocDataFrame, DocLazyFrame  # type: ignore
except Exception:  # pragma: no cover - docframe may not be installed in some envs
    DocDataFrame = None  # type: ignore
    DocLazyFrame = None  # type: ignore

router = APIRouter(prefix="/workspaces", tags=["workspace_management"])
logger = logging.getLogger(__name__)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================


def _handle_operation_result(result):
    """Handle both dictionary and OperationResult responses from workspace operations"""
    # Handle dictionary response (fallback case)
    if isinstance(result, dict):
        success = result.get("success", False)
        message = result.get("message", "Operation failed")
        return success, message, result

    # Handle OperationResult object (normal case)
    elif hasattr(result, "success"):
        return result.success, result.message, result

    # Unknown response type
    else:
        return False, "Unknown operation result type", result


# ============================================================================
# WORKSPACE MANAGEMENT - Simple HTTP wrappers
# ============================================================================


@router.get("/")
async def list_workspaces(current_user: dict = Depends(get_current_user)):
    """List user's workspaces using DocWorkspace info methods"""
    user_id = current_user["id"]

    workspaces_dict = workspace_manager.list_user_workspaces(user_id)

    workspace_list = []
    for workspace_id, workspace in workspaces_dict.items():
        # Get workspace info using DocWorkspace summary method
        summary = workspace.summary()

        workspace_list.append(
            {
                "workspace_id": workspace_id,
                "name": workspace.name,
                "description": workspace.get_metadata("description") or "",
                "created_at": workspace.get_metadata("created_at") or "Unknown",
                "modified_at": workspace.get_metadata("modified_at") or "Unknown",
                "node_count": summary["total_nodes"],
                "root_nodes": summary["root_nodes"],
                "leaf_nodes": summary["leaf_nodes"],
                "node_types": summary["node_types"],
            }
        )

    return {"workspaces": workspace_list}


@router.get("/current")
async def get_current_workspace(current_user: dict = Depends(get_current_user)):
    """Get user's current workspace"""
    user_id = current_user["id"]
    current_workspace_id = workspace_manager.get_current_workspace_id(user_id)

    return {"current_workspace_id": current_workspace_id}


@router.post("/current")
async def set_current_workspace(
    workspace_id: Optional[str] = None, current_user: dict = Depends(get_current_user)
):
    """Set user's current workspace"""
    user_id = current_user["id"]

    success = workspace_manager.set_current_workspace(user_id, workspace_id)
    if not success and workspace_id is not None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    return {"success": True, "current_workspace_id": workspace_id}


@router.post("/", response_model=WorkspaceInfo)
async def create_workspace(
    request: WorkspaceCreateRequest, current_user: dict = Depends(get_current_user)
):
    """Create workspace using DocWorkspace constructor"""
    user_id = current_user["id"]

    try:
        # Handle initial data file if provided
        data = None
        data_name = None
        if request.initial_data_file:
            try:
                user_data_folder = get_user_data_folder(user_id)
                file_path = user_data_folder / request.initial_data_file

                if file_path.exists():
                    loaded_data = load_data_file(file_path)
                    # Convert pandas DataFrame to Polars if needed
                    if hasattr(loaded_data, "columns") and hasattr(loaded_data, "iloc"):
                        # This is a pandas DataFrame, convert to Polars
                        data = pl.DataFrame(loaded_data)
                    else:
                        # Already Polars or LazyFrame
                        data = loaded_data
                    # Prefer LazyFrame as the canonical internal representation
                    try:
                        if isinstance(data, pl.DataFrame):
                            data = data.lazy()
                    except Exception:
                        pass
                    data_name = request.initial_data_file.replace(".csv", "").replace(
                        ".xlsx", ""
                    )
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Initial data file not found: {request.initial_data_file}",
                    )
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to load initial data file: {str(e)}",
                )

        # Use DocWorkspace to create workspace
        # Narrow type for type checker
        data_typed = None
        try:
            if isinstance(data, (pl.DataFrame, pl.LazyFrame)):
                data_typed = data
        except Exception:
            data_typed = None

        workspace = workspace_manager.create_workspace(
            user_id=user_id,
            name=request.name,
            description=request.description or "",
            data=cast(Optional[pl.DataFrame | pl.LazyFrame], data_typed),
            data_name=data_name,
        )

        # Get workspace info using DocWorkspace method
        workspace_id = workspace.get_metadata("id")
        workspace_info = workspace_manager.get_workspace_info(user_id, workspace_id)

        if not workspace_info:
            raise HTTPException(status_code=500, detail="Failed to get workspace info")

        return WorkspaceInfo(
            workspace_id=workspace_id,
            name=workspace_info["name"],
            description=workspace_info.get("description", ""),
            created_at=workspace_info.get("created_at", ""),
            modified_at=workspace_info.get("modified_at", ""),
            total_nodes=workspace_info.get(
                "total_nodes", 0
            ),  # Updated to use latest terminology
        )

    except HTTPException:
        # Re-raise HTTPExceptions as-is
        raise
    except Exception as e:
        # Log and convert unexpected errors to 500
        import traceback

        print(f"❌ Workspace creation error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error during workspace creation: {str(e)}",
        )


@router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Delete workspace using manager"""
    user_id = current_user["id"]

    success = workspace_manager.delete_workspace(user_id, workspace_id)
    if not success:
        raise HTTPException(status_code=404, detail="Workspace not found")

    return {
        "success": True,
        "message": f"Workspace {workspace_id} deleted successfully",
    }


@router.get("/{workspace_id}")
async def get_workspace(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Get workspace details - cleaner endpoint naming"""
    user_id = current_user["id"]

    workspace_info = workspace_manager.get_workspace_info(user_id, workspace_id)
    if not workspace_info:
        raise HTTPException(status_code=404, detail="Workspace not found")

    return workspace_info


@router.get("/{workspace_id}/info")
async def get_workspace_info(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Get workspace info using DocWorkspace summary method"""
    user_id = current_user["id"]

    workspace_info = workspace_manager.get_workspace_info(user_id, workspace_id)
    if not workspace_info:
        raise HTTPException(status_code=404, detail="Workspace not found")

    return workspace_info


# ============================================================================
# GRAPH DATA - Direct delegation to DocWorkspace
# ============================================================================


@router.get("/{workspace_id}/graph")
async def get_workspace_graph(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Get React Flow graph using DocWorkspace to_api_graph method"""
    user_id = current_user["id"]

    # Direct delegation to DocWorkspace
    graph_data = workspace_manager.get_workspace_graph(user_id, workspace_id)
    if not graph_data:
        raise HTTPException(status_code=404, detail="Workspace not found")

    return graph_data


@router.get("/{workspace_id}/nodes")
async def get_workspace_nodes(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Get node summaries using DocWorkspace get_node_summaries method"""
    user_id = current_user["id"]

    # Direct delegation to DocWorkspace
    node_summaries = workspace_manager.get_node_summaries(user_id, workspace_id)

    return {"nodes": node_summaries}


@router.post("/{workspace_id}/nodes")
async def add_node_to_workspace(
    workspace_id: str, filename: str, current_user: dict = Depends(get_current_user)
):
    """Add a data file as a new node to workspace"""
    user_id = current_user["id"]

    try:
        # Load data file
        user_data_folder = get_user_data_folder(user_id)
        file_path = user_data_folder / filename

        if not file_path.exists():
            raise HTTPException(
                status_code=400, detail=f"Data file not found: {filename}"
            )

        # Load the data
        data = load_data_file(file_path)

        # Convert pandas DataFrame to Polars if needed
        if hasattr(data, "columns") and hasattr(data, "iloc"):
            # This is a pandas DataFrame, convert to Polars
            data = pl.DataFrame(data)
        # Prefer LazyFrame for internal storage
        try:
            if isinstance(data, pl.DataFrame):
                data = data.lazy()
        except Exception:
            pass

        # Create node name from filename
        node_name = (
            filename.replace(".csv", "").replace(".xlsx", "").replace(".json", "")
        )

        # Add node to workspace using DocWorkspace
        # Ensure correct type for type checker
        if not isinstance(data, (pl.DataFrame, pl.LazyFrame)):
            raise HTTPException(
                status_code=400, detail="Unsupported data type loaded from file"
            )
        node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=cast(pl.DataFrame | pl.LazyFrame, data),
            node_name=node_name,
        )

        if not node:
            raise HTTPException(
                status_code=500, detail="Failed to add node to workspace"
            )

        # Return node info
        return node.info(json=True)

    except HTTPException:
        # Re-raise HTTPExceptions as-is
        raise
    except Exception as e:
        # Log and convert unexpected errors to 500
        import traceback

        print(f"❌ Add node error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error adding node: {str(e)}"
        )


# ============================================================================
# NODE OPERATIONS - Thin wrappers around DocWorkspace methods
# ============================================================================


@router.get("/{workspace_id}/nodes/{node_id}")
async def get_node_info(
    workspace_id: str, node_id: str, current_user: dict = Depends(get_current_user)
):
    """Get node info using DocWorkspace Node.info method"""
    user_id = current_user["id"]

    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Use DocWorkspace's latest info method with json=True for API compatibility
    return node.info(json=True)


@router.get("/{workspace_id}/nodes/{node_id}/data")
async def get_node_data(
    workspace_id: str,
    node_id: str,
    page: int = 1,
    page_size: int = 100,
    current_user: dict = Depends(get_current_user),
):
    """Get node data using DocWorkspace data access methods"""
    user_id = current_user["id"]

    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Use DocWorkspace's latest data access pattern
    try:
        # Get data as DataFrame for pagination
        if hasattr(node.data, "collect"):
            # LazyFrame - collect for pagination
            df = node.data.collect()
        else:
            # Already a DataFrame
            df = node.data

        # Calculate pagination
        total_rows = len(df)
        start_idx = (page - 1) * page_size
        end_idx = min(start_idx + page_size, total_rows)

        # Get paginated data
        paginated_df = df.slice(start_idx, page_size)
        data_rows = paginated_df.to_dicts()

        return {
            "data": data_rows,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_rows": total_rows,
                "total_pages": (total_rows + page_size - 1) // page_size,
                "has_next": end_idx < total_rows,
                "has_prev": page > 1,
            },
            "columns": list(df.columns),
            "dtypes": {col: str(dtype) for col, dtype in df.schema.items()},
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get node data: {str(e)}"
        )


@router.get("/{workspace_id}/nodes/{node_id}/shape")
async def get_node_shape(
    workspace_id: str, node_id: str, current_user: dict = Depends(get_current_user)
):
    """Get the full shape (height, width) of a node by materializing if needed"""
    user_id = current_user["id"]

    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        if node.is_lazy:
            # For lazy frames, calculate full shape by collecting
            if hasattr(node.data, "collect") and hasattr(node.data, "collect_schema"):
                # Get row count by collecting and counting
                row_count = node.data.select(pl.count()).collect().item()
                # Get column count from schema
                column_count = len(node.data.collect_schema().names())
                shape = [row_count, column_count]
            else:
                # Fallback
                shape = [None, None]
        else:
            # For materialized DataFrames, get shape directly
            if hasattr(node.data, "shape"):
                shape = list(node.data.shape)
            else:
                shape = [None, None]

        return {"shape": shape, "is_lazy": node.is_lazy, "calculated": True}

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to calculate node shape: {str(e)}"
        )


@router.delete("/{workspace_id}/nodes/{node_id}")
async def delete_node(
    workspace_id: str, node_id: str, current_user: dict = Depends(get_current_user)
):
    """Delete node using DocWorkspace method"""
    user_id = current_user["id"]

    success = workspace_manager.delete_node_from_workspace(
        user_id, workspace_id, node_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Node not found")

    return {"success": True, "message": "Node deleted successfully"}


@router.post("/{workspace_id}/nodes/{node_id}/convert/to-docdataframe")
async def convert_node_to_docdataframe(
    workspace_id: str,
    node_id: str,
    document_column: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Convert a node's data to a DocDataFrame in place.

    If the source is a LazyFrame/DocLazyFrame, this will materialize as needed.
    Requires specifying a document column when it cannot be auto-detected.
    """
    user_id = current_user["id"]

    # Validate docframe availability
    if DocDataFrame is None:
        raise HTTPException(
            status_code=500, detail="docframe library not available on backend"
        )

    # Get source node
    src_node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not src_node:
        raise HTTPException(status_code=404, detail="Node not found")

    data = getattr(src_node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")

    import polars as pl

    # Convert to DocDataFrame according to source type
    try:
        new_docdf = None

        # Already DocDataFrame
        if DocDataFrame is not None and isinstance(data, DocDataFrame):  # type: ignore[arg-type]
            if document_column and document_column != data.document_column:
                new_docdf = data.set_document(document_column)
            else:
                new_docdf = data

        # DocLazyFrame
        elif DocLazyFrame is not None and isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
            collected = data.to_docdataframe()
            if document_column and document_column != collected.document_column:
                new_docdf = collected.set_document(document_column)
            else:
                new_docdf = collected

        # Polars LazyFrame
        elif isinstance(data, pl.LazyFrame):
            # Try to guess if not provided
            doc_col = document_column
            if not doc_col:
                try:
                    doc_col = DocDataFrame.guess_document_column(data)  # type: ignore[attr-defined]
                except Exception:
                    doc_col = None
            if not doc_col:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Unable to auto-detect a document column. Please specify document_column."
                    ),
                )
            new_docdf = DocDataFrame(data.collect(), document_column=doc_col)  # type: ignore[call-arg]

        # Polars DataFrame
        elif isinstance(data, pl.DataFrame):
            doc_col = document_column
            if not doc_col:
                try:
                    doc_col = DocDataFrame.guess_document_column(data)  # type: ignore[attr-defined]
                except Exception:
                    doc_col = None
            if not doc_col:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Unable to auto-detect a document column. Please specify document_column."
                    ),
                )
            new_docdf = DocDataFrame(data, document_column=doc_col)  # type: ignore[call-arg]
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported data type for conversion: {type(data).__name__}",
            )

        # In-place update of the node's data
        src_node.data = new_docdf  # type: ignore[assignment]
        try:
            src_node.operation = "convert_to_docdataframe"
        except Exception:
            pass

        # Persist workspace
        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            workspace_manager._save_workspace_to_disk(user_id, workspace_id, workspace)

        return src_node.info(json=True)

    except HTTPException:
        raise
    except ValueError as e:
        # Surface validation problems (e.g., wrong document_column) as 400s
        logger.error("DocLazyFrame conversion validation error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(
            "DocLazyFrame conversion failed for workspace=%s node=%s",
            workspace_id,
            node_id,
        )
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


@router.post("/{workspace_id}/nodes/{node_id}/convert/to-dataframe")
async def convert_node_to_dataframe(
    workspace_id: str,
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Convert a node's data to a Polars DataFrame (materialized) in place."""
    user_id = current_user["id"]

    # Get source node
    src_node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not src_node:
        raise HTTPException(status_code=404, detail="Node not found")

    data = getattr(src_node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")

    import polars as pl

    try:
        new_df = None

        # DocDataFrame -> unwrap
        if DocDataFrame is not None and isinstance(data, DocDataFrame):  # type: ignore[arg-type]
            new_df = data.dataframe

        # DocLazyFrame -> collect then unwrap
        elif DocLazyFrame is not None and isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
            new_df = data.to_docdataframe().dataframe

        # Polars LazyFrame -> collect
        elif hasattr(data, "collect"):
            new_df = data.collect()

        # Already DataFrame
        elif isinstance(data, pl.DataFrame):
            new_df = data
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported data type for conversion: {type(data).__name__}",
            )

        # In-place update
        src_node.data = new_df
        try:
            src_node.operation = "convert_to_dataframe"
        except Exception:
            pass

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            workspace_manager._save_workspace_to_disk(user_id, workspace_id, workspace)

        return src_node.info(json=True)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


@router.post("/{workspace_id}/nodes/{node_id}/convert/to-doclazyframe")
async def convert_node_to_doclazyframe(
    workspace_id: str,
    node_id: str,
    document_column: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Convert a node's data to a DocLazyFrame in place.

    Requires specifying a document column when it cannot be auto-detected.
    """
    user_id = current_user["id"]

    if DocLazyFrame is None or DocDataFrame is None:
        raise HTTPException(
            status_code=500, detail="docframe library not available on backend"
        )

    src_node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not src_node:
        raise HTTPException(status_code=404, detail="Node not found")

    data = getattr(src_node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")

    import polars as pl

    try:
        new_dlf = None

        # Already DocLazyFrame
        if isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
            # If user specified a different document column, validate it exists
            if document_column and document_column != data.document_column:
                if document_column not in getattr(data, "columns", []):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Document column '{document_column}' not found in node. "
                            f"Available columns: {getattr(data, 'columns', [])}"
                        ),
                    )
                new_dlf = data.with_document_column(document_column)
            else:
                new_dlf = data

        # DocDataFrame -> convert to lazy and wrap
        elif isinstance(data, DocDataFrame):  # type: ignore[arg-type]
            lf = data.dataframe.lazy()
            # If user specified a column, ensure it exists; otherwise use existing document column
            if document_column and document_column not in data.dataframe.columns:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Document column '{document_column}' not found in node. "
                        f"Available columns: {data.dataframe.columns}"
                    ),
                )
            doc_col = document_column or data.document_column
            new_dlf = DocLazyFrame(lf, document_column=doc_col)

        # Polars LazyFrame -> wrap as DocLazyFrame
        elif isinstance(data, pl.LazyFrame):
            # If user specified, ensure it exists in the schema
            if document_column:
                if document_column not in data.collect_schema().keys():
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Document column '{document_column}' not found in node schema. "
                            f"Available: {list(data.collect_schema().keys())}"
                        ),
                    )
                doc_col = document_column
            else:
                try:
                    doc_col = DocLazyFrame.guess_document_column(data)  # type: ignore[attr-defined]
                except Exception:
                    doc_col = None
                if not doc_col:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Unable to auto-detect a document column. Please specify document_column."
                        ),
                    )
            new_dlf = DocLazyFrame(data, document_column=doc_col)

        # Polars DataFrame -> to lazy and wrap
        elif isinstance(data, pl.DataFrame):
            lf = data.lazy()
            if document_column:
                if document_column not in data.columns:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Document column '{document_column}' not found in node. "
                            f"Available columns: {data.columns}"
                        ),
                    )
                doc_col = document_column
            else:
                try:
                    doc_col = DocLazyFrame.guess_document_column(lf)  # type: ignore[attr-defined]
                except Exception:
                    doc_col = None
                if not doc_col:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Unable to auto-detect a document column. Please specify document_column."
                        ),
                    )
            new_dlf = DocLazyFrame(lf, document_column=doc_col)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported data type for conversion: {type(data).__name__}",
            )

        # In-place update
        if not isinstance(new_dlf, DocLazyFrame):  # type check guard
            raise HTTPException(status_code=500, detail="Internal conversion error")

        src_node.data = cast(Any, new_dlf)
        try:
            src_node.operation = "convert_to_doclazyframe"
        except Exception:
            pass

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            workspace_manager._save_workspace_to_disk(user_id, workspace_id, workspace)

        return src_node.info(json=True)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


@router.post("/{workspace_id}/nodes/{node_id}/convert/to-lazyframe")
async def convert_node_to_lazyframe(
    workspace_id: str,
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Convert a node's data to a Polars LazyFrame in place."""
    user_id = current_user["id"]

    src_node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not src_node:
        raise HTTPException(status_code=404, detail="Node not found")

    data = getattr(src_node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")

    import polars as pl

    try:
        # Unwrap/wrap into Polars LazyFrame
        if DocLazyFrame is not None and isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
            new_lf = data.to_lazyframe()
        elif DocDataFrame is not None and isinstance(data, DocDataFrame):  # type: ignore[arg-type]
            new_lf = data.dataframe.lazy()
        elif isinstance(data, pl.DataFrame):
            new_lf = data.lazy()
        elif isinstance(data, pl.LazyFrame):
            new_lf = data
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported data type for conversion: {type(data).__name__}",
            )

        # In-place update
        src_node.data = cast(pl.LazyFrame, new_lf)
        try:
            src_node.operation = "convert_to_lazyframe"
        except Exception:
            pass

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            workspace_manager._save_workspace_to_disk(user_id, workspace_id, workspace)

        return src_node.info(json=True)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


@router.post("/{workspace_id}/nodes/{node_id}/rename")
async def rename_node(
    workspace_id: str,
    node_id: str,
    new_name: str,
    current_user: dict = Depends(get_current_user),
):
    """Rename node using DocWorkspace safe_operation method"""
    user_id = current_user["id"]

    # Define operation function
    def rename_operation():
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise ValueError("Node not found")
        node.name = new_name
        return node

    # Use DocWorkspace's safe operation wrapper
    result = workspace_manager.execute_safe_operation(
        user_id, workspace_id, rename_operation
    )

    success, message, result_obj = _handle_operation_result(result)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    return result_obj


# ============================================================================
# FILE OPERATIONS - Upload and create nodes
# ============================================================================


@router.post("/{workspace_id}/upload")
async def upload_file_to_workspace(
    workspace_id: str,
    file: UploadFile = File(...),
    node_name: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Upload file and create node using DocWorkspace methods"""
    user_id = current_user["id"]

    try:
        # Save uploaded file
        user_folder = get_user_data_folder(user_id)
        file_path = user_folder / (file.filename or "uploaded_file")

        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Load data using utility function
        data = load_data_file(file_path)

        # Normalize to Polars types
        # If pandas, convert to Polars
        if hasattr(data, "columns") and hasattr(data, "iloc"):
            data = pl.DataFrame(data)
        # Prefer LazyFrame
        try:
            if isinstance(data, pl.DataFrame):
                data = data.lazy()
        except Exception:
            pass

        # Create node using DocWorkspace
        node_name = node_name or file.filename or "uploaded_file"
        if not isinstance(data, (pl.DataFrame, pl.LazyFrame)):
            raise HTTPException(
                status_code=400, detail="Unsupported uploaded data type"
            )
        node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            node_name=node_name,
            data=cast(pl.DataFrame | pl.LazyFrame, data),
            operation=f"upload_file({file.filename})",
        )

        if not node:
            raise HTTPException(status_code=404, detail="Workspace not found")

        # Return node summary using DocWorkspace method
        return {
            "success": True,
            "message": "File uploaded successfully",
            "node": node.info(json=True),  # Use latest DocWorkspace method
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to upload file: {str(e)}")


# ============================================================================
# DATA OPERATIONS - Using DocWorkspace safe_operation wrapper
# ============================================================================


@router.post("/{workspace_id}/nodes/{node_id}/filter")
async def filter_node(
    workspace_id: str,
    node_id: str,
    request: FilterRequest,
    current_user: dict = Depends(get_current_user),
):
    """Filter node using DocWorkspace Node methods"""
    user_id = current_user["id"]

    # Define operation function using latest DocWorkspace design
    def filter_operation():
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise ValueError("Node not found")

        # Build filter expression from conditions
        filter_expr = None
        for condition in request.conditions:
            column_expr = pl.col(condition.column)

            if condition.operator == "equals":
                expr = column_expr == condition.value
            elif condition.operator == "contains":
                expr = column_expr.str.contains(str(condition.value))
            elif condition.operator == "greater_than":
                expr = column_expr > float(condition.value)
            elif condition.operator == "less_than":
                expr = column_expr < float(condition.value)
            else:
                expr = column_expr.str.contains(str(condition.value))  # fallback

            if filter_expr is None:
                filter_expr = expr
            else:
                if request.logic == "or":
                    filter_expr = filter_expr | expr
                else:  # default to "and"
                    filter_expr = filter_expr & expr

        # Apply filter using DocWorkspace Node's data manipulation methods
        if hasattr(node.data, "filter"):
            # LazyFrame or DataFrame with filter method
            filtered_data = node.data.filter(filter_expr)
        else:
            # Fallback: convert to LazyFrame and filter
            filtered_data = node.data.lazy().filter(filter_expr)

        # Create new node with filtered data using workspace method
        new_node_name = request.new_node_name or f"{node.name}_filtered"

        # Use workspace manager to add the filtered data as a new node
        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=filtered_data,
            node_name=new_node_name,
            operation=f"filter({node.name})",
            parents=[node],
        )
        return new_node

    # Use DocWorkspace's safe operation wrapper
    result = workspace_manager.execute_safe_operation(
        user_id, workspace_id, filter_operation
    )

    success, message, result_obj = _handle_operation_result(result)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    return result_obj


@router.post("/{workspace_id}/nodes/{node_id}/slice")
async def slice_node(
    workspace_id: str,
    node_id: str,
    request: SliceRequest,
    current_user: dict = Depends(get_current_user),
):
    """Slice node using DocWorkspace Node methods"""
    user_id = current_user["id"]

    # Define operation function using latest DocWorkspace design
    def slice_operation():
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise ValueError("Node not found")

        # Apply slicing using DocWorkspace Node's data manipulation methods
        sliced_data = node.data

        # Apply row slicing if specified
        if request.start_row is not None or request.end_row is not None:
            start = request.start_row or 0
            length = None
            if request.end_row is not None:
                length = request.end_row - start

            if hasattr(sliced_data, "slice"):
                sliced_data = sliced_data.slice(start, length)
            else:
                sliced_data = sliced_data.lazy().slice(start, length)

        # Apply column selection if specified
        if request.columns:
            if hasattr(sliced_data, "select"):
                sliced_data = sliced_data.select(request.columns)
            else:
                sliced_data = sliced_data.lazy().select(request.columns)

        # Create new node with sliced data using workspace method
        new_node_name = request.new_node_name or f"{node.name}_sliced"

        # Use workspace manager to add the sliced data as a new node
        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=sliced_data,
            node_name=new_node_name,
            operation=f"slice({node.name})",
            parents=[node],
        )
        return new_node

    # Use DocWorkspace's safe operation wrapper
    result = workspace_manager.execute_safe_operation(
        user_id, workspace_id, slice_operation
    )

    success, message, result_obj = _handle_operation_result(result)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    return result_obj


@router.post("/{workspace_id}/nodes/join")
async def join_nodes(
    workspace_id: str,
    left_node_id: str,
    right_node_id: str,
    left_on: str,
    right_on: str,
    how: str = "inner",
    new_node_name: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Join nodes using DocWorkspace safe_operation method"""
    user_id = current_user["id"]

    # Define operation function
    def join_operation():
        left_node = workspace_manager.get_node_from_workspace(
            user_id, workspace_id, left_node_id
        )
        right_node = workspace_manager.get_node_from_workspace(
            user_id, workspace_id, right_node_id
        )

        if not left_node or not right_node:
            raise ValueError("One or both nodes not found")

        # Get the data from both nodes
        left_data = left_node.data
        right_data = right_node.data

        # Promote to LazyFrame for lazy join wherever possible
        def to_lazy(x):
            # If it's already a LazyFrame, return as-is
            cls = getattr(x, "__class__", None)
            if hasattr(x, "_ldf") or (
                cls and getattr(cls, "__name__", "") == "LazyFrame"
            ):
                return x
            # If it has lazy() method (e.g., DataFrame), use it
            if hasattr(x, "lazy"):
                return x.lazy()
            # Fallback: wrap into polars DataFrame then lazy
            return pl.DataFrame(x).lazy()

        left_lf = to_lazy(left_data)
        right_lf = to_lazy(right_data)

        # Perform lazy join; map 'left_on'/'right_on' to a list per Polars API
        left_on_cols = left_on if isinstance(left_on, list) else [left_on]
        right_on_cols = right_on if isinstance(right_on, list) else [right_on]
        # Normalize join strategy to Polars accepted values
        how_norm = {
            "inner": "inner",
            "left": "left",
            "right": "right",
            "outer": "full",
            "full": "full",
            "semi": "semi",
            "anti": "anti",
            "cross": "cross",
        }.get((how or "inner").lower(), "inner")

        how_param: Any = how_norm
        joined_lf = left_lf.join(
            right_lf, left_on=left_on_cols, right_on=right_on_cols, how=how_param
        )

        # Create new node with joined data
        node_name = new_node_name or f"{left_node.name}_join_{right_node.name}"

        # Add the joined data as a new node to the workspace
        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=joined_lf,
            node_name=node_name,
            operation=f"join({left_node.name}, {right_node.name})",
            parents=[left_node, right_node],
        )

        return new_node

    # Use DocWorkspace's safe operation wrapper
    result = workspace_manager.execute_safe_operation(
        user_id, workspace_id, join_operation
    )

    success, message, result_obj = _handle_operation_result(result)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    return result_obj


# ============================================================================
# TEXT ANALYSIS - Using DocFrame integration if available
# ============================================================================


@router.post("/{workspace_id}/nodes/{node_id}/concordance")
async def get_concordance(
    workspace_id: str,
    node_id: str,
    request: ConcordanceRequest,
    current_user: dict = Depends(get_current_user),
):
    """Get concordance using DocFrame integration with pagination and sorting support"""
    user_id = current_user["id"]

    try:
        # Get the node directly (don't use safe operation wrapper for concordance)
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        # Check if the column exists in the data
        if hasattr(node.data, "columns"):
            available_columns = node.data.columns
        elif hasattr(node.data, "schema"):
            available_columns = list(node.data.schema.keys())
        else:
            available_columns = []

        if available_columns and request.column not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{request.column}' not found. Available columns: {available_columns}",
            )

        # Try to use DocFrame text methods if available
        if hasattr(node.data, "text"):
            # DocFrame integration - use text namespace
            concordance_result = node.data.text.concordance(
                column=request.column,
                search_word=request.search_word,
                num_left_tokens=request.num_left_tokens,
                num_right_tokens=request.num_right_tokens,
                regex=request.regex,
                case_sensitive=request.case_sensitive,
            )

            # Apply sorting if requested
            if request.sort_by and request.sort_by in concordance_result.columns:
                import polars as pl

                if request.sort_order.lower() == "desc":
                    concordance_result = concordance_result.sort(
                        pl.col(request.sort_by), descending=True
                    )
                else:
                    concordance_result = concordance_result.sort(
                        pl.col(request.sort_by)
                    )

            # Get total count before pagination
            total_matches = len(concordance_result)

            # Apply pagination
            start_idx = (request.page - 1) * request.page_size
            end_idx = start_idx + request.page_size
            paginated_result = concordance_result.slice(start_idx, request.page_size)

            # Convert concordance DataFrame to format expected by frontend
            if hasattr(paginated_result, "to_dicts"):
                return {
                    "data": paginated_result.to_dicts(),
                    "columns": list(concordance_result.columns),
                    "total_matches": total_matches,
                    "pagination": {
                        "page": request.page,
                        "page_size": request.page_size,
                        "total_pages": (total_matches + request.page_size - 1)
                        // request.page_size,
                        "has_next": end_idx < total_matches,
                        "has_prev": request.page > 1,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }
            else:
                return {
                    "data": [],
                    "columns": [],
                    "total_matches": 0,
                    "pagination": {
                        "page": 1,
                        "page_size": request.page_size,
                        "total_pages": 0,
                        "has_next": False,
                        "has_prev": False,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }

        else:
            # Fallback to basic string search
            import polars as pl

            filtered = node.data.filter(
                pl.col(request.column).str.contains(request.search_word)
            )

            # Apply sorting if requested
            if request.sort_by and request.sort_by in filtered.columns:
                if request.sort_order.lower() == "desc":
                    filtered = filtered.sort(pl.col(request.sort_by), descending=True)
                else:
                    filtered = filtered.sort(pl.col(request.sort_by))

            # Get total count before pagination
            total_matches = len(filtered)

            # Apply pagination
            start_idx = (request.page - 1) * request.page_size
            paginated_filtered = filtered.slice(start_idx, request.page_size)

            # Convert filtered results to expected format
            if hasattr(paginated_filtered, "to_dicts"):
                return {
                    "data": paginated_filtered.to_dicts(),
                    "columns": list(filtered.columns),
                    "total_matches": total_matches,
                    "pagination": {
                        "page": request.page,
                        "page_size": request.page_size,
                        "total_pages": (total_matches + request.page_size - 1)
                        // request.page_size,
                        "has_next": start_idx + request.page_size < total_matches,
                        "has_prev": request.page > 1,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }
            else:
                return {
                    "data": [],
                    "columns": [],
                    "total_matches": 0,
                    "pagination": {
                        "page": 1,
                        "page_size": request.page_size,
                        "total_pages": 0,
                        "has_next": False,
                        "has_prev": False,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Log and handle unexpected errors
        import traceback

        print(f"❌ Unexpected concordance error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/{workspace_id}/concordance/multi-node")
async def get_multi_node_concordance(
    workspace_id: str,
    request: MultiNodeConcordanceRequest,
    current_user: dict = Depends(get_current_user),
):
    """Get concordance results for multiple nodes (up to 2) with side-by-side comparison"""
    user_id = current_user["id"]

    try:
        if len(request.node_ids) == 0:
            raise HTTPException(
                status_code=400, detail="At least one node ID must be provided"
            )

        if len(request.node_ids) > 2:
            raise HTTPException(
                status_code=400, detail="Maximum 2 nodes supported for comparison"
            )

        results = {}

        for node_id in request.node_ids:
            # Get the node
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

            # Get the column for this node
            column = request.node_columns.get(node_id)
            if not column:
                raise HTTPException(
                    status_code=400, detail=f"No column specified for node {node_id}"
                )

            # Check if the column exists in the data
            if hasattr(node.data, "columns"):
                available_columns = node.data.columns
            elif hasattr(node.data, "schema"):
                available_columns = list(node.data.schema.keys())
            else:
                available_columns = []

            if available_columns and column not in available_columns:
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{column}' not found in node {node_id}. Available columns: {available_columns}",
                )

            # Try to use DocFrame text methods if available
            if hasattr(node.data, "text"):
                # DocFrame integration - use text namespace
                concordance_result = node.data.text.concordance(
                    column=column,
                    search_word=request.search_word,
                    num_left_tokens=request.num_left_tokens,
                    num_right_tokens=request.num_right_tokens,
                    regex=request.regex,
                    case_sensitive=request.case_sensitive,
                )

                # Apply sorting if requested
                if request.sort_by and request.sort_by in concordance_result.columns:
                    import polars as pl

                    if request.sort_order.lower() == "desc":
                        concordance_result = concordance_result.sort(
                            pl.col(request.sort_by), descending=True
                        )
                    else:
                        concordance_result = concordance_result.sort(
                            pl.col(request.sort_by)
                        )

                # Get total count before pagination
                total_matches = len(concordance_result)

                # Apply pagination
                start_idx = (request.page - 1) * request.page_size
                end_idx = start_idx + request.page_size
                paginated_result = concordance_result.slice(
                    start_idx, request.page_size
                )

                # Convert concordance DataFrame to format expected by frontend
                if hasattr(paginated_result, "to_dicts"):
                    node_name = (
                        node.name if hasattr(node, "name") and node.name else node_id
                    )
                    results[node_name] = {
                        "data": paginated_result.to_dicts(),
                        "columns": list(concordance_result.columns),
                        "total_matches": total_matches,
                        "pagination": {
                            "page": request.page,
                            "page_size": request.page_size,
                            "total_pages": (total_matches + request.page_size - 1)
                            // request.page_size,
                            "has_next": end_idx < total_matches,
                            "has_prev": request.page > 1,
                        },
                        "sorting": {
                            "sort_by": request.sort_by,
                            "sort_order": request.sort_order,
                        },
                    }
                else:
                    node_name = (
                        node.name if hasattr(node, "name") and node.name else node_id
                    )
                    results[node_name] = {
                        "data": [],
                        "columns": [],
                        "total_matches": 0,
                        "pagination": {
                            "page": 1,
                            "page_size": request.page_size,
                            "total_pages": 0,
                            "has_next": False,
                            "has_prev": False,
                        },
                        "sorting": {
                            "sort_by": request.sort_by,
                            "sort_order": request.sort_order,
                        },
                    }
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Node {node_id} does not support text operations",
                )

        return {
            "success": True,
            "message": f"Found concordance results for search term '{request.search_word}'",
            "data": results,
        }

    except Exception as e:
        import traceback

        print(f"❌ Unexpected multi-node concordance error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{workspace_id}/nodes/{node_id}/concordance/{document_idx}")
async def get_concordance_detail(
    workspace_id: str,
    node_id: str,
    document_idx: int,
    text_column: str,
    current_user: dict = Depends(get_current_user),
):
    """Get detailed information for a specific concordance match including full text and metadata"""
    user_id = current_user["id"]

    try:
        # Get the node
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        # Get the original data
        data = node.data
        if hasattr(data, "collect"):
            data = data.collect()

        # Validate document index
        if document_idx < 0 or document_idx >= len(data):
            raise HTTPException(status_code=404, detail="Document index not found")

        # Get the specific record
        record = data.slice(document_idx, 1).to_dicts()[0]

        # Extract the full text from the specified column
        full_text = record.get(text_column, "")

        # Get all metadata (all other columns)
        metadata = {k: v for k, v in record.items() if k != text_column}

        # Get column information
        available_columns = list(data.columns) if hasattr(data, "columns") else []

        return {
            "document_idx": document_idx,
            "text_column": text_column,
            "full_text": str(full_text),
            "metadata": metadata,
            "available_columns": available_columns,
            "record": record,  # Full record for reference
        }

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Log and handle unexpected errors
        import traceback

        print(f"❌ Unexpected concordance detail error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/{workspace_id}/nodes/{node_id}/frequency-analysis")
async def get_frequency_analysis(
    workspace_id: str,
    node_id: str,
    request: FrequencyAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    """Get frequency analysis using DocFrame integration"""
    user_id = current_user["id"]

    try:
        # Get the node directly
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        # Check if the time column exists in the data
        if hasattr(node.data, "columns"):
            available_columns = node.data.columns
        elif hasattr(node.data, "schema"):
            available_columns = list(node.data.schema.keys())
        else:
            available_columns = []

        if available_columns and request.time_column not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Time column '{request.time_column}' not found. Available columns: {available_columns}",
            )

        # Validate group_by_columns if provided
        if request.group_by_columns:
            # Limit to 3 group by columns as requested
            if len(request.group_by_columns) > 3:
                raise HTTPException(
                    status_code=400, detail="Maximum 3 group by columns allowed"
                )

            for col in request.group_by_columns:
                if available_columns and col not in available_columns:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Group by column '{col}' not found. Available columns: {available_columns}",
                    )

        # Validate frequency
        valid_frequencies = ["daily", "weekly", "monthly", "yearly"]
        if request.frequency not in valid_frequencies:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid frequency '{request.frequency}'. Valid options: {valid_frequencies}",
            )

        # Try to use DocFrame text methods if available
        if hasattr(node.data, "text"):
            # DocFrame integration - use text namespace
            frequency_result = node.data.text.frequency_analysis(
                time_column=request.time_column,
                group_by_columns=request.group_by_columns,
                frequency=request.frequency,
                sort_by_time=request.sort_by_time,
            )

            # Convert frequency DataFrame to format expected by frontend
            if hasattr(frequency_result, "to_dicts"):
                return {
                    "success": True,
                    "data": frequency_result.to_dicts(),
                    "columns": list(frequency_result.columns),
                    "total_records": len(frequency_result),
                    "analysis_params": {
                        "time_column": request.time_column,
                        "group_by_columns": request.group_by_columns,
                        "frequency": request.frequency,
                        "sort_by_time": request.sort_by_time,
                    },
                }
            else:
                return {
                    "success": True,
                    "data": [],
                    "columns": [],
                    "total_records": 0,
                    "analysis_params": {
                        "time_column": request.time_column,
                        "group_by_columns": request.group_by_columns,
                        "frequency": request.frequency,
                        "sort_by_time": request.sort_by_time,
                    },
                }
        else:
            raise HTTPException(
                status_code=400,
                detail="Node data does not support text analysis. Please ensure the node contains proper text data.",
            )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Log and handle unexpected errors
        import traceback

        print(f"❌ Unexpected frequency analysis error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/{workspace_id}/nodes/{node_id}/cast")
async def cast_node(
    workspace_id: str,
    node_id: str,
    cast_data: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Cast a single column data type in a node using Polars casting methods (in-place operation).

    Args:
        workspace_id: The workspace identifier
        node_id: The node identifier to cast
        cast_data: Dictionary with casting specifications:
            - column: str - name of the column to cast
            - target_type: str - target data type (e.g., "number", "string", "datetime", "boolean")
            - format: str (optional) - datetime format string for string to datetime conversion
            Example: {"column": "date_col", "target_type": "datetime", "format": "%Y-%m-%d"}

    Returns:
        Dictionary with the updated node information after casting
    """
    try:
        import polars as pl

        user_id = current_user["id"]

        # Validate cast_data structure
        if not isinstance(cast_data, dict):
            raise HTTPException(
                status_code=400, detail="cast_data must be a dictionary"
            )

        if "column" not in cast_data or "target_type" not in cast_data:
            raise HTTPException(
                status_code=400,
                detail="cast_data must contain 'column' and 'target_type' keys",
            )

        column_name = cast_data["column"]
        target_type = cast_data["target_type"]
        datetime_format = cast_data.get("format")  # Optional datetime format

        if not isinstance(column_name, str) or not isinstance(target_type, str):
            raise HTTPException(
                status_code=400, detail="'column' and 'target_type' must be strings"
            )

        # Get node using the workspace manager
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        # Get the current dataframe from the node
        current_df = node.data
        if current_df is None:
            raise HTTPException(status_code=400, detail="Node has no data")

        # Work directly with the node's data - preserve the original data type
        # Don't convert between DataFrame/LazyFrame/DocDataFrame types

        # Get original data type for logging
        if hasattr(current_df, "collect"):
            # LazyFrame - get schema without collecting (use collect_schema to avoid warning)
            schema = current_df.collect_schema()
            original_type = (
                str(schema[column_name]) if column_name in schema else "unknown"
            )
            columns = list(schema.keys())
        elif hasattr(current_df, "schema"):
            # DataFrame or DocDataFrame with schema
            original_type = (
                str(current_df.schema[column_name])
                if column_name in current_df.schema
                else "unknown"
            )
            columns = list(current_df.schema.keys())
        elif hasattr(current_df, "columns"):
            # Direct columns access
            columns = current_df.columns
            try:
                # Try to get dtype from the column
                original_type = str(current_df[column_name].dtype)
            except Exception:
                original_type = "unknown"
        else:
            raise HTTPException(
                status_code=400, detail="Cannot determine column structure"
            )

        if column_name not in columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column_name}' not found in data. Available columns: {columns}",
            )

        # Check if target_type is supported BEFORE trying the casting
        if target_type.lower() != "datetime":
            raise HTTPException(
                status_code=400,
                detail=f"Casting to '{target_type}' is not yet supported. Currently only 'datetime' casting is implemented.",
            )

        # Perform the casting using .with_columns() and expressions
        try:
            # Create the casting expression (we already validated it's datetime above)
            if datetime_format:
                # Use str.to_datetime with custom format - exactly as user specified
                cast_expr = pl.col(column_name).str.to_datetime(format=datetime_format)
            else:
                # Use str.to_datetime with automatic format detection
                cast_expr = pl.col(column_name).str.to_datetime()

            # Apply the casting with .with_columns() - preserve original data type!
            # If it was DocDataFrame, keep as DocDataFrame; if LazyFrame, keep as LazyFrame
            casted_data = current_df.with_columns(cast_expr)

            # Update the node data in-place (preserving the original type)
            node.data = casted_data

            # Save workspace to disk
            workspace_manager._save_workspace_to_disk(
                user_id,
                workspace_id,
                workspace_manager.get_workspace(user_id, workspace_id),
            )

            # Get new data type for response
            if hasattr(casted_data, "collect"):
                # LazyFrame - use collect_schema to avoid warning
                new_schema = casted_data.collect_schema()
                new_type = str(new_schema[column_name])
            elif hasattr(casted_data, "schema"):
                new_type = str(casted_data.schema[column_name])
            else:
                new_type = target_type

            return {
                "success": True,
                "node_id": node_id,
                "cast_info": {
                    "column": column_name,
                    "original_type": original_type,
                    "new_type": new_type,
                    "target_type": target_type,
                    "format_used": datetime_format
                    if target_type.lower() == "datetime"
                    else None,
                },
                "message": f"Successfully cast column '{column_name}' from {original_type} to {new_type}",
            }

        except Exception as cast_error:
            raise HTTPException(
                status_code=400,
                detail=f"Error casting column '{column_name}' to {target_type}: {str(cast_error)}. "
                f"Check that the target data type is valid and the data can be converted.",
            )

    except HTTPException:
        # Re-raise HTTP exceptions (they already have proper error messages)
        raise
    except Exception as e:
        # Handle unexpected errors
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error during casting operation: {str(e)}",
        )


# ============================================================================
# TOKEN FREQUENCY ANALYSIS
# ============================================================================


@router.post(
    "/{workspace_id}/token-frequencies",
    response_model=TokenFrequencyResponse,
    summary="Calculate token frequencies for selected nodes",
    description="Calculate and compare token frequencies across one or two nodes using the docframe library",
)
async def calculate_token_frequencies(
    workspace_id: str,
    request: TokenFrequencyRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Calculate token frequencies for the specified nodes.

    Returns frequency data for each node that can be displayed as horizontal bar charts.
    """
    try:
        user_id = current_user["id"]

        # Validate input
        if not request.node_ids:
            raise HTTPException(
                status_code=400, detail="At least one node ID must be provided"
            )

        if len(request.node_ids) > 2:
            raise HTTPException(
                status_code=400, detail="Maximum of 2 nodes can be compared"
            )

        # Validate that node_columns are provided for all nodes (unless auto-detectable)
        if not request.node_columns:
            request.node_columns = {}

        # Get workspace
        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            raise HTTPException(
                status_code=404, detail=f"Workspace {workspace_id} not found"
            )

        # Import required classes
        try:
            import polars as pl

            from docframe import DocDataFrame, DocLazyFrame
        except ImportError as e:
            raise HTTPException(
                status_code=500, detail=f"Required libraries not available: {str(e)}"
            )

        # Get nodes and validate they exist, create frames with selected columns
        frames_dict = {}

        for node_id in request.node_ids:
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

            # Get the node's data
            node_data = node.data if hasattr(node, "data") else node
            node_name = node.name if hasattr(node, "name") and node.name else node_id

            try:
                # Determine what type of data we're working with
                is_doc_frame = isinstance(node_data, (DocDataFrame, DocLazyFrame))
                is_lazy = isinstance(node_data, (DocLazyFrame, pl.LazyFrame))

                # Get available columns
                if hasattr(node_data, "columns"):
                    # For DataFrames and DocDataFrames
                    available_columns = node_data.columns
                elif hasattr(node_data, "collect_schema"):
                    # For LazyFrames and DocLazyFrames - use efficient schema access
                    available_columns = list(node_data.collect_schema().keys())
                elif hasattr(node_data, "schema"):
                    # Fallback for other types with schema
                    available_columns = list(node_data.schema.keys())
                else:
                    available_columns = []

                # Determine the column to use
                column_name = request.node_columns.get(node_id)

                if not column_name:
                    if is_doc_frame:
                        # Try to auto-detect document column for DocDataFrame/DocLazyFrame
                        if (
                            hasattr(node_data, "document_column")
                            and node_data.document_column
                        ):
                            column_name = node_data.document_column
                        else:
                            # Look for common text column names
                            text_columns = [
                                "document",
                                "text",
                                "content",
                                "body",
                                "message",
                            ]
                            for col in text_columns:
                                if col in available_columns:
                                    column_name = col
                                    break

                            if not column_name:
                                raise HTTPException(
                                    status_code=400,
                                    detail=f"Could not auto-detect text column for DocFrame node {node_id}. Available columns: {available_columns}. Please specify a column name.",
                                )
                    else:
                        # For regular DataFrames/LazyFrames, column must be specified
                        raise HTTPException(
                            status_code=400,
                            detail=f"Column specification required for node {node_id}. Available columns: {available_columns}",
                        )

                # Validate that the column exists
                if column_name not in available_columns:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Column '{column_name}' not found in node {node_id}. Available columns: {available_columns}",
                    )

                # Create the processed frame
                if is_doc_frame:
                    # For DocDataFrame/DocLazyFrame, we can use them directly
                    if column_name == "document":
                        # Already has the right column name
                        processed_frame = node_data
                    else:
                        # Select and alias the column to 'document'
                        processed_frame = node_data.select(
                            pl.col(column_name).alias("document")
                        )
                else:
                    # For regular DataFrame/LazyFrame, convert to DocDataFrame/DocLazyFrame
                    selected_data = node_data.select(
                        pl.col(column_name).alias("document")
                    )

                    if is_lazy:
                        # Convert LazyFrame to DocLazyFrame
                        processed_frame = DocLazyFrame(selected_data)
                    else:
                        # Convert DataFrame to DocDataFrame
                        if hasattr(selected_data, "collect"):
                            # It's a LazyFrame, collect it first
                            selected_data = selected_data.collect()
                        processed_frame = DocDataFrame(selected_data)

                frames_dict[node_name] = processed_frame

            except HTTPException:
                # Re-raise HTTP exceptions
                raise
            except Exception as e:
                raise HTTPException(
                    status_code=500, detail=f"Error processing node {node_id}: {str(e)}"
                )

        # Import the token frequency calculation function
        try:
            from docframe.core.text_utils import compute_token_frequencies
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="docframe library not available for token frequency calculation",
            )

        # Calculate token frequencies (returns tuple: frequencies, stats)
        frequency_results, stats_df = compute_token_frequencies(
            frames=frames_dict, stop_words=request.stop_words
        )

        # Convert to response format and apply limit
        response_data = {}
        for frame_name, freq_dict in frequency_results.items():
            # Sort by frequency (descending) and apply limit
            sorted_tokens = sorted(freq_dict.items(), key=lambda x: x[1], reverse=True)
            if request.limit:
                sorted_tokens = sorted_tokens[: request.limit]

            # Convert to TokenFrequencyData objects
            response_data[frame_name] = [
                TokenFrequencyData(token=token, frequency=freq)
                for token, freq in sorted_tokens
                if freq > 0  # Only include tokens that actually appear
            ]

        # Convert statistics DataFrame to response format (if available and we have 2 nodes)
        statistics_data = None
        if (
            len(request.node_ids) == 2
            and stats_df is not None
            and not stats_df.is_empty()
        ):
            # Only process statistics when comparing exactly 2 nodes
            # Convert Polars DataFrame to list of TokenStatisticsData
            statistics_data = []
            for row in stats_df.iter_rows(named=True):
                statistics_data.append(
                    TokenStatisticsData(
                        token=row["token"],
                        freq_corpus_0=int(row["freq_corpus_0"]),
                        freq_corpus_1=int(row["freq_corpus_1"]),
                        expected_0=float(row["expected_0"]),
                        expected_1=float(row["expected_1"]),
                        corpus_0_total=int(row["corpus_0_total"]),
                        corpus_1_total=int(row["corpus_1_total"]),
                        percent_corpus_0=float(row["percent_corpus_0"]),
                        percent_corpus_1=float(row["percent_corpus_1"]),
                        percent_diff=float(row["percent_diff"]),
                        log_likelihood_llv=float(row["log_likelihood_llv"]),
                        bayes_factor_bic=float(row["bayes_factor_bic"]),
                        effect_size_ell=float(row["effect_size_ell"]),
                        relative_risk=float(row["relative_risk"])
                        if row["relative_risk"] is not None
                        else None,
                        log_ratio=float(row["log_ratio"])
                        if row["log_ratio"] is not None
                        else None,
                        odds_ratio=float(row["odds_ratio"])
                        if row["odds_ratio"] is not None
                        else None,
                        significance=str(row["significance"]),
                    )
                )

            # Apply same limit to statistics as to frequency data
            if request.limit and statistics_data:
                # Get the tokens that were included in frequency data to maintain consistency
                included_tokens = set()
                for frame_data in response_data.values():
                    included_tokens.update(item.token for item in frame_data)

                # Filter statistics to only include tokens that are in the frequency results
                statistics_data = [
                    stat for stat in statistics_data if stat.token in included_tokens
                ]

        return TokenFrequencyResponse(
            success=True,
            message=f"Successfully calculated token frequencies for {len(frames_dict)} node(s)",
            data=response_data,
            statistics=statistics_data,
        )

    except HTTPException:
        # Re-raise HTTP exceptions (they already have proper error messages)
        raise
    except Exception as e:
        # Handle unexpected errors
        raise HTTPException(
            status_code=500, detail=f"Error calculating token frequencies: {str(e)}"
        )


@router.post("/{workspace_id}/nodes/{node_id}/concordance/detach")
async def detach_concordance(
    workspace_id: str,
    node_id: str,
    request: ConcordanceDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    """Detach concordance results by joining them with the original table to create a new node"""
    user_id = current_user["id"]

    try:
        # Get the original node
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        # Check if the column exists in the data
        if hasattr(node.data, "columns"):
            available_columns = node.data.columns
        elif hasattr(node.data, "schema"):
            available_columns = list(node.data.schema.keys())
        else:
            available_columns = []

        if available_columns and request.column not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{request.column}' not found. Available columns: {available_columns}",
            )

        # Get full concordance results (no pagination)
        if hasattr(node.data, "text"):
            # DocFrame integration - use text namespace
            concordance_result = node.data.text.concordance(
                column=request.column,
                search_word=request.search_word,
                num_left_tokens=request.num_left_tokens,
                num_right_tokens=request.num_right_tokens,
                regex=request.regex,
                case_sensitive=request.case_sensitive,
            )

            # Add document index to concordance results for joining

            if "document_idx" not in concordance_result.columns:
                # Create a document index based on row number in original data
                concordance_with_idx = concordance_result.with_row_index("document_idx")
            else:
                concordance_with_idx = concordance_result

            # Join concordance results with original data
            # The original data should have a row index that matches document_idx
            original_data_with_idx = node.data.with_row_index("document_idx")

            # Perform left join: original data + concordance columns
            joined_data = original_data_with_idx.join(
                concordance_with_idx.select(
                    [
                        "document_idx",
                        "left_context",
                        "matched_text",
                        "right_context",
                        "l1",
                        "r1",
                        "l1_freq",
                        "r1_freq",
                    ]
                ),
                on="document_idx",
                how="left",
            )

            # Remove the document_idx column as it's no longer needed
            final_data = joined_data.drop("document_idx")

            # Generate new node name if not provided
            if request.new_node_name:
                new_node_name = request.new_node_name
            else:
                original_name = (
                    node.name if hasattr(node, "name") and node.name else node_id
                )
                new_node_name = f"{original_name}_conc_{request.search_word}"

            # Create new node with joined data
            new_node = workspace_manager.add_node_to_workspace(
                user_id=user_id,
                workspace_id=workspace_id,
                data=final_data,
                node_name=new_node_name,
                operation="concordance_detach",
                parents=[node],
            )

            if not new_node:
                raise HTTPException(
                    status_code=500, detail="Failed to create detached concordance node"
                )

            return {
                "success": True,
                "message": f"Successfully created detached concordance node '{new_node_name}' with {len(final_data)} rows",
                "new_node_id": new_node.id,
                "new_node_name": new_node_name,
                "total_rows": len(final_data),
                "concordance_matches": len(concordance_result),
            }

        else:
            raise HTTPException(
                status_code=400,
                detail="This node does not support text analysis (DocFrame text namespace not available)",
            )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        print(f"❌ Error in detach concordance: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error detaching concordance results: {str(e)}"
        )
