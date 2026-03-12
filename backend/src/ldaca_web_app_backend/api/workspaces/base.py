"""
Refactored workspace API endpoints - thin HTTP layer over DocWorkspace.

These endpoints are now simple HTTP wrappers around DocWorkspace methods.
All business logic is handled by the DocWorkspace library itself.
"""

import logging
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

import polars as pl
from docworkspace import Node
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from ...core.auth import get_current_user

# Note: DocWorkspace API helpers are not used directly in this HTTP layer
from ...core.utils import get_user_data_folder, load_data_file
from ...core.workspace import workspace_manager
from .utils import stage_dataframe_as_lazy, update_workspace

# (No direct model imports needed after modularization)
# Removed unused concordance cache import (clearing handled in analyses module)

# Removed BaseModel import (no longer used after modularization of concordance)


# Router for workspace endpoints (was accidentally removed during edits)
router = APIRouter(prefix="/workspaces", tags=["workspace"])

logger = logging.getLogger(__name__)

EXPORT_FORMAT_SPECS: dict[str, dict[str, str | None]] = {
    "csv": {
        "extension": "csv",
        "media_type": "text/csv; charset=utf-8",
        "sink_method": "sink_csv",
    },
    "json": {
        "extension": "json",
        "media_type": "application/json",
        "sink_method": None,
    },
    "parquet": {
        "extension": "parquet",
        "media_type": "application/octet-stream",
        "sink_method": "sink_parquet",
    },
    "ipc": {
        "extension": "arrow",
        "media_type": "application/vnd.apache.arrow.file",
        "sink_method": "sink_ipc",
    },
    "ndjson": {
        "extension": "ndjson",
        "media_type": "application/x-ndjson",
        "sink_method": "sink_ndjson",
    },
}


def _stringify_value_for_csv(value: object) -> str | None:
    if isinstance(value, pl.Series):
        return str(value.to_list())
    return None if value is None else str(value)


def _stringify_lazyframe_for_csv(data: pl.LazyFrame) -> pl.LazyFrame:
    """Convert every column to string for CSV exports only."""
    return data.select(
        pl
        .col(column_name)
        .map_elements(_stringify_value_for_csv, return_dtype=pl.String)
        .alias(column_name)
        for column_name in data.collect_schema().names()
    )


def _sanitize_export_label(value: str | None, fallback: str) -> str:
    cleaned = "".join(
        "_" if (ord(ch) < 32 or ch in '<>:"/\\|?*') else ch
        for ch in (value or fallback).strip()
    ).strip()
    return cleaned or fallback


def _allocate_export_path(export_dir: Path, stem: str, extension: str) -> Path:
    candidate = export_dir / f"{stem}.{extension}"
    suffix = 1
    while candidate.exists():
        candidate = export_dir / f"{stem}_{suffix}.{extension}"
        suffix += 1
    return candidate


def _export_node_artifact(
    node: Node,
    node_id: str,
    export_dir: Path,
    fmt: str,
) -> tuple[str, Path]:
    data = getattr(node, "data", None)
    if data is None:
        raise HTTPException(
            status_code=400, detail=f"Node '{node_id}' has no data to export"
        )
    if not isinstance(data, pl.LazyFrame):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Export requires LazyFrame node data for node '{node_id}', "
                f"got {type(data).__name__}"
            ),
        )

    spec = EXPORT_FORMAT_SPECS[fmt]
    stem = _sanitize_export_label(getattr(node, "name", None), node_id)
    archive_name = f"{stem}.{spec['extension']}"
    output_path = _allocate_export_path(export_dir, stem, str(spec["extension"]))
    export_data = _stringify_lazyframe_for_csv(data) if fmt == "csv" else data

    try:
        sink_method_name = spec["sink_method"]
        if sink_method_name is not None:
            sink_method = getattr(export_data, sink_method_name, None)
            if sink_method is None:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        f"LazyFrame export method '{sink_method_name}' is not "
                        f"available for format '{fmt}'"
                    ),
                )
            sink_method(output_path)
        else:
            # Polars does not currently expose LazyFrame.sink_json, so JSON
            # remains the single explicit eager export path.
            export_data.collect().write_json(output_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to export node '{node_id}' as {fmt}: {exc}",
        ) from exc

    return archive_name, output_path


