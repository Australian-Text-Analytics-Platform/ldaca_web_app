"""Shared utility helpers for workspace API modules."""

import os
import re
from pathlib import Path
from typing import Any, Optional, Tuple

import polars as pl
from fastapi import HTTPException

from ...analysis.models import AnalysisStatus
from ...core.json_utils import json_sanitize  # type: ignore
from ...core.workspace import workspace_manager


async def ensure_task_synced(
    user_id: str,
    workspace_id: str,
    task_id: str,
    memory_task_manager,
):
    """Sync the in-memory task status with the backend worker task manager.

        If the in-memory task is 'running', this checks the worker
    status and updates the in-memory task if the worker has completed (success/fail).

        Used by:
        - analysis task-result endpoints that bridge memory store and worker store

        Why:
        - Keeps legacy in-memory task records consistent with worker completion.

        Refactor note:
        - Similar sync logic appears across analysis routes; extraction to a shared
            task-sync service could reduce endpoint duplication.
    """
    task = memory_task_manager.get_task(task_id)
    if not task:
        return None

    # Check against string or Enum to be safe
    is_running = task.status == "running" or task.status == AnalysisStatus.RUNNING

    if is_running:
        worker_tm = workspace_manager.get_task_manager(user_id, workspace_id)
        try:
            tm_task = await worker_tm.get_task(task.task_id)
            if tm_task:
                from ...analysis.results import GenericAnalysisResult

                if tm_task.status == "successful":
                    task.complete(GenericAnalysisResult(tm_task.result))
                    memory_task_manager.save_task(task)
                elif tm_task.status == "failed":
                    task.fail(tm_task.error or "Task failed")
                    memory_task_manager.save_task(task)
        except Exception:
            pass
    return task


def success(data=None, message: str = "ok", state: str = "successful", **extra):
    """Build a standardized success payload and sanitize JSON values.

    Used by:
    - workspace API handlers returning `{state,message,data}` contracts

    Why:
    - Prevents serialization drift and non-JSON-safe value leaks.
    """
    payload = {"state": state, "message": message, "data": data}
    if extra:
        payload.update(extra)
    return json_sanitize(payload)


def running(message: str = "running", metadata: Optional[dict] = None):
    """Shortcut for standardized in-progress response payloads.

    Used by:
    - task-producing endpoints that return pre-completion status

    Why:
    - Aligns `running` responses with the same schema as `success`.
    """
    return success(data=None, message=message, state="running", metadata=metadata or {})


def failed(message: str, error: Any = None, status_code: int = 400):
    """Raise a structured HTTP error payload.

    Used by:
    - workspace routes and helpers for uniform error surfaces

    Why:
    - Consolidates API error formatting in one helper.
    """
    detail = {"message": message}
    if error is not None:
        detail["error"] = str(error)
    raise HTTPException(status_code=status_code, detail=detail)


def stage_dataframe_as_lazy(
    data: pl.DataFrame,
    workspace_dir: Path,
    node_name: str,
    document_column: Optional[str] = None,
):
    """Persist a dataframe to parquet under the workspace and reload as LazyFrame.

    This mirrors the lazy serialize/reload pattern used by the base add-node endpoint
    so that detached/derived nodes remain portable and lazy by default.
    """

    data_dir = workspace_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    def _safe_stem(name: str) -> str:
        stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._") or "data"
        return stem

    base_stem = _safe_stem(node_name)
    parquet_path = data_dir / f"{base_stem}.parquet"
    suffix = 1
    while parquet_path.exists():
        parquet_path = data_dir / f"{base_stem}_{suffix}.parquet"
        suffix += 1

    if not isinstance(data, pl.DataFrame):
        raise HTTPException(
            status_code=400,
            detail=f"Expected Polars DataFrame for staging, got {type(data).__name__}",
        )
    df = data

    try:
        df.write_parquet(parquet_path)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to persist parquet for workspace: {exc}"
        )

    try:
        relative_path = parquet_path.relative_to(workspace_dir)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute relative parquet path: {exc}",
        )

    try:
        os.chdir(workspace_dir)
        lazy_data: Any = pl.scan_parquet(relative_path)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to reload parquet as LazyFrame: {exc}"
        )

    return lazy_data


def get_node_or_404(
    user_id: str, workspace_id: str, node_id: str, detail: Optional[str] = None
):
    """Fetch node from workspace or raise 404.

    Used by:
    - workspace node and analysis endpoints

    Why:
    - Avoids repeated existence checks in route handlers.
    """
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail=detail or "Node not found")
    return node


def get_node_with_data_or_400(
    user_id: str,
    workspace_id: str,
    node_id: str,
    not_found_detail: Optional[str] = None,
):
    """Fetch node and enforce presence of attached data.

    Used by:
    - data-transforming workspace endpoints

    Why:
    - Centralizes validation of required node payload before processing.
    """
    node = get_node_or_404(user_id, workspace_id, node_id, detail=not_found_detail)
    data = getattr(node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")
    return node, data


def get_workspace_or_404(
    user_id: str,
    workspace_id: str,
    detail: Optional[str] = None,
):
    """Fetch workspace or raise 404.

    Used by:
    - workspace-scoped endpoints before filesystem/data operations

    Why:
    - Removes repeated null checks around workspace retrieval.
    """
    workspace = workspace_manager.get_workspace(user_id, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail=detail or "Workspace not found")
    return workspace


def _handle_operation_result(result: Any) -> Tuple[bool, str, Any]:  # exported
    """Normalize operation return shape into `(success, message, object)`.

    Used by:
    - workspace node operation handlers

    Why:
    - Supports both tuple-style and object-only operation return conventions.
    """
    try:
        if isinstance(result, tuple) and len(result) == 3:
            return result  # (success, message, object)
        return True, "ok", result
    except Exception as e:  # pragma: no cover
        return False, f"Unexpected result format: {e}", None


__all__ = [
    "success",
    "running",
    "failed",
    "_handle_operation_result",
    "get_node_or_404",
    "get_node_with_data_or_400",
    "get_workspace_or_404",
    "stage_dataframe_as_lazy",
]
