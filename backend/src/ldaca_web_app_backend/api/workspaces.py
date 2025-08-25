"""
Refactored workspace API endpoints - thin HTTP layer over DocWorkspace.

These endpoints are now simple HTTP wrappers around DocWorkspace methods.
All business logic is handled by the DocWorkspace library itself.
"""

import logging
import re
import time
from datetime import datetime
from typing import Any, Dict, Optional, Tuple, cast

import polars as pl
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from ..core.auth import get_current_user
from ..core.docworkspace_api import DocWorkspaceAPIUtils

# Note: DocWorkspace API helpers are not used directly in this HTTP layer
from ..core.utils import get_user_data_folder, get_user_workspace_folder, load_data_file
from ..core.workspace import workspace_manager
from ..models import (
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
    TopicModelingRequest,
    TopicModelingResponse,
    WorkspaceCreateRequest,
    WorkspaceInfo,
)

# Router for workspace endpoints (was accidentally removed during edits)
router = APIRouter(prefix="/workspaces", tags=["workspace"])

# Optional docframe types (DocDataFrame / DocLazyFrame) used in conversions
try:  # pragma: no cover - optional dependency handling
    from docframe import DocDataFrame, DocLazyFrame  # type: ignore
except Exception:  # pragma: no cover
    DocDataFrame = None  # type: ignore
    DocLazyFrame = None  # type: ignore

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# Concordance In-Memory Cache
# -----------------------------------------------------------------------------
# Keyed by (user_id, workspace_id, node_id, column, search_word, num_left, num_right,
#           regex, case_sensitive) -> stored unsorted Polars DataFrame
CONCORDANCE_CACHE: Dict[Tuple[str, str, str, str, str, int, int, bool, bool], dict] = {}


def _concordance_cache_key(
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    search_word: str,
    num_left: int,
    num_right: int,
    regex: bool,
    case_sensitive: bool,
):
    return (
        user_id,
        workspace_id,
        node_id,
        column,
        search_word,
        num_left,
        num_right,
        bool(regex),
        bool(case_sensitive),
    )


def _get_cached_concordance_df(key):  # pragma: no cover - simple accessor
    entry = CONCORDANCE_CACHE.get(key)
    if entry:
        return entry.get("df")
    return None


# ============================================================================
# TOPIC MODELING ENDPOINT
# ============================================================================


@router.post(
    "/{workspace_id}/topic-modeling",
    response_model=TopicModelingResponse,
    summary="Run topic modeling (BERTopic) across one or two nodes",
    description="Fits a single BERTopic model over concatenated documents from up to two nodes and returns per-topic sizes and 2D coordinates.",
)
async def run_topic_modeling(
    workspace_id: str,
    request: TopicModelingRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        if not request.node_ids:
            raise HTTPException(
                status_code=400, detail="At least one node ID must be provided"
            )
        if len(request.node_ids) > 2:
            raise HTTPException(
                status_code=400, detail="Maximum of 2 nodes can be compared"
            )

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            raise HTTPException(
                status_code=404, detail=f"Workspace {workspace_id} not found"
            )

        try:
            import polars as pl  # noqa: F401

            from docframe import DocDataFrame, DocLazyFrame  # type: ignore
        except Exception as e:  # pragma: no cover
            raise HTTPException(
                status_code=500, detail=f"Required libraries unavailable: {e}"
            )

        corpora: list[list[str]] = []
        node_names: list[str] = []
        node_columns = request.node_columns or {}

        for node_id in request.node_ids:
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
            node_data = getattr(node, "data", node)
            node_name = getattr(node, "name", None) or node_id

            if hasattr(node_data, "columns"):
                available_columns = node_data.columns  # type: ignore[attr-defined]
            elif hasattr(node_data, "collect_schema"):
                available_columns = list(node_data.collect_schema().keys())  # type: ignore
            elif hasattr(node_data, "schema"):
                available_columns = list(node_data.schema.keys())  # type: ignore
            else:
                available_columns = []

            column_name = node_columns.get(node_id)
            if not column_name:
                if isinstance(node_data, (DocDataFrame, DocLazyFrame)) and getattr(
                    node_data, "document_column", None
                ):
                    column_name = node_data.document_column  # type: ignore[attr-defined]
                else:
                    common = [
                        c
                        for c in ["document", "text", "content", "body", "message"]
                        if c in available_columns
                    ]
                    if common:
                        column_name = common[0]
            if not column_name:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not determine text column for node {node_id}. Available: {available_columns}",
                )
            if column_name not in available_columns:
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{column_name}' not in node {node_id}. Available: {available_columns}",
                )

            try:
                if hasattr(node_data, "select"):
                    selected = node_data.select(
                        pl.col(column_name).alias("__doc_col__")
                    )  # type: ignore
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported node data type for node {node_id}",
                    )
                if hasattr(selected, "collect"):
                    try:
                        selected = selected.collect()
                    except Exception:  # pragma: no cover
                        pass
                docs = [
                    str(v) if v is not None else ""
                    for v in selected["__doc_col__"].to_list()
                ]  # type: ignore[index]
                corpora.append(docs)
                node_names.append(node_name)
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Error extracting documents from node {node_id}: {e}",
                )

        try:
            from docframe.core.text_utils import topic_visualization  # type: ignore
        except Exception as e:  # pragma: no cover
            raise HTTPException(
                status_code=500, detail=f"topic_visualization unavailable: {e}"
            )

        try:
            tv = topic_visualization(
                corpora=corpora,
                min_topic_size=request.min_topic_size or 5,
                use_ctfidf=bool(request.use_ctfidf),
            )
        except ImportError as ie:
            return TopicModelingResponse(success=False, message=str(ie), data=None)
        except ValueError as ve:
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:  # pragma: no cover
            raise HTTPException(
                status_code=500, detail=f"Error running topic modeling: {e}"
            )

        response_data = {
            "topics": tv["topics"],
            "corpus_sizes": tv["corpus_sizes"],
            "per_corpus_topic_counts": tv.get("per_corpus_topic_counts"),
            "meta": {**tv.get("meta", {}), "node_names": node_names},
        }
        return TopicModelingResponse(
            success=True,
            message=f"Successfully modeled topics for {len(corpora)} corpus/corpora",
            data=response_data,  # type: ignore[arg-type]
        )
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


def _store_concordance_df(key, df):  # pragma: no cover
    CONCORDANCE_CACHE[key] = {"df": df, "created": time.time()}


def _clear_concordance_cache_for(user_id: str, workspace_id: str):  # pragma: no cover
    to_delete = [
        k for k in CONCORDANCE_CACHE if k[0] == user_id and k[1] == workspace_id
    ]
    for k in to_delete:
        CONCORDANCE_CACHE.pop(k, None)
    return len(to_delete)


def _handle_operation_result(result: Any):
    """Utility to unpack safe_operation results.

    Expected result formats:
    - (True, message, obj)
    - (False, error_message, None)
    - Direct object (treated as success)
    """
    try:
        if isinstance(result, tuple) and len(result) == 3:
            return result  # already in (success, message, obj)
        # Fallback interpret
        return True, "ok", result
    except Exception as e:  # pragma: no cover
        return False, f"Unexpected result format: {e}", None


