"""File upload endpoint extracted from base.py.

Maintains identical route and behavior for backward compatibility.
"""

from typing import Optional, cast

import polars as pl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ...core.auth import get_current_user
from ...core.utils import get_user_data_folder, load_data_file
from ...core.workspace import workspace_manager

router = APIRouter(prefix="/workspaces", tags=["files"])


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
        data = load_data_file(file_path)
        if (
            hasattr(data, "iloc")
            and hasattr(data, "dtypes")
            and not isinstance(data, (pl.DataFrame, pl.LazyFrame))
        ):
            data = pl.DataFrame(data)
        try:
            if isinstance(data, pl.DataFrame):
                data = data.lazy()
        except Exception:
            pass
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
