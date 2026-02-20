"""Workspace lifecycle endpoints for workspace create/load/save/import flows."""

import io
import json
import re
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Optional

from docworkspace import Workspace
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from ...core.auth import get_current_user
from ...core.utils import generate_workspace_id, validate_workspace_name
from ...core.workspace import workspace_manager
from ...models import WorkspaceCreateRequest, WorkspaceInfo
from ..files import USER_TASK_SCOPE
from .analyses.token_frequencies import (
    _unwrap_task_manager_result as unwrap_task_manager_result,
)

router = APIRouter(prefix="/workspaces", tags=["lifecycle"])


def _safe_download_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return cleaned or "workspace"


def _safe_member_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise HTTPException(status_code=400, detail="Invalid zip entry path")
    if any(part in {"", "."} for part in path.parts):
        raise HTTPException(status_code=400, detail="Invalid zip entry path")
    return path


def _persist_workspace(user_id: str, workspace_id: str, workspace: Workspace) -> Path:
    workspace.set_metadata("modified_at", datetime.now().isoformat())
    target_dir = workspace_manager._resolve_workspace_dir(
        user_id=user_id,
        workspace_id=workspace_id,
        workspace_name=workspace.name,
    )
    workspace_manager._attach_workspace_dir(workspace, target_dir)
    workspace.save(target_dir)
    workspace_manager._set_cached_path(user_id, workspace_id, target_dir)
    return target_dir


@router.get("/")
async def list_workspaces(current_user: dict = Depends(get_current_user)):
    """List all persisted workspaces visible to the current user.

    Used by:
    - frontend workspace switcher/landing views

    Why:
    - Provides fast summary metadata without loading full workspace graphs.
    """
    user_id = current_user["id"]
    summaries = workspace_manager.list_user_workspaces_summaries(user_id)
    return {"workspaces": list(summaries.values())}


@router.get("/current")
async def get_current_workspace(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    current_workspace_id = workspace_manager.get_current_workspace_id(user_id)
    return {"current_workspace_id": current_workspace_id}


@router.post("/current")
async def set_current_workspace(
    workspace_id: Optional[str] = None, current_user: dict = Depends(get_current_user)
):
    """Set or clear the current in-memory workspace for the user.

    Used by:
    - frontend workspace selection flow

    Why:
    - Ensures subsequent node/analysis operations target the intended workspace.
    """
    user_id = current_user["id"]
    success = workspace_manager.set_current_workspace(user_id, workspace_id)
    if not success and workspace_id is not None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"state": "successful", "current_workspace_id": workspace_id}


@router.post("/", response_model=WorkspaceInfo)
async def create_workspace(
    request: WorkspaceCreateRequest, current_user: dict = Depends(get_current_user)
):
    """Create a workspace and return normalized workspace metadata.

    Used by:
    - frontend new-workspace dialog

    Why:
    - Centralizes workspace-name validation and initialization metadata.
    """
    user_id = current_user["id"]
    is_valid, reason = validate_workspace_name(request.name)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid workspace name: {reason}")
    try:
        workspace = Workspace(name=request.name)
        workspace_id = generate_workspace_id()
        workspace.id = workspace_id
        now = datetime.now().isoformat()
        workspace.set_metadata("description", request.description or "")
        workspace.set_metadata("created_at", now)
        workspace.set_metadata("modified_at", now)

        _persist_workspace(user_id, workspace_id, workspace)
        workspace_manager.set_current_workspace(user_id, workspace_id)

        workspace_info = workspace_manager.get_workspace_info(user_id, workspace_id)
        if not workspace_info:
            raise HTTPException(status_code=500, detail="Failed to get workspace info")
        return WorkspaceInfo(
            workspace_id=workspace_id,
            name=workspace_info["name"],
            description=workspace_info.get("description", ""),
            created_at=workspace_info.get("created_at", ""),
            modified_at=workspace_info.get("modified_at", ""),
            total_nodes=workspace_info.get("total_nodes", 0),
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"ERROR: Workspace creation error: {e}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error during workspace creation: {e}",
        )