@router.get("/")
async def list_workspaces(current_user: dict = Depends(get_current_user)):
    """List ALL persisted workspaces (summaries) using manager single-load policy."""
    user_id = current_user["id"]
    summaries = workspace_manager.list_user_workspaces_summaries(user_id)
    return {"workspaces": list(summaries.values())}


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
        # Always create an empty workspace (data arguments removed)
        workspace = workspace_manager.create_workspace(
            user_id=user_id,
            name=request.name,
            description=request.description or "",
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


@router.post("/{workspace_id}/unload")
async def unload_workspace(
    workspace_id: str,
    save: bool = True,
    current_user: dict = Depends(get_current_user),
):
    """Unload a workspace from memory (optionally saving first).

    This persists the workspace (unless save=False) then removes it from the
    in-memory session cache so that a subsequent access triggers a lazy load
    from disk. Useful for freeing memory when working with many large
    workspaces.
    """
    user_id = current_user["id"]
    existed = workspace_manager.unload_workspace(user_id, workspace_id, save=save)
    if not existed:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {
        "success": True,
        "message": f"Workspace {workspace_id} unloaded",
        "workspace_id": workspace_id,
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


@router.put("/{workspace_id}/name")
async def rename_workspace(
    workspace_id: str,
    new_name: str,
    current_user: dict = Depends(get_current_user),
):
    """Rename a workspace (frontend expects this endpoint).

    Thin wrapper that updates the workspace name via workspace manager and persists to disk.
    """
    user_id = current_user["id"]
    workspace = workspace_manager.get_workspace(user_id, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    try:
        workspace.name = new_name
        # Persist change
        workspace_manager.persist(user_id, workspace_id)
        # Return updated info similar to other endpoints
        info = workspace_manager.get_workspace_info(user_id, workspace_id)
        if not info:
            raise HTTPException(
                status_code=500, detail="Failed to fetch updated workspace info"
            )
        return info
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to rename workspace: {str(e)}"
        )


@router.post("/{workspace_id}/save")
async def save_workspace(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Persist the current in-memory workspace state to disk.

    Frontend triggers this for explicit user save operations.
    """
    user_id = current_user["id"]
    workspace = workspace_manager.get_workspace(user_id, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    try:
        workspace_manager.persist(user_id, workspace_id)
        return {"success": True, "message": "Workspace saved"}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to save workspace: {str(e)}"
        )


@router.post("/{workspace_id}/save-as")
async def save_workspace_as(
    workspace_id: str,
    filename: str,
    current_user: dict = Depends(get_current_user),
):
    """Save a copy of the workspace under a new filename (ID remains original).

    Creates a brand new workspace (new ID) cloned from the existing one so it
    shows up separately in the workspace manager. The provided filename becomes
    the new workspace name; a .json copy is written for persistence.
    """
    user_id = current_user["id"]
    source_workspace = workspace_manager.get_workspace(user_id, workspace_id)
    if not source_workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    # Collect nodes/data from source workspace via summary & graph
    user_folder = get_user_data_folder(user_id)
    tmp_path = user_folder / f"_tmp_clone_{workspace_id}.json"
    try:
        source_workspace.serialize(tmp_path)
        from docworkspace import Workspace as DWWorkspace  # type: ignore

        from ..core.utils import generate_workspace_id

        new_workspace = DWWorkspace.deserialize(tmp_path)  # type: ignore
        new_id = generate_workspace_id()
        new_workspace.set_metadata("id", new_id)
        new_workspace.set_metadata(
            "created_at", source_workspace.get_metadata("created_at")
        )
        new_workspace.set_metadata(
            "modified_at", source_workspace.get_metadata("modified_at")
        )
        new_workspace.name = filename.replace(".json", "")
        target_folder = get_user_workspace_folder(user_id)
        target_folder.mkdir(parents=True, exist_ok=True)
        new_workspace.serialize(target_folder / f"workspace_{new_id}.json")
        info = workspace_manager.get_workspace_info(user_id, new_id)
        return {"success": True, "message": "Workspace cloned", "new_workspace": info}
    except Exception as e:  # pragma: no cover
        raise HTTPException(
            status_code=500, detail=f"Failed to save workspace copy: {e}"
        )
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass


@router.get("/{workspace_id}/download")
async def download_workspace(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Download the persisted JSON file for the workspace.

    If the workspace is currently active, it's saved first to ensure latest state.
    """
    user_id = current_user["id"]
    current_id = workspace_manager.get_current_workspace_id(user_id)
    if current_id == workspace_id:
        try:
            ws = workspace_manager.get_workspace(user_id, workspace_id)
            if ws:
                workspace_manager.persist(user_id, workspace_id)
        except Exception:
            pass
    user_folder = get_user_workspace_folder(user_id)
    json_path = user_folder / f"workspace_{workspace_id}.json"
    if not json_path.exists():
        raise HTTPException(status_code=404, detail="Workspace file not found")
    return FileResponse(
        json_path,
        media_type="application/json",
        filename=f"workspace_{workspace_id}.json",
    )


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
    workspace_id: str,
    filename: str,
    mode: str = Query(
        "DocLazyFrame",
        description="How to treat the file: 'DocLazyFrame' (wrap as DocLazyFrame) or 'LazyFrame' (plain Polars LazyFrame)",
    ),
    document_column: Optional[str] = Query(
        None, description="Explicit document/text column to use when mode=corpus"
    ),
    current_user: dict = Depends(get_current_user),
):
    """Add a data file as a new node to workspace.

    Enhancements:
    - mode=corpus: attempt to convert underlying data to DocLazyFrame (text-aware)
      using provided document_column or guessing via DocDataFrame.guess_document_column
    - mode=metadata: ensure a plain LazyFrame/DataFrame (no Doc* wrapper)
    """
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

        # Content mode handling (DocLazyFrame vs LazyFrame)
        if mode not in {"DocLazyFrame", "LazyFrame"}:
            raise HTTPException(
                status_code=400,
                detail="Invalid mode. Expected 'DocLazyFrame' or 'LazyFrame'",
            )

        if mode == "DocLazyFrame":
            try:
                import docframe  # noqa: F401
                from docframe.core.docframe import DocDataFrame as _DDF
            except Exception:  # pragma: no cover
                raise HTTPException(
                    status_code=500,
                    detail="docframe library not available for DocLazyFrame mode",
                )

            # Ensure lazy
            try:
                if isinstance(data, pl.DataFrame):
                    data = data.lazy()
            except Exception:
                pass

            if document_column is None:
                try:
                    guessed = _DDF.guess_document_column(data)  # type: ignore[arg-type]
                    document_column = guessed
                except Exception:
                    document_column = None

            # Attempt conversion using namespace (import docframe above registers it)
            try:
                if hasattr(data, "text"):
                    data = data.text.to_doclazyframe(document_column=document_column)  # type: ignore[attr-defined]
                else:
                    from docframe.core.docframe import DocLazyFrame as _DLF

                    if isinstance(data, pl.LazyFrame):
                        data = _DLF(data, document_column=document_column)
            except Exception as e:
                print(f"⚠️ Failed to wrap as DocLazyFrame: {e}")
        else:  # LazyFrame
            try:
                if hasattr(data, "lazyframe"):
                    data = data.lazyframe  # type: ignore[attr-defined]
                elif hasattr(data, "dataframe"):
                    df_inner = data.dataframe  # type: ignore[attr-defined]
                    data = df_inner.lazy()
            except Exception:
                pass
        # End mode handling

        # Create node name from filename
        node_name = (
            filename.replace(".csv", "").replace(".xlsx", "").replace(".json", "")
        )

        # Accept docframe wrapper types as valid (unwrap not required for Node creation)
        doc_wrappers: tuple[type, ...] = tuple()
        try:  # pragma: no cover - optional dependency
            from docframe import DocDataFrame as _DocDF  # type: ignore
            from docframe import DocLazyFrame as _DocLF

            doc_wrappers = (_DocDF, _DocLF)
        except Exception:
            pass

        if not isinstance(data, (pl.DataFrame, pl.LazyFrame)) and not (
            doc_wrappers and isinstance(data, doc_wrappers)  # type: ignore[arg-type]
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported data type loaded from file: {type(data)}. Expected Polars (DataFrame/LazyFrame) or docframe wrappers.",
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
        return DocWorkspaceAPIUtils.convert_node_info_for_api(node)

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
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        return DocWorkspaceAPIUtils.convert_node_info_for_api(node)
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to get node info: {e}")


@router.get("/{workspace_id}/nodes/{node_id}/data")
async def get_node_data(
    workspace_id: str,
    node_id: str,
    page: int = 1,
    page_size: int = 20,
    current_user: dict = Depends(get_current_user),
):
    """Get node data rows with simple pagination."""
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        data_obj = node.data
        if hasattr(data_obj, "collect"):
            df = data_obj.collect()
        else:
            df = data_obj

        total_rows = len(df)
        start_idx = (page - 1) * page_size
        paginated_df = df.slice(start_idx, page_size)

        return {
            "data": paginated_df.to_dicts(),
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_rows": total_rows,
                "total_pages": (total_rows + page_size - 1) // page_size,
                "has_next": start_idx + page_size < total_rows,
                "has_prev": page > 1,
            },
            "columns": list(df.columns),
            "dtypes": {col: str(dtype) for col, dtype in df.schema.items()},
        }
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to get node data: {e}")


@router.get("/{workspace_id}/nodes/{node_id}/shape")
async def get_node_shape(
    workspace_id: str, node_id: str, current_user: dict = Depends(get_current_user)
):
    """Return shape [rows, columns] for node data (lazy or eager) with minimal work."""
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        data_obj = node.data
        # Detect docframe wrapper (optional informational flag)
        try:  # pragma: no cover
            from docframe import DocDataFrame, DocLazyFrame  # type: ignore

            doc_wrapper = isinstance(data_obj, (DocDataFrame, DocLazyFrame))
        except Exception:  # pragma: no cover
            doc_wrapper = False

        if (
            node.is_lazy
            and hasattr(data_obj, "select")
            and hasattr(data_obj, "collect")
        ):
            # Row count via pl.len()
            try:
                count_df = data_obj.select(pl.len().alias("_len"))
                collected = count_df.collect()
                polars_df = (
                    collected.to_dataframe()
                    if hasattr(collected, "to_dataframe")
                    else collected
                )
                row_count = polars_df.to_series(0).item()
            except Exception:
                try:
                    full = data_obj.collect()
                    polars_full = (
                        full.to_dataframe() if hasattr(full, "to_dataframe") else full
                    )
                    row_count = (
                        polars_full.shape[0] if hasattr(polars_full, "shape") else None
                    )
                except Exception:
                    row_count = None

            # Column count via schema (cheap)
            try:
                if hasattr(data_obj, "collect_schema"):
                    schema = data_obj.collect_schema()
                    names = schema.names() if hasattr(schema, "names") else []
                    column_count = len(names)
                else:
                    # Fallback minimal collect
                    minimal = data_obj.collect()
                    polars_min = (
                        minimal.to_dataframe()
                        if hasattr(minimal, "to_dataframe")
                        else minimal
                    )
                    column_count = (
                        polars_min.shape[1] if hasattr(polars_min, "shape") else None
                    )
            except Exception:
                column_count = None
            shape = [row_count, column_count]
        else:
            # Eager path
            if hasattr(data_obj, "shape"):
                try:
                    shape_tuple = data_obj.shape
                    shape = [shape_tuple[0], shape_tuple[1]]
                except Exception:
                    shape = [None, None]
            else:
                shape = [None, None]

        return {
            "shape": shape,
            "is_lazy": node.is_lazy,
            "calculated": True,
            "doc_wrapper": doc_wrapper,
        }
    except Exception as e:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to calculate node shape: {type(e).__name__}: {str(e)}",
        )


@router.get("/{workspace_id}/nodes/{node_id}/columns/{column_name}/unique")
async def get_column_unique_values(
    workspace_id: str,
    node_id: str,
    column_name: str,
    current_user: dict = Depends(get_current_user),
):
    """Get unique values count for a specific column."""
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        data_obj = node.data

        # Check if column exists
        if hasattr(data_obj, "columns"):
            columns = list(data_obj.columns)
        elif hasattr(data_obj, "schema"):
            columns = list(data_obj.schema.keys())
        else:
            raise HTTPException(status_code=400, detail="Cannot determine columns")

        if column_name not in columns:
            raise HTTPException(
                status_code=404, detail=f"Column '{column_name}' not found"
            )

        # Get unique values - handle both lazy and eager data
        if hasattr(data_obj, "collect"):
            # Lazy frame
            df = data_obj.collect()
        else:
            # Already materialized
            df = data_obj

        # Get unique values using Polars
        try:
            unique_values = df.select(column_name).unique().to_series().to_list()
            unique_count = len(unique_values)

            # Limit the actual values returned to avoid huge responses
            max_values_to_return = 100
            if len(unique_values) > max_values_to_return:
                sample_values = unique_values[:max_values_to_return]
            else:
                sample_values = unique_values

            return {
                "column_name": column_name,
                "unique_count": unique_count,
                "sample_values": sample_values,
                "total_values_returned": len(sample_values),
                "has_more": len(unique_values) > max_values_to_return,
            }

        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get unique values for column '{column_name}': {str(e)}",
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to process column unique values: {e}"
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


@router.post("/{workspace_id}/nodes/{node_id}/convert")
async def convert_node(
    workspace_id: str,
    node_id: str,
    target: str = Query(
        ...,
        description="Target type: docdataframe, dataframe, doclazyframe, or lazyframe",
    ),
    document_column: Optional[str] = Query(
        None,
        description="Document column for Doc* types (auto-detected if not specified)",
    ),
    current_user: dict = Depends(get_current_user),
):
    """Convert a node's data to the specified target type in place.

    Supported target types:
    - docdataframe: DocDataFrame (materialized, requires document column)
    - dataframe: Polars DataFrame (materialized)
    - doclazyframe: DocLazyFrame (lazy, requires document column)
    - lazyframe: Polars LazyFrame (lazy)
    """
    user_id = current_user["id"]

    # Validate target parameter
    valid_targets = {"docdataframe", "dataframe", "doclazyframe", "lazyframe"}
    if target not in valid_targets:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid target '{target}'. Must be one of: {', '.join(sorted(valid_targets))}",
        )

    # Check docframe availability for Doc* types
    if target in {"docdataframe", "doclazyframe"} and (
        DocDataFrame is None or DocLazyFrame is None
    ):
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

    try:
        new_data = None
        operation_name = f"convert_to_{target}"

        if target == "docdataframe":
            # Convert to DocDataFrame
            if isinstance(data, DocDataFrame):  # type: ignore[arg-type]
                # If user specified a different document column, validate and update
                if document_column and document_column != data.document_column:
                    new_data = data.set_document(document_column)
                else:
                    new_data = data

            elif isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
                # Materialize and wrap
                collected = data.to_docdataframe()
                if document_column and document_column != collected.document_column:
                    new_data = collected.set_document(document_column)
                else:
                    new_data = collected

            elif isinstance(data, pl.DataFrame):
                # Wrap as DocDataFrame
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
                new_data = DocDataFrame(data, document_column=doc_col)  # type: ignore[call-arg]

            elif isinstance(data, pl.LazyFrame):
                # Collect and wrap
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
                new_data = DocDataFrame(data.collect(), document_column=doc_col)  # type: ignore[call-arg]

        elif target == "dataframe":
            # Convert to Polars DataFrame
            if DocDataFrame is not None and isinstance(data, DocDataFrame):  # type: ignore[arg-type]
                new_data = data.dataframe
            elif DocLazyFrame is not None and isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
                new_data = data.to_docdataframe().dataframe
            elif hasattr(data, "collect"):
                new_data = data.collect()
            elif isinstance(data, pl.DataFrame):
                new_data = data
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported data type for conversion: {type(data).__name__}",
                )

        elif target == "doclazyframe":
            # Convert to DocLazyFrame
            if isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
                # If user specified a different document column, validate and update
                if document_column and document_column != data.document_column:
                    if document_column not in getattr(data, "columns", []):
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"Document column '{document_column}' not found in node. "
                                f"Available columns: {getattr(data, 'columns', [])}"
                            ),
                        )
                    new_data = data.with_document_column(document_column)
                else:
                    new_data = data

            elif isinstance(data, DocDataFrame):  # type: ignore[arg-type]
                # Convert to lazy and wrap
                lf = data.dataframe.lazy()
                if document_column and document_column not in data.dataframe.columns:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Document column '{document_column}' not found in node. "
                            f"Available columns: {data.dataframe.columns}"
                        ),
                    )
                doc_col = document_column or data.document_column
                new_data = DocLazyFrame(lf, document_column=doc_col)  # type: ignore[misc]

            elif isinstance(data, pl.LazyFrame):
                # Wrap as DocLazyFrame
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
                new_data = DocLazyFrame(data, document_column=doc_col)  # type: ignore[misc]

            elif isinstance(data, pl.DataFrame):
                # To lazy and wrap
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
                new_data = DocLazyFrame(lf, document_column=doc_col)  # type: ignore[misc]

        elif target == "lazyframe":
            # Convert to Polars LazyFrame
            if DocLazyFrame is not None and isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
                new_data = data.to_lazyframe()
            elif DocDataFrame is not None and isinstance(data, DocDataFrame):  # type: ignore[arg-type]
                new_data = data.dataframe.lazy()
            elif isinstance(data, pl.DataFrame):
                new_data = data.lazy()
            elif isinstance(data, pl.LazyFrame):
                new_data = data
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported data type for conversion: {type(data).__name__}",
                )

        # Validate conversion result
        if new_data is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported data type for conversion: {type(data).__name__}",
            )

        # In-place update of the node's data
        src_node.data = new_data  # type: ignore[assignment]
        try:
            src_node.operation += "\n" + operation_name
        except Exception:
            pass

        # Persist workspace
        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            workspace_manager.persist(user_id, workspace_id)

        return DocWorkspaceAPIUtils.convert_node_info_for_api(src_node)

    except HTTPException:
        raise
    except ValueError as e:
        # Surface validation problems (e.g., wrong document_column) as 400s
        logger.error("Node conversion validation error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(
            "Node conversion failed for workspace=%s node=%s target=%s",
            workspace_id,
            node_id,
            target,
        )
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