@router.delete("/nodes/{node_id}/columns/{column_name}")
async def delete_node_column(
    node_id: str,
    column_name: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a column from a node by delegating to DocWorkspace Node.drop."""

    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    node = ws.nodes.get(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    try:
        dropped_node = node.drop(column_name)
        try:
            update_workspace(user_id, workspace_id, best_effort=True)
        except Exception as exc:
            logger.debug(
                "Best-effort workspace update failed after drop on node %s: %s",
                node_id,
                exc,
            )
        return dropped_node.info()
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete column '{column_name}': {exc}",
        ) from exc


@router.put("/nodes/{node_id}/columns/{column_name}")
async def rename_node_column(
    node_id: str,
    column_name: str,
    payload: dict = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """Rename a column by delegating to DocWorkspace Node.rename."""

    user_id = current_user["id"]
    new_name = payload.get("new_name") if isinstance(payload, dict) else None
    if not isinstance(new_name, str):
        raise HTTPException(
            status_code=400,
            detail="Request body must include a 'new_name' string field.",
        )

    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    node = ws.nodes.get(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    trimmed_name = new_name.strip()

    try:
        node.rename({column_name: trimmed_name})
        try:
            update_workspace(user_id, workspace_id, best_effort=True)
        except Exception as exc:
            logger.debug(
                "Best-effort workspace update failed after rename on node %s: %s",
                node_id,
                exc,
            )
        return node.info()
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to rename column '{column_name}': {exc}",
        ) from exc


@router.post("/nodes/{node_id}/undo")
async def undo_node_operation(
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Undo the latest in-memory execution plan change for a node."""

    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    node = ws.nodes.get(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    try:
        node.undo()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to undo node '{node_id}': {exc}",
        ) from exc

    try:
        update_workspace(user_id, workspace_id, best_effort=True)
    except Exception as exc:
        logger.debug(
            "Best-effort workspace update failed after undo on node %s: %s",
            node_id,
            exc,
        )

    return node.info()


@router.post("/nodes/{node_id}/redo")
async def redo_node_operation(
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Redo the latest undone in-memory execution plan change for a node."""

    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    node = ws.nodes.get(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    try:
        node.redo()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to redo node '{node_id}': {exc}",
        ) from exc

    try:
        update_workspace(user_id, workspace_id, best_effort=True)
    except Exception as exc:
        logger.debug(
            "Best-effort workspace update failed after redo on node %s: %s",
            node_id,
            exc,
        )

    return node.info()


# -----------------------------------------------------------------------------
# Configure Numba threading layer with automatic TBB detection and fallback
# -----------------------------------------------------------------------------
def _configure_numba_threading():
    """Configure process-wide Numba threading defaults with safe fallbacks.

    Used by:
    - module import side effect in `base.py`

    Why:
    - Reduces runtime instability from incompatible threading backends.

    Refactor note:
    - Duplicates intent of `api.workspaces.utils.configure_numba_threading`; these
        should converge to one shared helper.
    """
    try:
        import importlib

        # Presence in THREADING_LAYER_PRIORITY is only a preference list, not
        # evidence that the TBB runtime is installed/usable.
        numba_available = bool(importlib.util.find_spec("numba"))
        tbb_available = False
        tbb_import_error: Exception | None = None

        if numba_available:
            try:
                if importlib.util.find_spec("tbb"):
                    importlib.import_module("tbb")
                    tbb_available = True
                elif importlib.util.find_spec("tbb4py"):
                    importlib.import_module("tbb4py")
                    tbb_available = True
            except Exception as exc:  # pragma: no cover - environment dependent
                tbb_import_error = exc
                tbb_available = False

        if numba_available and tbb_available:
            # Use TBB if available (thread-safe for concurrent access)
            os.environ.setdefault("NUMBA_THREADING_LAYER_PRIORITY", "tbb workqueue omp")
            os.environ.setdefault("NUMBA_THREADING_LAYER", "tbb")
            # Don't set NUMBA_NUM_THREADS when using TBB - let TBB manage threading
            # Also prevent conflicts by not overriding if already set
            if "NUMBA_NUM_THREADS" not in os.environ:
                # TBB will manage its own threads
                pass
            print(
                "INFO: Numba: Using TBB threading layer (thread-safe, TBB-managed threads)"
            )
        else:
            # Fall back to workqueue with single thread for safety
            os.environ.setdefault("NUMBA_THREADING_LAYER", "workqueue")
            os.environ.setdefault("NUMBA_THREADING_LAYER_PRIORITY", "workqueue omp tbb")
            # Only set num threads if not already set to avoid conflicts
            if "NUMBA_NUM_THREADS" not in os.environ:
                os.environ["NUMBA_NUM_THREADS"] = "1"
            if not numba_available:
                print(
                    "INFO: Numba: numba not detected; using workqueue defaults for safety"
                )
            elif tbb_import_error is not None:
                print(
                    f"INFO: Numba: TBB detected but not importable ({tbb_import_error}); using workqueue fallback"
                )
            else:
                print(
                    "INFO: Numba: TBB not installed; using workqueue threading layer (single-threaded fallback)"
                )

    except Exception as e:
        # Final fallback - basic workqueue setup
        os.environ.setdefault("NUMBA_THREADING_LAYER", "workqueue")
        os.environ.setdefault("NUMBA_THREADING_LAYER_PRIORITY", "workqueue omp tbb")
        os.environ.setdefault("NUMBA_NUM_THREADS", "1")
        print(f"WARNING: Numba: Threading configuration warning: {e}")


# Apply the configuration
_configure_numba_threading()


## Concordance cache helpers removed (moved to analyses.concordance)


# ============================================================================
# TOPIC MODELING ENDPOINT
# ============================================================================


## Task management endpoints moved to tasks.py


## Topic modeling endpoints moved to analyses/topic_modeling.py


## Lifecycle endpoints moved to lifecycle.py


@router.post("/nodes")
async def add_node_to_workspace(
    filename: str,
    sheet_name: Optional[str] = Query(
        None,
        description="Optional Excel sheet name to load when the source file is a workbook.",
    ),
    mode: str = Query(
        "LazyFrame",
        description=(
            "How to treat the file: currently only 'LazyFrame' is supported; files are staged as parquet and reloaded lazily."
        ),
    ),
    current_user: dict = Depends(get_current_user),
):
    """Add a data file as a new node to workspace.

    Files are eagerly loaded into a Polars DataFrame, persisted as parquet under the workspace's `data/` folder,
    and then reloaded as a LazyFrame. This separates bulk data from `metadata.json` while keeping
    lazy processing semantics.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        # Load data file
        user_data_folder = get_user_data_folder(user_id)
        file_path = user_data_folder / filename

        if not file_path.exists():
            raise HTTPException(
                status_code=400, detail=f"Data file not found: {filename}"
            )

        # Load the data
        data = load_data_file(file_path, sheet_name=sheet_name)

        # Validate requested mode (lazy-only workflow)
        valid_modes = {"LazyFrame"}
        if mode not in valid_modes:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid mode '{mode}'. Expected one of {sorted(list(valid_modes))}",
            )

        # Normalize to an eager Polars DataFrame
        try:
            if isinstance(data, pl.LazyFrame):
                data = data.collect()
            elif not isinstance(data, pl.DataFrame):
                raise TypeError(
                    f"Expected Polars DataFrame/LazyFrame from loader, got {type(data).__name__}"
                )
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to coerce data to Polars DataFrame: {exc}",
            )

        # Resolve workspace folder and stage parquet copy
        workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
        if workspace_dir is None:
            raise HTTPException(
                status_code=404,
                detail=f"Workspace folder not found for workspace {workspace_id}",
            )

        node_name = filename
        for ext in [
            ".csv",
            ".tsv",
            ".xlsx",
            ".json",
            ".jsonl",
            ".parquet",
        ]:
            if node_name.endswith(ext):
                node_name = node_name[: -len(ext)]
                break

        lazy_data = stage_dataframe_as_lazy(
            data,
            workspace_dir,
            node_name=node_name,
            document_column=None,
        )

        if workspace_manager.get_current_workspace_id(user_id) != workspace_id:
            if not workspace_manager.set_current_workspace(user_id, workspace_id):
                raise HTTPException(status_code=404, detail="Workspace not found")
        workspace = workspace_manager.get_current_workspace(user_id)
        if workspace is None:
            raise HTTPException(status_code=404, detail="Workspace not found")

        node = Node(
            data=lazy_data,
            name=node_name,
            workspace=workspace,
            operation="manual_add",
        )
        workspace.add_node(node)
        update_workspace(user_id, workspace_id, workspace)

        # Return node info
        return node.info()

    except HTTPException:
        # Re-raise HTTPExceptions as-is
        raise
    except Exception as e:
        # Log and convert unexpected errors to 500
        import traceback

        print(f"ERROR: Add node error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error adding node: {str(e)}"
        )


