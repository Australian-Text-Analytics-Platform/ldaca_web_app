"""Shared utility helpers for workspace API modules."""

import logging
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import polars as pl
from fastapi import HTTPException

from ...analysis.models import AnalysisStatus
from ...core.workspace import workspace_manager

logger = logging.getLogger(__name__)


def _safe_workspace_data_stem(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._") or "data"


def _allocate_workspace_data_path(
    workspace_dir: Path, *, stem: str, suffix: str = ".parquet"
) -> Path:
    data_dir = workspace_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    candidate = data_dir / f"{stem}{suffix}"
    suffix_index = 1
    while candidate.exists():
        candidate = data_dir / f"{stem}_{suffix_index}{suffix}"
        suffix_index += 1
    return candidate


def _scan_workspace_parquet(parquet_path: Path, workspace_dir: Path):
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


def update_workspace(
    user_id: str,
    workspace_id: str,
    workspace: Any | None = None,
    *,
    best_effort: bool = False,
) -> Path | None:
    """Persist workspace metadata/path updates through one shared code path.

    Used by:
    - workspace lifecycle, node, and analysis endpoints after mutations

    Why:
    - Removes repeated save/update boilerplate from route handlers.
    """
    try:
        if workspace is None:
            current_workspace_id = workspace_manager.get_current_workspace_id(user_id)
            if current_workspace_id != workspace_id:
                if not workspace_manager.set_current_workspace(user_id, workspace_id):
                    return None
            workspace = workspace_manager.get_current_workspace(user_id)

        if workspace is None:
            return None

        workspace.modified_at = datetime.now().isoformat()
        target_dir = workspace_manager._resolve_workspace_dir(
            user_id=user_id,
            workspace_id=workspace_id,
            workspace_name=workspace.name,
        )
        workspace_manager._attach_workspace_dir(workspace, target_dir)
        workspace.save(target_dir)
        workspace_manager._set_cached_path(user_id, workspace_id, target_dir)
        return target_dir
    except Exception:
        if best_effort:
            return None
        raise


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
        - Keeps in-memory task records consistent with worker completion.

        Refactor note:
        - Similar sync logic appears across analysis routes; extraction to a shared
            task-sync service could reduce endpoint duplication.
    """
    task = memory_task_manager.get_task(task_id)
    if not task:
        return None

    # Check against string or Enum to be safe.
    # Pending tasks can already exist in analysis storage while the worker task
    # is actively running, so both states should be sync-eligible.
    is_running = task.status in {
        "running",
        "pending",
        AnalysisStatus.RUNNING,
        AnalysisStatus.PENDING,
    }

    if is_running:
        worker_tm = workspace_manager.get_task_manager(user_id)
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
        except Exception as exc:
            logger.debug(
                "Failed to sync task %s from worker manager: %s",
                task.task_id,
                exc,
            )
    return task


def success(data=None, message: str = "ok", state: str = "successful", **extra):
    """Build a standardized success payload.

    Used by:
    - workspace API handlers returning `{state,message,data}` contracts

    Why:
    - Keeps response assembly lightweight; serialization is handled by FastAPI.
    """
    payload = {"state": state, "message": message, "data": data}
    if extra:
        payload.update(extra)
    return payload


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
    parquet_path = _allocate_workspace_data_path(
        workspace_dir,
        stem=_safe_workspace_data_stem(node_name),
    )

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

    return _scan_workspace_parquet(parquet_path, workspace_dir)


def stage_parquet_artifact_as_lazy(
    artifact_path: str | Path,
    workspace_dir: Path,
    node_name: str,
) -> tuple[Any, Path]:
    """Copy a temporary parquet artifact into workspace data and reload lazily.

    Background workers write ephemeral parquet artifacts under `data/artifacts`.
    Before attaching a derived node to the workspace, the main process must copy
    that parquet into durable workspace storage so the node survives artifact
    cleanup on unload.
    """

    source_path = Path(artifact_path)
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"Artifact parquet not found: {source_path}",
        )

    persisted_path = _allocate_workspace_data_path(
        workspace_dir,
        stem=_safe_workspace_data_stem(node_name or source_path.stem),
    )

    try:
        shutil.copy2(source_path, persisted_path)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to copy artifact parquet into workspace data: {exc}",
        )

    return _scan_workspace_parquet(persisted_path, workspace_dir), persisted_path


__all__ = [
    "success",
    "running",
    "failed",
    "update_workspace",
    "stage_dataframe_as_lazy",
    "stage_parquet_artifact_as_lazy",
]
