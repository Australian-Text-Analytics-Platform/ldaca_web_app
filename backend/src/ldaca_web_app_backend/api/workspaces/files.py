"""File upload endpoint extracted from base.py.

Maintains identical route and behavior for backward compatibility.
"""

from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ...core.auth import get_current_user
from ...core.utils import get_user_data_folder, load_data_file
from ...core.workspace import workspace_manager
from .utils import stage_dataframe_as_lazy

router = APIRouter(prefix="/workspaces", tags=["files"])


class LDaCAImportRequest(BaseModel):
    url: str
    filename: Optional[str] = None


@router.post("/{workspace_id}/upload")
async def upload_file_to_workspace(
    workspace_id: str,
    file: UploadFile = File(...),
    node_name: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Upload file and create node in workspace.

    Behavior mirrors original implementation in base.py.
    """
    user_id = current_user["id"]
    try:
        user_folder = get_user_data_folder(user_id)
        file_path = user_folder / (file.filename or "uploaded_file")
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        data_obj = load_data_file(file_path)

        workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
        if workspace_dir is None:
            raise HTTPException(status_code=404, detail="Workspace not found")

        node_name = node_name or file.filename or "uploaded_file"

        node_data = stage_dataframe_as_lazy(
            data_obj,
            workspace_dir,
            node_name=node_name,
            document_column=None,
        )

        node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            node_name=node_name,
            data=node_data,
            operation=f"upload_file({file.filename})",
        )
        if not node:
            raise HTTPException(status_code=404, detail="Workspace not found")
        from ...core.docworkspace_api import DocWorkspaceAPIUtils

        return {
            "state": "successful",
            "message": "File uploaded successfully",
            "node": DocWorkspaceAPIUtils.convert_node_info_for_api(node),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to upload file: {e}")


@router.post("/{workspace_id}/import-ldaca")
async def import_ldaca_to_workspace(
    workspace_id: str,
    request: LDaCAImportRequest,
    current_user: dict = Depends(get_current_user),
):
    """Import a dataset from LDaCA using a zip URL as a background task."""
    user_id = current_user["id"]
    try:
        # Verify workspace exists
        workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
        if workspace_dir is None:
            raise HTTPException(status_code=404, detail="Workspace not found")

        # Get task manager
        tm = workspace_manager.get_task_manager(user_id, workspace_id)

        # Submit background task
        task_info = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="ldaca_import",
            task_args={"url": request.url, "filename": request.filename},
        )

        return {
            "state": "running",
            "message": "LDaCA import started",
            "metadata": {"task_id": task_info.id},
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start import: {e}")