# ============================================================================
# NODE OPERATIONS - Thin wrappers around DocWorkspace methods
# ============================================================================


# ============================================================================
# FILE OPERATIONS - Upload and create nodes
# ============================================================================


## Upload endpoint moved to files.py


# ============================================================================
# DATA OPERATIONS - Using DocWorkspace safe_operation wrapper
# ============================================================================


# ============================================================================
# TEXT ANALYSIS - Using polars-text integration
# ============================================================================


## Generic analysis clear endpoint removed (functionality moved to specific analysis endpoints and analysis_admin helpers)


## Concordance detail endpoint moved to analyses/concordance.py


@router.post("/nodes/{node_id}/cast")
async def cast_node(
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
            - target_type: str - target data type (e.g., "integer", "float", "string", "datetime", "boolean", "categorical")
            - format: str (optional) - datetime format string for string to datetime conversion
            Example: {"column": "date_col", "target_type": "datetime", "format": "%Y-%m-%d"}

    Returns:
        Dictionary with the updated node information after casting
    """
    try:
        user_id = current_user["id"]
        workspace_id = workspace_manager.get_current_workspace_id(user_id)
        ws = workspace_manager.get_current_workspace(user_id)
        if not workspace_id or ws is None:
            raise HTTPException(status_code=404, detail="No active workspace selected")

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

        # Get node using shared helper (guarantees data presence)
        node = ws.nodes[node_id]
        current_df = node.data

        if isinstance(current_df, pl.LazyFrame):
            lazyframe = current_df
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Node data must be lazy (LazyFrame). "
                    "Workspaces no longer support eager node payloads."
                ),
            )

        schema = lazyframe.collect_schema()
        columns = list(schema.keys())
        if column_name not in columns:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Column '{column_name}' not found in data. "
                    f"Available columns: {columns}"
                ),
            )

        original_dtype = schema[column_name]
        original_type = str(original_dtype)

        # Determine operation based on target type
        target_lower = target_type.lower()
        orig_lower = (original_type or "").lower()

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

                    # Ensure timezone-aware UTC.
                    # If the format includes a timezone specifier (%z, %:z, %#z),
                    # str.to_datetime already returns a tz-aware Datetime and
                    # replace_time_zone would fail.  In that case we only need
                    # convert_time_zone.  For naive results we set the timezone.
                    _tz_tokens = ("%z", "%:z", "%#z")
                    _format_has_tz = datetime_format and any(
                        tok in datetime_format for tok in _tz_tokens
                    )
                    if _format_has_tz:
                        cast_expr = parsed.dt.convert_time_zone("UTC").alias(
                            column_name
                        )
                    else:
                        cast_expr = parsed.dt.replace_time_zone("UTC").alias(
                            column_name
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
                col_dtype = original_type

                if str(col_dtype).startswith("Datetime"):
                    if datetime_format:
                        # Use chrono-compatible formatting tokens
                        cast_expr = (
                            pl
                            .col(column_name)
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
                if "float" in orig_lower:
                    # Truncate decimals by casting directly (Polars truncates toward zero)
                    cast_expr = (
                        col_expr
                        .cast(pl.Float64, strict=False)
                        .cast(pl.Int64, strict=False)
                        .alias(column_name)
                    )
                elif any(tok in orig_lower for tok in ["utf8", "string", "str"]):
                    # Attempt float parse (lenient) then truncate by casting to int
                    cast_expr = (
                        col_expr
                        .cast(pl.Float64, strict=False)
                        .cast(pl.Int64, strict=False)
                        .alias(column_name)
                    )
                else:
                    cast_expr = col_expr.cast(pl.Int64, strict=False).alias(column_name)
            elif target_lower == "float":
                # String -> number (float) conversion
                cast_expr = pl.col(column_name).cast(pl.Float64).alias(column_name)
            elif target_lower == "categorical":
                col_expr = pl.col(column_name)
                if any(
                    tok in orig_lower
                    for tok in ["utf8", "string", "str", "categorical"]
                ):
                    cast_expr = col_expr.cast(pl.Categorical, strict=False).alias(
                        column_name
                    )
                else:
                    cast_expr = (
                        col_expr
                        .cast(pl.Utf8, strict=False)
                        .cast(pl.Categorical, strict=False)
                        .alias(column_name)
                    )
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Casting to '{target_type}' is not yet supported. Supported: string, integer, float, datetime, categorical.",
                )

            # Perform a small head() sample validation to surface conversion errors early
            try:
                sample_plan = lazyframe.head(50).with_columns(cast_expr)
                sample_plan.collect()
            except Exception as sample_err:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Sample validation failed when casting column '{column_name}' to {target_type}: {sample_err}"
                    ),
                )

            # Apply the casting with .with_columns(); preserve original frame type after validation
            casted_lazy = lazyframe.with_columns(cast_expr)
            node.data = casted_lazy

            # Save workspace to disk
            # Ensure current workspace is persisted after casting
            update_workspace(user_id, workspace_id)
            # Get new data type for response
            new_schema = casted_lazy.collect_schema()
            new_type = str(new_schema[column_name])
            return {
                "state": "successful",
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


@router.get("/export")
async def export_nodes(
    node_ids: str,  # comma separated list
    format: str = "csv",
    current_user: dict = Depends(get_current_user),
):
    """Export one or more workspace nodes as downloadable file(s).

    If multiple node_ids are provided, a ZIP archive is returned.
    Supported formats: csv, json, parquet, ipc, ndjson.
    """
    import io
    import zipfile

    from fastapi import Response
    from fastapi.responses import StreamingResponse

    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    fmt = format.lower()
    spec = EXPORT_FORMAT_SPECS.get(fmt)
    if spec is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported format '{format}'. Supported: "
                f"{sorted(EXPORT_FORMAT_SPECS)}"
            ),
        )

    ids = [nid.strip() for nid in node_ids.split(",") if nid.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="No node_ids provided")

    def build_timestamp_fragment() -> str:
        now = datetime.now()
        return (
            f"{now.month:02d}-{now.day:02d}_"
            f"{now.hour:02d}-{now.minute:02d}-{now.second:02d}"
        )

    with tempfile.TemporaryDirectory(prefix=f"workspace_export_{workspace_id}_") as temp_dir:
        export_dir = Path(temp_dir)
        exported: list[tuple[str, Path]] = []

        for nid in ids:
            node = ws.nodes.get(nid)
            if node is None:
                raise HTTPException(status_code=404, detail=f"Node '{nid}' not found")
            exported.append(
                _export_node_artifact(
                    node=node,
                    node_id=nid,
                    export_dir=export_dir,
                    fmt=fmt,
                )
            )

        if len(exported) == 1:
            filename, artifact_path = exported[0]
            return Response(
                content=artifact_path.read_bytes(),
                media_type=str(spec["media_type"]),
                headers={"Content-Disposition": f"attachment; filename={filename}"},
            )

        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for archive_name, artifact_path in exported:
                zf.write(artifact_path, arcname=archive_name)
        zip_buf.seek(0)
        return StreamingResponse(
            zip_buf,
            media_type="application/zip",
            headers={
                "Content-Disposition": (
                    f"attachment; filename={build_timestamp_fragment()}_"
                    f"{_sanitize_export_label(getattr(ws, 'name', None), workspace_id)}.zip"
                )
            },
        )


# ============================================================================
# ANALYSIS CURRENT REQUEST/RESULT (generic)
# ============================================================================


# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
# ============================================================================
