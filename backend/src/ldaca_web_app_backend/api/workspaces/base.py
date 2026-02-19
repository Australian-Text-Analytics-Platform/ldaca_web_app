"""
Refactored workspace API endpoints - thin HTTP layer over DocWorkspace.

These endpoints are now simple HTTP wrappers around DocWorkspace methods.
All business logic is handled by the DocWorkspace library itself.
"""

import logging
import os
from typing import cast

import polars as pl
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from ...core.auth import get_current_user

# Note: DocWorkspace API helpers are not used directly in this HTTP layer
from ...core.utils import get_user_data_folder, load_data_file
from ...core.workspace import workspace_manager
from ...core.workspace_node_data_ops import NodeDataError, drop_column, rename_column
from .utils import get_node_or_404, get_node_with_data_or_400, stage_dataframe_as_lazy

# json_sanitize no longer needed directly in this module

# (No direct model imports needed after modularization)
# Removed unused concordance cache import (clearing handled in analyses module)

# Removed BaseModel import (no longer used after modularization of concordance)


# Router for workspace endpoints (was accidentally removed during edits)
router = APIRouter(prefix="/workspaces", tags=["workspace"])

logger = logging.getLogger(__name__)


@router.delete("/{workspace_id}/nodes/{node_id}/columns/{column_name}")
async def delete_node_column(
    workspace_id: str,
    node_id: str,
    column_name: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a column from a node's data (in-place)."""

    user_id = current_user["id"]
    node, data = get_node_with_data_or_400(user_id, workspace_id, node_id)

    try:
        node.data = drop_column(data, column_name)  # type: ignore[assignment]
        try:
            node.operation += f"\ndrop_column({column_name})"
        except Exception:  # pragma: no cover - non-critical history update
            pass
        workspace_manager.persist(user_id, workspace_id)
        return node.info()
    except NodeDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete column '{column_name}': {exc}",
        ) from exc


@router.put("/{workspace_id}/nodes/{node_id}/columns/{column_name}")
async def rename_node_column(
    workspace_id: str,
    node_id: str,
    column_name: str,
    payload: dict = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """Rename a column within a node's data (in-place)."""

    user_id = current_user["id"]
    new_name = payload.get("new_name") if isinstance(payload, dict) else None
    if not isinstance(new_name, str):
        raise HTTPException(
            status_code=400,
            detail="Request body must include a 'new_name' string field.",
        )

    node, data = get_node_with_data_or_400(user_id, workspace_id, node_id)

    trimmed_name = new_name.strip()

    try:
        node.data = rename_column(data, column_name, trimmed_name)  # type: ignore[assignment]
        if trimmed_name != column_name:
            try:
                node.operation += f"\nrename_column({column_name}->{trimmed_name})"
            except Exception:  # pragma: no cover
                pass
        workspace_manager.persist(user_id, workspace_id)
        return node.info()
    except NodeDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to rename column '{column_name}': {exc}",
        ) from exc


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
        # Check if TBB is available to Numba
        tbb_available = False
        try:
            import importlib

            numba_spec = importlib.util.find_spec("numba")
            if not numba_spec:
                raise ImportError
            importlib.import_module("numba")  # type: ignore
            from numba import config  # type: ignore  # noqa: F401

            # Check if TBB is in Numba's available threading layers
            available_layers = getattr(config, "THREADING_LAYER_PRIORITY", [])
            if isinstance(available_layers, (list, tuple)):
                tbb_available = "tbb" in available_layers
            elif isinstance(available_layers, str):
                tbb_available = "tbb" in available_layers

            # Also try importing TBB directly as a secondary check
            if not tbb_available:
                # Detect TBB without importing if possible
                tbb_spec = importlib.util.find_spec("tbb")
                if tbb_spec:
                    tbb_available = True

        except ImportError, AttributeError:
            # Numba not available, fall back to safe mode
            pass

        if tbb_available:
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
            print(
                "INFO: Numba: Using workqueue threading layer (single-threaded for safety)"
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


## Concordance cache helpers moved; _handle_operation_result now imported from utils


## Lifecycle endpoints moved to lifecycle.py


@router.post("/{workspace_id}/nodes")
async def add_node_to_workspace(
    workspace_id: str,
    filename: str,
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

        # Validate requested mode (lazy-only workflow)
        valid_modes = {"LazyFrame"}
        if mode not in valid_modes:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid mode '{mode}'. Expected one of {sorted(list(valid_modes))}",
            )

        # Normalize to an eager Polars DataFrame
        # LazyFrame-only migration note:
        # The branches below support legacy mixed payload types (wrapper,
        # pandas-like, generic mapping/list). Remove once upload/create inputs
        # are validated to strict LazyFrame/Polars-only contracts.
        try:
            if isinstance(data, pl.LazyFrame):
                data = data.collect()
            elif hasattr(data, "dataframe"):
                data = pl.DataFrame(getattr(data, "dataframe"))  # type: ignore[arg-type]
            elif hasattr(data, "iloc"):
                data = pl.DataFrame(data)  # pandas -> polars
            elif not isinstance(data, pl.DataFrame):
                data = pl.DataFrame(data)
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

        # Create node name from filename
        node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=cast(pl.DataFrame | pl.LazyFrame, lazy_data),
            node_name=node_name,
        )

        if not node:
            raise HTTPException(
                status_code=500, detail="Failed to add node to workspace"
            )

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
            - target_type: str - target data type (e.g., "integer", "float", "string", "datetime", "boolean", "categorical")
            - format: str (optional) - datetime format string for string to datetime conversion
            Example: {"column": "date_col", "target_type": "datetime", "format": "%Y-%m-%d"}

    Returns:
        Dictionary with the updated node information after casting
    """
    try:
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

        # Get node using shared helper (guarantees data presence)
        node, current_df = get_node_with_data_or_400(user_id, workspace_id, node_id)

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

        if column_name not in columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column_name}' not found in data. Available columns: {columns}",
            )

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

                    # Ensure timezone-aware UTC. Polars returns naive datetimes by default.
                    # If the parsed result is already timezone aware we convert to UTC, otherwise we set it.
                    # We can't inspect the expression's dtype pre-execution, so we defensively apply replace_time_zone then convert.
                    cast_expr = (
                        parsed.dt
                        .replace_time_zone("UTC")
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
            workspace_manager.persist(user_id, workspace_id)
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
    # LazyFrame-only migration note:
    # This helper intentionally keeps eager/wrapper compatibility fallbacks.
    # After full LazyFrame-only rollout, simplify to strict
    # `node.data.collect()` plus hard type assertions.
    def node_to_df(node):
        data = getattr(node, "data", None)
        if data is None:
            return pl.DataFrame()
        try:
            if hasattr(data, "collect"):
                collected = data.collect()
            else:
                # Legacy eager fallback; removable under strict LazyFrame contract.
                collected = data
        except Exception as e:  # pragma: no cover
            raise HTTPException(
                status_code=500, detail=f"Failed to materialize node data: {e}"
            )

        # Unwrap custom wrappers if needed
        if hasattr(collected, "_df") and not isinstance(collected, pl.DataFrame):
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
        node = get_node_or_404(
            user_id, workspace_id, nid, detail=f"Node '{nid}' not found"
        )
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
