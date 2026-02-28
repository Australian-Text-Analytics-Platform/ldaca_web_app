"""Workspace lifecycle endpoints for workspace create/load/save/import flows."""

import io
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Optional

from docworkspace.workspace.core import Workspace
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from ...core.auth import get_current_user
from ...core.utils import generate_workspace_id, validate_workspace_name
from ...core.workspace import workspace_manager
from ...models import WorkspaceCreateRequest, WorkspaceInfo, WorkspaceSummary
from .utils import update_workspace

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


@router.get("/", response_model=list[WorkspaceSummary])
async def list_workspaces(current_user: dict = Depends(get_current_user)):
    """List all persisted workspaces visible to the current user.

    Used by:
    - frontend workspace switcher/landing views

    Why:
    - Provides fast summary metadata without loading full workspace graphs.
    """
    user_id = current_user["id"]
    summaries = workspace_manager.list_user_workspaces_summaries(user_id)
    return summaries


@router.get("/current")
async def get_current_workspace(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    current_workspace_id = workspace_manager.get_current_workspace_id(user_id)
    return {"id": current_workspace_id}


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
    return {"state": "successful", "id": workspace_id}


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
        workspace_id = workspace.id
        workspace.description = request.description or ""

        update_workspace(user_id, workspace_id, workspace)
        workspace_manager.set_current_workspace(user_id, workspace_id)

        workspace_info = workspace.info_json()
        workspace_info["id"] = workspace_id
        return WorkspaceInfo(**workspace_info)
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


@router.delete("/delete")
async def delete_workspace(
    workspace_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    if not workspace_id.strip():
        raise HTTPException(status_code=400, detail="workspace_id is required")
    success = workspace_manager.delete_workspace(user_id, workspace_id)
    if not success:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {
        "state": "successful",
        "message": f"Workspace {workspace_id} deleted successfully",
        "id": workspace_id,
    }


@router.post("/unload")
async def unload_workspace(
    save: bool = True,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    existed = workspace_manager.unload_workspace(user_id, workspace_id, save=save)
    if not existed:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {
        "state": "successful",
        "message": f"Workspace {workspace_id} unloaded",
        "id": workspace_id,
    }


@router.put("/name")
async def rename_workspace(
    new_name: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    workspace = workspace_manager.get_current_workspace(user_id)
    try:
        is_valid, reason = validate_workspace_name(new_name)
        if not is_valid:
            raise HTTPException(
                status_code=400, detail=f"Invalid workspace name: {reason}"
            )
        workspace.name = new_name
        update_workspace(user_id, workspace_id, workspace)
        return workspace.info_json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename workspace: {e}")


@router.post("/save")
async def save_workspace(
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    try:
        update_workspace(user_id, workspace_id, ws)
        return {"state": "successful", "message": "Workspace saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save workspace: {e}")


@router.post("/download")
async def start_workspace_download(
    current_user: dict = Depends(get_current_user),
):
    """Start a background task to package the workspace as a ZIP archive.

    Used by:
    - frontend Download button in Workspace Manager

    Why:
    - Moves potentially slow ZIP compression into the Task Center so users can
      track progress and the UI stays responsive.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)

    # Persist latest state if this is the current in-memory workspace
    if workspace_manager.get_current_workspace_id(user_id) == workspace_id:
        update_workspace(user_id, workspace_id, ws)

    # Verify workspace directory exists before submitting
    workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
    if workspace_dir is None or not workspace_dir.exists():
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Resolve a human-readable name for the task centre label
    ws_name = ws.name if ws else workspace_id

    tm = workspace_manager.get_task_manager(user_id)
    task_info = await tm.submit_task(
        user_id=user_id,
        workspace_id=workspace_id,
        task_type="workspace_download",
        task_args={
            "target_workspace_id": workspace_id,
            "target_workspace_dir": str(workspace_dir),
        },
        task_name=f"Download: {ws_name}",
    )

    return {
        "state": "running",
        "message": "Workspace download started",
        "metadata": {
            "task_id": task_info.id,
        },
    }


@router.get("/download/tasks/{task_id}/artifact")
async def download_workspace_artifact(
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
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    tm = workspace_manager.get_task_manager(user_id)
    task_info = await tm.get_task(task_id)
    if task_info is None:
        raise HTTPException(status_code=404, detail="Task not found")

    # Verify the task belongs to this workspace
    if task_info.workspace_id != workspace_id:
        raise HTTPException(
            status_code=403, detail="Task does not belong to this workspace"
        )

    if task_info.task_type != "workspace_download":
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

    existing_ids = {
        item.get("id")
        for item in workspace_manager.list_user_workspaces_summaries(user_id)
        if item.get("id")
    }

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

        summary = next(
            (
                item
                for item in workspace_manager.list_user_workspaces_summaries(user_id)
                if item.get("id") == workspace_id
            ),
            {
                "id": workspace_id,
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


@router.post("/save-as")
async def save_workspace_as(
    folder_name: str,
    current_user: dict = Depends(get_current_user),
):
    """Clone a workspace into a new id/name and persist it as a separate copy.

    Used by:
    - frontend “Save As” flow

    Why:
    - Creates branch-like workspace copies without mutating source workspace.

    """
    user_id = current_user["id"]
    source = workspace_manager.get_current_workspace(user_id)
    try:
        new_id = generate_workspace_id()
        new_name = folder_name.replace(".json", "")

        with tempfile.TemporaryDirectory(prefix="workspace_clone_") as temp_dir:
            source.save(temp_dir)
            new_ws = Workspace.load(temp_dir)

        new_ws.id = new_id
        new_ws.name = new_name

        update_workspace(user_id, new_id, new_ws)
        workspace_manager.set_current_workspace(user_id, new_id)
        return {
            "state": "successful",
            "message": "Workspace cloned",
            "new_workspace": new_ws.info_json(),
        }
    except Exception as e:  # pragma: no cover
        raise HTTPException(
            status_code=500, detail=f"Failed to save workspace copy: {e}"
        )


@router.get("/info")
async def get_workspace_info(
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace = workspace_manager.get_current_workspace(user_id)
    return workspace.info_json()


@router.get("/graph")
async def get_workspace_graph(
    current_user: dict = Depends(get_current_user),
):
    """Return workspace graph payload.

    Used by:
    - frontend graph canvas initialization and refresh

    Why:
    - Exposes the workspace's native graph JSON; frontend owns view-specific
      graph configuration.
    """
    user_id = current_user["id"]
    workspace = workspace_manager.get_current_workspace(user_id)
    return workspace.graph_json()


@router.get("/nodes")
async def get_workspace_nodes(
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace = workspace_manager.get_current_workspace(user_id)
    graph_data = workspace.graph_json()
    return {"nodes": graph_data.get("nodes", [])}