# Legacy endpoints for backward compatibility
@router.post("/{workspace_id}/nodes/{node_id}/convert/to-docdataframe")
async def convert_node_to_docdataframe(
    workspace_id: str,
    node_id: str,
    document_column: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Convert a node's data to a DocDataFrame in place. (Legacy endpoint - use /convert with target=docdataframe)"""
    return await convert_node(
        workspace_id, node_id, "docdataframe", document_column, current_user
    )


@router.post("/{workspace_id}/nodes/{node_id}/convert/to-dataframe")
async def convert_node_to_dataframe(
    workspace_id: str,
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Convert a node's data to a Polars DataFrame in place. (Legacy endpoint - use /convert with target=dataframe)"""
    return await convert_node(workspace_id, node_id, "dataframe", None, current_user)


@router.post("/{workspace_id}/nodes/{node_id}/convert/to-doclazyframe")
async def convert_node_to_doclazyframe(
    workspace_id: str,
    node_id: str,
    document_column: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Convert a node's data to a DocLazyFrame in place. (Legacy endpoint - use /convert with target=doclazyframe)"""
    return await convert_node(
        workspace_id, node_id, "doclazyframe", document_column, current_user
    )


@router.post("/{workspace_id}/nodes/{node_id}/convert/to-lazyframe")
async def convert_node_to_lazyframe(
    workspace_id: str,
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Convert a node's data to a Polars LazyFrame in place. (Legacy endpoint - use /convert with target=lazyframe)"""
    return await convert_node(workspace_id, node_id, "lazyframe", None, current_user)


@router.post("/{workspace_id}/nodes/{node_id}/reset-document")
async def reset_node_document_column(
    workspace_id: str,
    node_id: str,
    document_column: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Reset (change) the active document column for DocDataFrame / DocLazyFrame nodes.

    If document_column is omitted the backend will attempt to auto-detect using
    the same heuristic as DocDataFrame.guess_document_column / DocLazyFrame.guess_document_column.
    """
    user_id = current_user["id"]

    if DocDataFrame is None or DocLazyFrame is None:
        raise HTTPException(
            status_code=500, detail="docframe library not available on backend"
        )

    src_node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not src_node:
        logger.warning(
            "reset-document: node not found (workspace=%s node=%s)",
            workspace_id,
            node_id,
        )
        raise HTTPException(status_code=404, detail="Node not found")

    data = getattr(src_node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")

    import polars as pl

    try:
        new_data = None

        # DocDataFrame -> use set_document (returns new instance but we reassign in-place)
        if isinstance(data, DocDataFrame):  # type: ignore[arg-type]
            current_col = data.document_column  # type: ignore[attr-defined]
            target_col = document_column
            if not target_col:
                target_col = DocDataFrame.guess_document_column(data.dataframe)  # type: ignore[attr-defined]
            if not target_col:
                raise HTTPException(
                    status_code=400,
                    detail="Unable to auto-detect document column; please provide document_column",
                )
            if target_col not in data.dataframe.columns:
                raise HTTPException(
                    status_code=400,
                    detail=f"Document column '{target_col}' not found. Available: {data.dataframe.columns}",
                )
            if target_col == current_col:
                logger.info(
                    "reset-document: no-op (DocDataFrame already using '%s')",
                    target_col,
                )
                return DocWorkspaceAPIUtils.convert_node_info_for_api(src_node)
            new_data = data.set_document(target_col)

        # DocLazyFrame -> rebuild wrapper with new column
        elif isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
            current_col = data.document_column  # type: ignore[attr-defined]
            target_col = document_column
            if not target_col:
                target_col = DocLazyFrame.guess_document_column(data.lazyframe)  # type: ignore[attr-defined]
            if not target_col:
                raise HTTPException(
                    status_code=400,
                    detail="Unable to auto-detect document column; please provide document_column",
                )
            # Validate column exists in schema
            schema = data.lazyframe.collect_schema()
            if target_col not in schema:
                raise HTTPException(
                    status_code=400,
                    detail=f"Document column '{target_col}' not found in schema. Available: {list(schema.keys())}",
                )
            # Validate type
            if schema[target_col] not in (pl.Utf8, pl.String):
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{target_col}' is not a string column (dtype={schema[target_col]})",
                )
            if target_col == current_col:
                logger.info(
                    "reset-document: no-op (DocLazyFrame already using '%s')",
                    target_col,
                )
                return DocWorkspaceAPIUtils.convert_node_info_for_api(src_node)
            new_data = DocLazyFrame(data.lazyframe, document_column=target_col)
        else:
            raise HTTPException(
                status_code=400,
                detail="Reset document column only supported for DocDataFrame or DocLazyFrame nodes",
            )

        # In-place update
        src_node.data = new_data  # type: ignore[assignment]
        try:
            src_node.operation = "reset_document"
        except Exception:
            pass

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            workspace_manager.persist(user_id, workspace_id)

        return DocWorkspaceAPIUtils.convert_node_info_for_api(src_node)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "Reset document column failed for workspace=%s node=%s",
            workspace_id,
            node_id,
        )
        raise HTTPException(status_code=500, detail=f"Reset document failed: {str(e)}")


@router.put("/{workspace_id}/nodes/{node_id}/name")
async def update_node_name(
    workspace_id: str,
    node_id: str,
    new_name: str,
    current_user: dict = Depends(get_current_user),
):
    """RESTful node rename endpoint (preferred).

    Update a node's name (preferred RESTful endpoint).
    Accepts new_name as a query parameter (same pattern as workspace rename).
    """
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        node.name = new_name
        # Persist workspace after rename
        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            try:  # noqa: SIM105
                workspace_manager.persist(user_id, workspace_id)
            except Exception:  # pragma: no cover
                logger.exception("Failed to persist workspace after node rename")
        # Return updated node info (consistent shape for frontend)
        if hasattr(node, "info"):
            try:
                return DocWorkspaceAPIUtils.convert_node_info_for_api(node)  # type: ignore[call-arg]
            except Exception:
                pass
        return {"id": getattr(node, "id", node_id), "name": new_name}
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to rename node: {e}")


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
        # If pandas, convert to Polars (check for pandas specifically)
        if (
            hasattr(data, "iloc")
            and hasattr(data, "dtypes")
            and not isinstance(data, (pl.DataFrame, pl.LazyFrame))
        ):
            # This is pandas - convert to Polars
            data = pl.DataFrame(data)
        # Prefer LazyFrame for Polars DataFrames
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
            "node": DocWorkspaceAPIUtils.convert_node_info_for_api(
                node
            ),  # Use latest DocWorkspace method
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
        iso_pattern = re.compile(
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+\-]\d{2}:?\d{2})$"
        )

        def parse_temporal(val):
            """Parse ISO8601 preserving timezone.

            If value matches ISO8601 with timezone or 'Z', convert to aware datetime.
            Otherwise return original value.
            """
            if isinstance(val, str) and iso_pattern.match(val):
                s = val
                if s.endswith("Z"):
                    s = s[:-1] + "+00:00"
                # Normalize timezone without colon e.g. +0000 to +00:00
                if re.search(r"([+\-]\d{2})(\d{2})$", s):
                    s = re.sub(r"([+\-]\d{2})(\d{2})$", r"\1:\2", s)
                try:
                    dt = datetime.fromisoformat(s)
                    return dt
                except Exception:
                    return val
            return val

        def coerce_scalar(v):
            # Attempt numeric coercion if appropriate
            if isinstance(v, str):
                try:
                    if "." in v:
                        return float(v)
                    return int(v)
                except Exception:
                    pass
            return v

        filter_expr = None
        for condition in request.conditions:
            column_expr = pl.col(condition.column)

            op = condition.operator
            raw_value = condition.value

            expr = None
            if op in {
                "eq",
                "equals",
                "ne",
                "gt",
                "greater_than",
                "gte",
                "lt",
                "less_than",
                "lte",
            }:
                value = parse_temporal(raw_value)
                value = coerce_scalar(value)
                # For aware datetimes ensure we compare with timezone aware columns; Polars expects same time unit & tz
                lit_val = pl.lit(value) if isinstance(value, datetime) else value
                if op in {"eq", "equals"}:
                    expr = column_expr == lit_val
                elif op == "ne":
                    expr = column_expr != lit_val
                elif op in {"gt", "greater_than"}:
                    expr = column_expr > lit_val
                elif op == "gte":
                    expr = column_expr >= lit_val
                elif op in {"lt", "less_than"}:
                    expr = column_expr < lit_val
                elif op == "lte":
                    expr = column_expr <= lit_val
            elif op == "contains":
                # regex flag controls regex vs literal
                pattern = str(raw_value)
                if getattr(condition, "regex", False):
                    expr = column_expr.str.contains(pattern)
                else:
                    expr = column_expr.str.contains(pl.lit(pattern), literal=True)
            elif op == "startswith":
                # Always use Polars built-in; ignore regex flag per product requirement
                expr = column_expr.str.starts_with(str(raw_value))
            elif op == "endswith":
                # Always use Polars built-in; ignore regex flag per product requirement
                expr = column_expr.str.ends_with(str(raw_value))
            elif op == "is_null":
                expr = column_expr.is_null()
            elif op == "is_not_null":
                expr = column_expr.is_not_null()
            elif op == "between":
                if isinstance(raw_value, dict):
                    start_val = (
                        parse_temporal(raw_value.get("start"))
                        if raw_value.get("start") is not None
                        else None
                    )
                    end_val = (
                        parse_temporal(raw_value.get("end"))
                        if raw_value.get("end") is not None
                        else None
                    )
                    if start_val is not None and end_val is not None:
                        if isinstance(start_val, datetime):
                            start_val = pl.lit(start_val)
                        if isinstance(end_val, datetime):
                            end_val = pl.lit(end_val)
                        expr = column_expr.is_between(start_val, end_val, closed="both")
                    elif start_val is not None:
                        if isinstance(start_val, datetime):
                            start_val = pl.lit(start_val)
                        expr = column_expr >= start_val
                    elif end_val is not None:
                        if isinstance(end_val, datetime):
                            end_val = pl.lit(end_val)
                        expr = column_expr <= end_val
                    else:
                        expr = pl.lit(True)
                else:
                    expr = pl.lit(True)
            else:
                expr = column_expr.str.contains(str(raw_value))

            # Apply negate flag if present
            if getattr(condition, "negate", False) and expr is not None:
                try:
                    expr = expr.not_()
                except Exception:
                    # Fallback: invert via ~ operator
                    expr = ~expr

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
    """Join two nodes directly, delegating to docframe where available.

    Allowed join strategies (Polars): 'inner', 'left', 'right', 'full', 'semi', 'anti', 'cross'
    """
    user_id = current_user["id"]
    try:
        # Lookup nodes
        left_node = workspace_manager.get_node_from_workspace(
            user_id, workspace_id, left_node_id
        )
        right_node = workspace_manager.get_node_from_workspace(
            user_id, workspace_id, right_node_id
        )
        if not left_node or not right_node:
            raise HTTPException(status_code=404, detail="One or both nodes not found")

        # Inputs
        left_data = left_node.data
        right_data = right_node.data

        # Validate and pass-through Polars-supported join strategies only
        allowed_hows = {"inner", "left", "right", "full", "semi", "anti", "cross"}
        how_val = (how or "inner").lower()
        if how_val not in allowed_hows:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid join type. Allowed values: inner, left, right, full, semi, anti, cross"
                ),
            )

        # Prefer docframe's realization via data.join; handle cross-join separately (no keys)
        print(type(left_data))
        print(type(right_data))
        if how_val == "cross":
            joined_data = left_data.join(
                right_data,
                how="cross",
            )
        else:
            joined_data = left_data.join(
                right_data,
                left_on=left_on,
                right_on=right_on,
                how=how_val,
            )

        # Create and add new node
        node_name = new_node_name or f"{left_node.name}_join_{right_node.name}"
        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=joined_data,
            node_name=node_name,
            operation=f"join({left_node.name}, {right_node.name})",
            parents=[left_node, right_node],
        )

        # Return stable API shape
        return DocWorkspaceAPIUtils.convert_node_info_for_api(new_node)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Join failed: {e}")


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

            import polars as pl

            # Optionally join metadata (original row) by document_idx when requested
            if request.show_metadata:
                # Ensure document_idx exists in concordance_result for join
                cdf = concordance_result
                if "document_idx" not in cdf.columns:
                    cdf = cdf.with_row_index("document_idx")
                # Materialize original node data and add document_idx
                base = node.data
                if hasattr(base, "to_lazyframe"):
                    base_df = base.to_lazyframe().collect()
                elif hasattr(base, "_df"):
                    base_df = base._df  # type: ignore[attr-defined]
                elif hasattr(base, "collect"):
                    base_df = base.collect()
                else:
                    base_df = base
                if isinstance(base_df, pl.LazyFrame):
                    base_df = base_df.collect()
                # Align document_idx dtype across both sides before join
                orig = base_df.with_row_index("document_idx")
                try:
                    idx_dtype = cdf.schema.get("document_idx")
                    if idx_dtype is not None:
                        orig = orig.with_columns(pl.col("document_idx").cast(idx_dtype))
                except Exception:
                    pass
                # Join original metadata to the right
                concordance_result = cdf.join(orig, on="document_idx", how="left")

            # Apply sorting if requested (after join so metadata columns are sortable)
            if request.sort_by and request.sort_by in concordance_result.columns:
                concordance_result = concordance_result.sort(
                    pl.col(request.sort_by),
                    descending=request.sort_order.lower() == "desc",
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
        # Validate number of nodes
        if len(request.node_ids) == 0:
            raise HTTPException(
                status_code=400, detail="At least one node ID must be provided"
            )
        if len(request.node_ids) > 2:
            raise HTTPException(
                status_code=400, detail="Maximum 2 nodes supported for comparison"
            )

        results = {}
        full_dfs = []  # store full cached dfs for combined view
        per_node_columns = {}

        for node_id in request.node_ids:
            # Fetch node
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

            # Resolve column
            column = request.node_columns.get(node_id)
            if not column:
                raise HTTPException(
                    status_code=400, detail=f"No column specified for node {node_id}"
                )

            # Validate column existence if we can introspect
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

            # Build cache key & fetch
            cache_key = _concordance_cache_key(
                user_id,
                workspace_id,
                node_id,
                column,
                request.search_word,
                request.num_left_tokens,
                request.num_right_tokens,
                request.regex,
                request.case_sensitive,
            )
            concordance_result = _get_cached_concordance_df(cache_key)

            # Compute if not cached
            if concordance_result is None:
                if hasattr(node.data, "text"):
                    concordance_result = node.data.text.concordance(
                        column=column,
                        search_word=request.search_word,
                        num_left_tokens=request.num_left_tokens,
                        num_right_tokens=request.num_right_tokens,
                        regex=request.regex,
                        case_sensitive=request.case_sensitive,
                    )
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Node {node_id} does not support text operations",
                    )
                _store_concordance_df(cache_key, concordance_result)  # store unsorted

            # Work on a non-mutating sorted view for this request
            working_df = concordance_result
            # If metadata requested, join original row by document_idx
            if request.show_metadata:
                try:
                    cdf = working_df
                    if "document_idx" not in cdf.columns:
                        cdf = cdf.with_row_index("document_idx")
                    base = node.data
                    if hasattr(base, "to_lazyframe"):
                        base_df = base.to_lazyframe().collect()
                    elif hasattr(base, "_df"):
                        base_df = base._df  # type: ignore[attr-defined]
                    elif hasattr(base, "collect"):
                        base_df = base.collect()
                    else:
                        base_df = base
                    if isinstance(base_df, pl.LazyFrame):
                        base_df = base_df.collect()
                    orig = base_df.with_row_index("document_idx")
                    working_df = cdf.join(orig, on="document_idx", how="left")
                except Exception as je:
                    logger.warning(f"Failed to join metadata for node {node_id}: {je}")
            if (
                request.sort_by
                and hasattr(working_df, "columns")
                and request.sort_by in working_df.columns
            ):  # type: ignore
                working_df = working_df.sort(
                    pl.col(request.sort_by),
                    descending=request.sort_order.lower() == "desc",
                )  # type: ignore

            total_matches = len(working_df)
            start_idx = (request.page - 1) * request.page_size
            end_idx = start_idx + request.page_size
            paginated_result = working_df.slice(start_idx, request.page_size)

            node_name = node.name if hasattr(node, "name") and node.name else node_id
            per_node_columns[node_name] = list(working_df.columns)
            if hasattr(paginated_result, "to_dicts"):
                results[node_name] = {
                    "data": paginated_result.to_dicts(),
                    "columns": list(working_df.columns),
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
                if request.combined:
                    try:
                        df_with_source = working_df.with_columns(
                            pl.lit(node_name).alias("__source_node")
                        )  # type: ignore
                        full_dfs.append(df_with_source)
                    except Exception:
                        pass
            else:
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

        # Build combined view dynamically (uncached)
        if request.combined and len(full_dfs) >= 2:
            try:
                # Only allow combined if schemas are identical when metadata requested
                if request.show_metadata:
                    # All per_node_columns must match
                    col_sets = list(per_node_columns.values())
                    if not col_sets or any(
                        cols != col_sets[0] for cols in col_sets[1:]
                    ):
                        # Skip combined view by not adding __COMBINED__ key
                        return {
                            "success": True,
                            "message": f"Found concordance results for search term '{request.search_word}'",
                            "data": results,
                        }
                combined_df = pl.concat(full_dfs, how="vertical")
                # Apply requested sorting when provided; fall back to document_idx asc
                effective_sort_by = None
                effective_sort_order = (
                    request.sort_order if request.sort_order else "asc"
                )
                if request.sort_by and request.sort_by in combined_df.columns:
                    effective_sort_by = request.sort_by
                    combined_df = combined_df.sort(
                        pl.col(request.sort_by),
                        descending=effective_sort_order.lower() == "desc",
                    )
                elif "document_idx" in combined_df.columns:
                    effective_sort_by = "document_idx"
                    combined_df = combined_df.sort(pl.col("document_idx"))
                total_combined = len(combined_df)
                start_idx = (request.page - 1) * request.page_size
                paginated = combined_df.slice(start_idx, request.page_size)
                results["__COMBINED__"] = {
                    "data": paginated.to_dicts(),
                    "columns": list(combined_df.columns),
                    "total_matches": total_combined,
                    "pagination": {
                        "page": request.page,
                        "page_size": request.page_size,
                        "total_pages": (total_combined + request.page_size - 1)
                        // request.page_size,
                        "has_next": (start_idx + request.page_size) < total_combined,
                        "has_prev": request.page > 1,
                    },
                    "sorting": {
                        "sort_by": effective_sort_by,
                        "sort_order": effective_sort_order,
                    },
                }
            except Exception as ce:
                print(f"⚠️ Failed to build combined concordance view: {ce}")

        return {
            "success": True,
            "message": f"Found concordance results for search term '{request.search_word}'",
            "data": results,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"❌ Unexpected multi-node concordance error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/{workspace_id}/concordance/cache/clear")
async def clear_concordance_cache(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Clear in-memory concordance cache for this user's workspace (called when leaving tab)."""
    user_id = current_user["id"]
    removed = _clear_concordance_cache_for(user_id, workspace_id)
    return {"success": True, "removed": removed}


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
            - target_type: str - target data type (e.g., "integer", "float", "string", "datetime", "boolean")
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
        # Optional strict flag (Polars defaults to strict=True). We default to False to avoid
        # hard failures on a few malformed rows (frontend previously succeeded with strict=False).
        strict_flag = (
            cast_data.get("strict") if "strict" in cast_data else False
        )  # default lenient

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

        # Determine operation based on target type
        target_lower = target_type.lower()

        # Perform the casting using .with_columns() and expressions
        try:
            if target_lower == "datetime":
                # Simplified: single to_datetime call mirroring notebook usage
                # Default strict=False so rows that don't match become null instead of failing entire cast
                try:
                    if datetime_format:
                        parsed = pl.col(column_name).str.to_datetime(
                            format=datetime_format, strict=bool(strict_flag)
                        )
                    else:
                        parsed = pl.col(column_name).str.to_datetime(
                            strict=bool(strict_flag)
                        )

                    # Ensure timezone-aware UTC. Polars returns naive datetimes by default.
                    # If the parsed result is already timezone aware we convert to UTC, otherwise we set it.
                    # We can't inspect the expression's dtype pre-execution, so we defensively apply replace_time_zone then convert.
                    cast_expr = (
                        parsed.dt.replace_time_zone("UTC")
                        .dt.convert_time_zone("UTC")
                        .alias(column_name)
                    )
                except Exception as e:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Error casting column '{column_name}' to {target_type}: {e}. "
                            "This often occurs when some rows don't match the supplied format. "
                            "Note your notebook example used .head() (sampling) which may hide later malformed rows. "
                            "Either clean inconsistent rows or keep strict=False (default) to set them null."
                        ),
                    )
            elif target_lower in ("string", "utf8", "str", "text"):
                # Datetime -> string (optionally with format) or no-op if already string
                # Detect current dtype (best effort)
                try:
                    if (
                        hasattr(current_df, "schema")
                        and column_name in current_df.schema
                    ):  # DataFrame
                        col_dtype = current_df.schema[column_name]
                    elif hasattr(current_df, "collect_schema"):  # LazyFrame
                        col_dtype = current_df.collect_schema().get(column_name, None)
                    else:
                        col_dtype = None
                except Exception:
                    col_dtype = None

                if str(col_dtype).startswith("Datetime"):
                    if datetime_format:
                        # Use chrono-compatible formatting tokens
                        cast_expr = (
                            pl.col(column_name)
                            .dt.strftime(datetime_format)
                            .alias(column_name)
                        )
                    else:
                        # Fallback: cast to Utf8 (ISO rendering)
                        cast_expr = pl.col(column_name).cast(pl.Utf8).alias(column_name)
                else:
                    # Already string or unknown -> ensure Utf8
                    cast_expr = pl.col(column_name).cast(pl.Utf8).alias(column_name)
                # For string target we treat provided format as format_used if any
            elif target_lower == "integer":
                # Integer casting improvements:
                # 1. If source is float: truncate (floor) decimals deterministically.
                # 2. If source is string: parse via float first (lenient), then truncate -> int.
                # 3. Otherwise: direct int cast (lenient) to avoid whole-column failure.
                col_expr = pl.col(column_name)
                orig_lower = (original_type or "").lower()
                if "float" in orig_lower:
                    # Truncate decimals by casting directly (Polars truncates toward zero)
                    cast_expr = (
                        col_expr.cast(pl.Float64, strict=False)
                        .cast(pl.Int64, strict=False)
                        .alias(column_name)
                    )
                elif any(tok in orig_lower for tok in ["utf8", "string", "str"]):
                    # Attempt float parse (lenient) then truncate by casting to int
                    cast_expr = (
                        col_expr.cast(pl.Float64, strict=False)
                        .cast(pl.Int64, strict=False)
                        .alias(column_name)
                    )
                else:
                    cast_expr = col_expr.cast(pl.Int64, strict=False).alias(column_name)
            elif target_lower == "float":
                # String -> number (float) conversion
                cast_expr = pl.col(column_name).cast(pl.Float64).alias(column_name)
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Casting to '{target_type}' is not yet supported. Supported: string, integer, float, datetime.",
                )

            # Perform a small head() sample validation to surface conversion errors early
            # Works for both LazyFrame (collect) and DataFrame (no collect needed).
            try:
                if hasattr(current_df, "head"):
                    _sample = current_df.head(50).with_columns(cast_expr)
                    if hasattr(_sample, "collect"):
                        _ = _sample.collect()
                    else:
                        # DataFrame path: building the sample is sufficient to validate expression
                        _ = _sample
            except Exception as sample_err:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Sample validation failed when casting column '{column_name}' to {target_type}: {sample_err}"
                    ),
                )

            # Apply the casting with .with_columns(); preserve original frame type after validation
            casted_data = current_df.with_columns(cast_expr)
            # Update the node data in-place (preserving the original type)
            node.data = casted_data

            # Save workspace to disk
            # Ensure current workspace is persisted after casting
            workspace_manager.persist(user_id, workspace_id)
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
                    "format_used": datetime_format if datetime_format else None,
                    "strict_used": bool(strict_flag)
                    if target_lower == "datetime"
                    else None,
                },
                "message": (
                    f"Successfully cast column '{column_name}' from {original_type} to {new_type}"
                    + (" (UTC timezone applied)" if target_lower == "datetime" else "")
                ),
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
                    # For DocDataFrame/DocLazyFrame, ensure the result stays a Doc*Frame.
                    # Previous implementation relied on delegation .select which (after
                    # recent delegation change) returns a raw polars frame when the
                    # original document column is dropped, causing compute_token_frequencies
                    # to raise a TypeError. We now explicitly re-wrap.
                    try:  # Local import to avoid mandatory dependency at module load
                        from docframe import DocDataFrame as _DDF  # type: ignore
                        from docframe import DocLazyFrame as _DLF
                    except Exception as _e:  # pragma: no cover
                        raise HTTPException(
                            status_code=500,
                            detail=f"docframe not available for token frequency: {_e}",
                        )

                    if isinstance(node_data, _DLF):
                        if column_name == node_data.document_column:
                            processed_frame = node_data
                        else:
                            base_lazy = node_data.to_lazyframe()
                            selected_lazy = base_lazy.select(
                                pl.col(column_name).alias("document")
                            )
                            processed_frame = _DLF(
                                selected_lazy, document_column="document"
                            )
                    else:  # DocDataFrame
                        if column_name == node_data.document_column:  # type: ignore[attr-defined]
                            processed_frame = node_data
                        else:
                            # node_data.select(...) may return raw DataFrame; that's fine we re-wrap
                            selected_df_any = node_data.select(  # type: ignore[call-arg]
                                pl.col(column_name).alias("document")
                            )
                            # Ensure we have a concrete DataFrame (collect if lazy just in case)
                            if not isinstance(
                                selected_df_any, pl.DataFrame
                            ) and hasattr(selected_df_any, "collect"):
                                try:  # type: ignore[call-arg]
                                    selected_df_any = selected_df_any.collect()  # type: ignore[assignment]
                                except Exception:  # pragma: no cover
                                    pass
                            if not isinstance(
                                selected_df_any, pl.DataFrame
                            ):  # pragma: no cover
                                raise HTTPException(
                                    status_code=500,
                                    detail="Failed to materialize DataFrame for token frequency calculation",
                                )
                            processed_frame = _DDF(
                                selected_df_any, document_column="document"
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

            # Do not limit or filter statistics by the per-node frequency results.
            # Return the full statistics table so the frontend can derive selections from all vocabulary.

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

            # Simplified eager path: always materialize underlying data, perform join eagerly.
            import polars as pl

            if "DocLazyFrame" in type(node.data).__name__ and hasattr(
                node.data, "to_lazyframe"
            ):
                underlying_df = node.data.to_lazyframe().collect()  # type: ignore[call-arg]
            elif "DocDataFrame" in type(node.data).__name__ and hasattr(
                node.data, "_df"
            ):
                underlying_df = node.data._df  # type: ignore[attr-defined]
            elif isinstance(node.data, pl.LazyFrame):
                underlying_df = node.data.collect()
            else:
                underlying_df = node.data
            if isinstance(underlying_df, pl.LazyFrame):  # safeguard
                underlying_df = underlying_df.collect()
            if not isinstance(underlying_df, pl.DataFrame):
                raise HTTPException(
                    status_code=500,
                    detail="Failed to materialize underlying data for concordance detach",
                )
            original_with_idx = underlying_df.with_row_index("document_idx")
            other_df = concordance_with_idx.select([
                "document_idx",
                "left_context",
                "matched_text",
                "right_context",
                "l1",
                "r1",
                "l1_freq",
                "r1_freq",
            ])
            final_data = original_with_idx.join(
                other_df, on="document_idx", how="left"
            ).drop("document_idx")

            # Generate new node name if not provided
            if request.new_node_name:
                new_node_name = request.new_node_name
            else:
                original_name = (
                    node.name if hasattr(node, "name") and node.name else node_id
                )
                new_node_name = f"{original_name}_conc_{request.search_word}"

            # Wrap back as DocDataFrame if original was Doc*Frame and original doc column still present
            try:  # pragma: no cover (optional wrapping for client use)
                from docframe import DocDataFrame as _DDF  # type: ignore
                from docframe import DocLazyFrame as _DLF

                if isinstance(node.data, (_DDF, _DLF)):
                    doc_col = getattr(node.data, "document_column", None)
                    if doc_col and doc_col in final_data.columns:
                        _ = _DDF(
                            final_data, document_column=doc_col
                        )  # constructed for potential future use
            except Exception:
                pass

            data_for_node = final_data
            # If original was Doc type, wrap result as DocDataFrame preserving document column
            try:  # pragma: no cover (best-effort wrapping)
                from docframe import DocDataFrame as _DDF  # type: ignore
                from docframe import DocLazyFrame as _DLF  # type: ignore

                if isinstance(node.data, (_DDF, _DLF)):
                    doc_col = getattr(node.data, "document_column", None)
                    if doc_col and doc_col in final_data.columns:
                        data_for_node = _DDF(final_data, document_column=doc_col)
            except Exception:
                pass

            new_node = workspace_manager.add_node_to_workspace(
                user_id=user_id,
                workspace_id=workspace_id,
                data=data_for_node,
                node_name=new_node_name,
                operation="concordance_detach",
                parents=[node],
            )

            if not new_node:
                raise HTTPException(
                    status_code=500, detail="Failed to create detached concordance node"
                )

            total_rows = final_data.height if hasattr(final_data, "height") else -1

            return {
                "success": True,
                "message": f"Successfully created detached concordance node '{new_node_name}' with {total_rows if total_rows >= 0 else 'unknown'} rows",
                "new_node_id": new_node.id,
                "new_node_name": new_node_name,
                "total_rows": total_rows,
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


@router.get("/{workspace_id}/export")
async def export_nodes(
    workspace_id: str,
    node_ids: str,  # comma separated list
    format: str = "csv",
    current_user: dict = Depends(get_current_user),
):
    """Export one or more workspace nodes as downloadable file(s).

    If multiple node_ids are provided, a ZIP archive is returned.
    Supported formats (mapped to Polars write_* APIs): csv, json, parquet, ipc, ndjson.
    """
    import io
    import zipfile

    from fastapi import Response
    from fastapi.responses import StreamingResponse

    user_id = current_user["id"]
    fmt = format.lower()
    supported = {"csv", "json", "parquet", "ipc", "ndjson"}
    if fmt not in supported:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{format}'. Supported: {sorted(supported)}",
        )

    ids = [nid.strip() for nid in node_ids.split(",") if nid.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="No node_ids provided")

    # Helper to materialize node data as Polars DataFrame
    def node_to_df(node):
        data = getattr(node, "data", None)
        if data is None:
            return pl.DataFrame()
        try:
            if hasattr(data, "collect"):
                collected = data.collect()
            else:
                collected = data
        except Exception as e:  # pragma: no cover
            raise HTTPException(
                status_code=500, detail=f"Failed to materialize node data: {e}"
            )

        # If it's a docframe wrapper unwrap _df attribute
        if hasattr(collected, "_df"):
            try:
                collected = collected._df  # type: ignore[attr-defined]
            except Exception:
                pass
        if not isinstance(collected, pl.DataFrame):
            try:
                collected = pl.DataFrame(collected)
            except Exception:
                raise HTTPException(
                    status_code=500, detail="Could not convert node data to DataFrame"
                )
        return collected

    exported: list[tuple[str, bytes]] = []
    for nid in ids:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, nid)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node '{nid}' not found")
        df = node_to_df(node)
        buf = io.BytesIO()
        # Dispatch by format
        if fmt == "csv":
            df.write_csv(buf)
            ext = "csv"
        elif fmt == "json":
            # write_json writes entire df JSON lines by default; use to_json if available else manual
            try:
                df.write_json(buf)
            except Exception:
                buf.write(df.to_pandas().to_json().encode())  # fallback
            ext = "json"
        elif fmt == "parquet":
            df.write_parquet(buf)
            ext = "parquet"
        elif fmt == "ipc":
            df.write_ipc(buf)
            ext = "arrow"
        elif fmt == "ndjson":
            df.write_ndjson(buf)
            ext = "ndjson"
        else:  # pragma: no cover - already validated
            raise HTTPException(status_code=400, detail="Unsupported format")
        exported.append((f"{getattr(node, 'name', nid) or nid}.{ext}", buf.getvalue()))

    if len(exported) == 1:
        filename, data_bytes = exported[0]
        return Response(
            content=data_bytes,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    # Zip multiple
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname, data_bytes in exported:
            zf.writestr(fname, data_bytes)
    zip_buf.seek(0)
    return StreamingResponse(
        zip_buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=export_{workspace_id}.{fmt}.zip"
        },
    )
