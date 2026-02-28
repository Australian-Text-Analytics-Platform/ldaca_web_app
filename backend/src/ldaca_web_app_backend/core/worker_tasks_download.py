"""Workspace download (ZIP packaging) worker task implementation."""

from __future__ import annotations

import os
import re
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, Optional


def _safe_download_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return cleaned or "workspace"


def run_workspace_download_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    target_workspace_dir: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Package a persisted workspace folder into a ZIP artifact.

    Used by:
    - ``TASK_REGISTRY["workspace_download"]`` via ``WorkerTaskManager.submit_task``

    Why:
    - Moves potentially slow ZIP compression off the request thread so the UI
      can track progress through the Task Center.
    """
    configure_worker_environment()

    try:
        from ldaca_web_app_backend.core.utils import get_user_data_folder

        print(
            f"[Worker {os.getpid()}] Starting workspace download task "
            f"for user {user_id}, workspace {workspace_id}"
        )

        if progress_callback:
            progress_callback(0.1, "Locating workspace...")

        user_data = get_user_data_folder(user_id)

        # Prefer exact directory passed from API layer to avoid brittle name heuristics.
        workspace_dir: Optional[Path] = None
        if target_workspace_dir:
            candidate = Path(target_workspace_dir)
            if candidate.exists() and candidate.is_dir():
                workspace_dir = candidate

        if workspace_dir is None or not workspace_dir.exists():
            raise FileNotFoundError(f"Workspace directory not found for {workspace_id}")

        if progress_callback:
            progress_callback(0.2, "Preparing ZIP archive...")

        # Derive a human-friendly filename from the directory name
        dir_name = workspace_dir.name
        # Strip workspace-id prefix to get the human name part
        if dir_name.startswith(workspace_id):
            human_part = dir_name[len(workspace_id) :].lstrip("_- ")
            suggested_name = (
                _safe_download_name(human_part) if human_part else workspace_id
            )
        else:
            suggested_name = _safe_download_name(dir_name)

        filename = f"{suggested_name}.zip"

        # Create artifact in a dedicated temp area
        artifact_dir = user_data / ".task-artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)

        # Use a unique temp file that won't collide
        fd, artifact_path_str = tempfile.mkstemp(
            suffix=".zip", prefix=f"ws_download_{workspace_id}_", dir=str(artifact_dir)
        )
        os.close(fd)
        artifact_path = Path(artifact_path_str)

        if progress_callback:
            progress_callback(0.3, "Compressing workspace files...")

        all_files = [p for p in workspace_dir.rglob("*") if p.is_file()]
        total = len(all_files)

        with zipfile.ZipFile(
            artifact_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as zf:
            for idx, file_path in enumerate(all_files):
                arcname = file_path.relative_to(workspace_dir).as_posix()
                zf.write(file_path, arcname=arcname)
                if progress_callback and total > 0:
                    pct = 0.3 + 0.6 * ((idx + 1) / total)
                    progress_callback(pct, f"Compressing ({idx + 1}/{total})...")

        if progress_callback:
            progress_callback(1.0, "ZIP archive ready for download")

        print(
            f"[Worker {os.getpid()}] Workspace download task completed: {artifact_path}"
        )

        return {
            "success": True,
            "artifact_path": str(artifact_path),
            "filename": filename,
            "size": artifact_path.stat().st_size,
            "message": f"Workspace packaged as {filename}",
        }

    except Exception as e:
        print(f"[Worker {os.getpid()}] Workspace download task failed: {e}")
        if progress_callback:
            progress_callback(-1, f"Failed: {e}")
        raise