@router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    success = workspace_manager.delete_workspace(user_id, workspace_id)
    if not success:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {
        "state": "successful",
        "message": f"Workspace {workspace_id} deleted successfully",
    }


@router.post("/{workspace_id}/unload")
async def unload_workspace(
    workspace_id: str, save: bool = True, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    existed = workspace_manager.unload_workspace(user_id, workspace_id, save=save)
    if not existed:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {
        "state": "successful",
        "message": f"Workspace {workspace_id} unloaded",
        "workspace_id": workspace_id,
    }


@router.get("/{workspace_id}")
async def get_workspace(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    info = workspace_manager.get_workspace_info(user_id, workspace_id)
    if not info:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return info


@router.put("/{workspace_id}/name")
async def rename_workspace(
    workspace_id: str, new_name: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    workspace = workspace_manager.get_workspace(user_id, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    try:
        is_valid, reason = validate_workspace_name(new_name)
        if not is_valid:
            raise HTTPException(
                status_code=400, detail=f"Invalid workspace name: {reason}"
            )
        workspace.name = new_name
        _persist_workspace(user_id, workspace_id, workspace)
        info = workspace_manager.get_workspace_info(user_id, workspace_id)
        if not info:
            raise HTTPException(
                status_code=500, detail="Failed to fetch updated workspace info"
            )
        return info
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename workspace: {e}")


@router.post("/{workspace_id}/save")
async def save_workspace(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    try:
        _persist_workspace(user_id, workspace_id, ws)
        return {"state": "successful", "message": "Workspace saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save workspace: {e}")


@router.post("/{workspace_id}/download")
async def start_workspace_download(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Start a background task to package the workspace as a ZIP archive.

    Used by:
    - frontend Download button in Workspace Manager

    Why:
    - Moves potentially slow ZIP compression into the Task Center so users can
      track progress and the UI stays responsive.
    """
    user_id = current_user["id"]

    # Persist latest state if this is the current in-memory workspace
    current_workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if current_workspace_id == workspace_id:
        current_workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if current_workspace is not None:
            _persist_workspace(user_id, workspace_id, current_workspace)

    # Verify workspace directory exists before submitting
    workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
    if workspace_dir is None or not workspace_dir.exists():
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Resolve a human-readable name for the task centre label
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    ws_name = ws.name if ws else workspace_id

    # Use USER_TASK_SCOPE so the download task appears in the unified
    # SSE stream immediately (the stream always subscribes to this scope).
    tm = workspace_manager.get_task_manager(user_id, USER_TASK_SCOPE)
    task_info = await tm.submit_task(
        user_id=user_id,
        workspace_id=USER_TASK_SCOPE,
        task_type="workspace_download",
        task_args={
            "target_workspace_id": workspace_id,
            "target_workspace_dir": str(workspace_dir),
        },
        task_name=f"Download: {ws_name}",
        metadata={
            "task_scope": "user",
            "workspace_id": workspace_id,
        },
    )

    return {
        "state": "running",
        "message": "Workspace download started",
        "metadata": {
            "task_id": task_info.id,
            "task_scope": "user",
        },
    }


@router.get("/{workspace_id}/download/tasks/{task_id}/artifact")
async def download_workspace_artifact(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Stream a completed workspace ZIP artifact and delete it after download.

    Used by:
    - frontend auto-download on task completion

    Why:
    - One-time artifact policy: the ZIP is deleted after the first successful
      download to avoid unbounded disk usage.
    """
    user_id = current_user["id"]

    # Download tasks live under USER_TASK_SCOPE for unified SSE visibility.
    tm = workspace_manager.get_task_manager(user_id, USER_TASK_SCOPE)
    task_info = await tm.get_task(task_id)
    if task_info is None:
        raise HTTPException(status_code=404, detail="Task not found")

    # Verify the task belongs to this workspace
    if task_info.metadata.get("workspace_id") != workspace_id:
        raise HTTPException(
            status_code=403, detail="Task does not belong to this workspace"
        )

    if task_info.metadata.get("task_type") != "workspace_download":
        raise HTTPException(status_code=400, detail="Task is not a workspace download")

    from ...core.worker_task_manager import TaskStatus

    if task_info.status != TaskStatus.SUCCESSFUL:
        raise HTTPException(
            status_code=409,
            detail=f"Task is not completed (state: {task_info.status.value})",
        )

    result = task_info.result
    if not isinstance(result, dict) or not result.get("artifact_path"):
        raise HTTPException(status_code=410, detail="Artifact metadata missing")

    artifact_path = Path(result["artifact_path"])
    if not artifact_path.exists():
        raise HTTPException(
            status_code=410, detail="Artifact already downloaded or deleted"
        )

    filename = result.get("filename", f"{workspace_id}.zip")

    def _stream_and_delete():
        """Yield ZIP content then delete the artifact file."""
        try:
            with open(artifact_path, "rb") as fh:
                while True:
                    chunk = fh.read(64 * 1024)
                    if not chunk:
                        break
                    yield chunk
        finally:
            try:
                artifact_path.unlink(missing_ok=True)
            except OSError:
                pass

    return StreamingResponse(
        _stream_and_delete(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/upload")
async def upload_workspace_zip(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload a workspace ZIP archive and import it into user workspace storage."""
    user_id = current_user["id"]

    filename = file.filename or "workspace.zip"
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are supported")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    existing_ids = set(workspace_manager.list_user_workspaces_summaries(user_id).keys())

    try:
        with tempfile.TemporaryDirectory(prefix="workspace_zip_") as temp_dir:
            extraction_dir = tempfile.mkdtemp(prefix="extracted_", dir=temp_dir)

            with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as zf:
                members = [m for m in zf.infolist() if not m.is_dir()]
                if not members:
                    raise HTTPException(status_code=400, detail="ZIP archive is empty")

                safe_paths = [_safe_member_path(m.filename) for m in members]
                metadata_candidates = [
                    p
                    for p in safe_paths
                    if p.name == "metadata.json" and "__MACOSX" not in p.parts
                ]
                if not metadata_candidates:
                    raise HTTPException(
                        status_code=400,
                        detail="ZIP must contain workspace metadata.json",
                    )

                metadata_path_in_zip = min(
                    metadata_candidates, key=lambda p: len(p.parts)
                )
                root_prefix = metadata_path_in_zip.parts[:-1]

                for member, safe_path in zip(members, safe_paths):
                    if "__MACOSX" in safe_path.parts:
                        continue
                    if (
                        root_prefix
                        and safe_path.parts[: len(root_prefix)] != root_prefix
                    ):
                        continue

                    relative_parts = (
                        safe_path.parts[len(root_prefix) :]
                        if root_prefix
                        else safe_path.parts
                    )
                    if not relative_parts:
                        continue

                    relative_path = PurePosixPath(*relative_parts)
                    if relative_path.name in {".DS_Store"}:
                        continue

                    destination = Path(extraction_dir) / Path(*relative_path.parts)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(member, "r") as src, destination.open("wb") as dst:
                        shutil.copyfileobj(src, dst)

            extracted_root = Path(extraction_dir)
            metadata_file = extracted_root / "metadata.json"
            if not metadata_file.exists():
                raise HTTPException(
                    status_code=400,
                    detail="ZIP missing required metadata.json at workspace root",
                )

            with metadata_file.open("r", encoding="utf-8") as f:
                metadata = json.load(f)

            workspace_metadata = metadata.setdefault("workspace_metadata", {})
            incoming_id = workspace_metadata.get("id")
            incoming_name = workspace_metadata.get("name")

            if (
                isinstance(incoming_id, str)
                and incoming_id
                and incoming_id not in existing_ids
            ):
                workspace_id = incoming_id
            else:
                workspace_id = generate_workspace_id()

            workspace_name = (
                incoming_name
                if isinstance(incoming_name, str) and incoming_name.strip()
                else filename.rsplit(".zip", 1)[0]
            )

            workspace_metadata["id"] = workspace_id
            workspace_metadata["name"] = workspace_name
            with metadata_file.open("w", encoding="utf-8") as f:
                json.dump(metadata, f)

            target_dir = workspace_manager._resolve_workspace_dir(
                user_id=user_id,
                workspace_id=workspace_id,
                workspace_name=workspace_name,
            )
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            shutil.copytree(extracted_root, target_dir)

            workspace_manager._refresh_user_workspace_paths(user_id)

        summary = workspace_manager.list_user_workspaces_summaries(user_id).get(
            workspace_id,
            {
                "workspace_id": workspace_id,
                "name": workspace_name,
            },
        )
        return {"state": "successful", "workspace": summary}
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail=f"Invalid ZIP file: {exc}")
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=500, detail=f"Failed to upload workspace: {exc}"
        )


@router.post("/{workspace_id}/save-as")
async def save_workspace_as(
    workspace_id: str, folder_name: str, current_user: dict = Depends(get_current_user)
):
    """Clone a workspace into a new id/name and persist it as a separate copy.

    Used by:
    - frontend “Save As” flow

    Why:
    - Creates branch-like workspace copies without mutating source workspace.

    """
    user_id = current_user["id"]
    source = workspace_manager.get_workspace(user_id, workspace_id)
    if not source:
        raise HTTPException(status_code=404, detail="Workspace not found")
    try:
        new_id = generate_workspace_id()
        new_name = folder_name.replace(".json", "")

        with tempfile.TemporaryDirectory(prefix="workspace_clone_") as temp_dir:
            source.save(temp_dir)
            new_ws = Workspace.load(temp_dir)

        new_ws.id = new_id
        new_ws.name = new_name

        _persist_workspace(user_id, new_id, new_ws)
        workspace_manager.set_current_workspace(user_id, new_id)
        info = workspace_manager.get_workspace_info(user_id, new_id)
        return {
            "state": "successful",
            "message": "Workspace cloned",
            "new_workspace": info,
        }
    except Exception as e:  # pragma: no cover
        raise HTTPException(
            status_code=500, detail=f"Failed to save workspace copy: {e}"
        )


@router.get("/{workspace_id}/info")
async def get_workspace_info(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    info = workspace_manager.get_workspace_info(user_id, workspace_id)
    if not info:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return info


@router.get("/{workspace_id}/graph")
async def get_workspace_graph(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """Return graph payload enriched with latest analysis snapshots.

    Used by:
    - frontend graph canvas initialization and refresh

    Why:
    - Combines structural graph data with latest analysis state for one roundtrip.

    Refactor note:
    - Latest-analysis enrichment logic could move to a shared graph assembler to
      reduce route-level orchestration.
    """
    user_id = current_user["id"]
    graph_data = workspace_manager.get_workspace_graph(user_id, workspace_id)
    if not graph_data:
        raise HTTPException(status_code=404, detail="Workspace not found")
    try:  # enrichment with latest analyses
        from ....analysis.manager import get_task_manager

        task_manager = get_task_manager(user_id, workspace_id)
        latest: Dict[str, Any] = {}
        for analysis, task_id in task_manager.store.current_task_ids.items():
            task = task_manager.get_task(task_id)
            if task is None:
                continue
            raw_result = getattr(task, "result", None)
            if hasattr(raw_result, "to_json"):
                raw_result = raw_result.to_json()

            unwrapped_result = unwrap_task_manager_result(raw_result)
            latest[str(analysis)] = {
                "task": str(analysis),
                "saved_at": getattr(task, "updated_at", None),
                "request": getattr(task, "request", None),
                "result": unwrapped_result,
            }
        graph_data["latest_analysis"] = latest
    except Exception:
        pass
    return graph_data


@router.get("/{workspace_id}/nodes")
async def get_workspace_nodes(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    summaries = workspace_manager.get_node_summaries(user_id, workspace_id)
    return {"nodes": summaries}
