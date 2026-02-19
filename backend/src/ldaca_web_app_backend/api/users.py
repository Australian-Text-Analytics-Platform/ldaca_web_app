"""
User management endpoints
"""

from fastapi import APIRouter, Depends

from ..core.auth import get_current_user
from ..core.utils import (
    get_folder_size_mb,
    get_user_data_folder,
    get_user_workspace_folder,
)
from ..models import UserFolderInfo, UserStorageInfo

router = APIRouter(prefix="/user", tags=["user_management"])


@router.get("/folders", response_model=UserFolderInfo)
async def get_user_folders(current_user: dict = Depends(get_current_user)):
    """Return folder paths and counts for the current user.

    Used by:
    - frontend user settings/storage views

    Why:
    - Exposes filesystem locations and inventory for user-owned content.
    """
    user_id = current_user["id"]
    data_folder = get_user_data_folder(user_id)
    workspace_folder = get_user_workspace_folder(user_id)

    # Count files and workspaces
    data_files = list(data_folder.glob("*"))
    workspace_files = list(workspace_folder.glob("*.pkl"))

    return {
        "data_folder": str(data_folder),
        "workspace_folder": str(workspace_folder),
        "total_files": len([f for f in data_files if f.is_file()]),
        "total_workspaces": len(workspace_files),
    }


@router.get("/storage", response_model=UserStorageInfo)
async def get_user_storage(current_user: dict = Depends(get_current_user)):
    """Return user storage usage statistics.

    Used by:
    - frontend storage quota display

    Why:
    - Aggregates file/workspace counts and sizes for user visibility.

    Refactor note:
    - Quota value is hardcoded; consider sourcing from settings to avoid drift.
    """
    user_id = current_user["id"]
    data_folder = get_user_data_folder(user_id)
    workspace_folder = get_user_workspace_folder(user_id)

    # Calculate sizes
    data_files_size = get_folder_size_mb(data_folder)
    workspace_files_size = get_folder_size_mb(workspace_folder)

    # Count files
    data_files = list(data_folder.glob("*"))
    workspace_files = list(workspace_folder.glob("*.pkl"))

    return {
        "data_files_count": len([f for f in data_files if f.is_file()]),
        "data_files_size_mb": data_files_size,
        "workspaces_count": len(workspace_files),
        "workspaces_size_mb": workspace_files_size,
        "total_size_mb": data_files_size + workspace_files_size,
        "quota_limit_mb": 1000.0,  # 1GB limit for demo
    }
