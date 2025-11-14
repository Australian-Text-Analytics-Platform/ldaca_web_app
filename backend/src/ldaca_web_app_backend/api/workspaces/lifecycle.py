"""Workspace lifecycle endpoints extracted from base.py.
Routes preserved exactly for backward compatibility."""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ...core.auth import get_current_user
from ...core.json_utils import json_sanitize
from ...core.utils import (
    generate_workspace_id,
    get_user_data_folder,
    get_user_workspace_folder,
)
from ...core.workspace import workspace_manager
from ...models import WorkspaceCreateRequest, WorkspaceInfo

router = APIRouter(prefix="/workspaces", tags=["lifecycle"])


@router.get("/")
async def list_workspaces(current_user: dict = Depends(get_current_user)):
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
    user_id = current_user["id"]
    success = workspace_manager.set_current_workspace(user_id, workspace_id)
    if not success and workspace_id is not None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"state": "successful", "current_workspace_id": workspace_id}


@router.post("/", response_model=WorkspaceInfo)
async def create_workspace(
    request: WorkspaceCreateRequest, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        workspace = workspace_manager.create_workspace(
            user_id=user_id, name=request.name, description=request.description or ""
        )
        workspace_id = workspace.get_metadata("id")
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


@router.post("", response_model=WorkspaceInfo)
async def create_workspace_no_trailing_slash(
    request: WorkspaceCreateRequest, current_user: dict = Depends(get_current_user)
):
    return await create_workspace(request, current_user)


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
        workspace.name = new_name
        workspace_manager.persist(user_id, workspace_id)
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
        workspace_manager.persist(user_id, workspace_id)
        return {"state": "successful", "message": "Workspace saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save workspace: {e}")


@router.post("/{workspace_id}/save-as")
async def save_workspace_as(
    workspace_id: str, filename: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    source = workspace_manager.get_workspace(user_id, workspace_id)
    if not source:
        raise HTTPException(status_code=404, detail="Workspace not found")
    user_folder = get_user_data_folder(user_id)
    tmp_path = user_folder / f"_tmp_clone_{workspace_id}.json"
    try:
        source.serialize(tmp_path)
        from docworkspace import Workspace as DWWorkspace  # type: ignore

        new_ws = DWWorkspace.deserialize(tmp_path)  # type: ignore
        new_id = generate_workspace_id()
        new_ws.set_metadata("id", new_id)
        new_ws.set_metadata("created_at", source.get_metadata("created_at"))
        new_ws.set_metadata("modified_at", source.get_metadata("modified_at"))
        new_ws.name = filename.replace(".json", "")
        target = get_user_workspace_folder(user_id)
        target.mkdir(parents=True, exist_ok=True)
        new_ws.serialize(target / f"workspace_{new_id}.json")
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
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass


@router.get("/{workspace_id}/download")
async def download_workspace(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    current_id = workspace_manager.get_current_workspace_id(user_id)
    if current_id == workspace_id:
        try:
            ws = workspace_manager.get_workspace(user_id, workspace_id)
            if ws:
                workspace_manager.persist(user_id, workspace_id)
        except Exception:
            pass
    user_folder = get_user_workspace_folder(user_id)
    json_path = user_folder / f"workspace_{workspace_id}.json"
    if not json_path.exists():
        raise HTTPException(status_code=404, detail="Workspace file not found")
    return FileResponse(
        json_path,
        media_type="application/json",
        filename=f"workspace_{workspace_id}.json",
    )


@router.post("/import")
async def import_workspace(
    file: UploadFile = File(...), current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    filename = file.filename or "workspace.json"
    if not filename.lower().endswith(".json"):
        raise HTTPException(
            status_code=400, detail="Only .json workspace files are supported"
        )
    target_folder = get_user_workspace_folder(user_id)
    target_folder.mkdir(parents=True, exist_ok=True)
    tmp_path = target_folder / ("_tmp_upload_" + filename)
    try:
        content = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(content)
        from docworkspace import Workspace as DWWorkspace  # type: ignore

        try:
            new_ws = DWWorkspace.deserialize(tmp_path)  # type: ignore
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid workspace JSON: {e}")
        new_id = generate_workspace_id()
        new_ws.set_metadata("id", new_id)
        base_name = filename.rsplit("/", 1)[-1].rsplit(".json", 1)[0]
        if not getattr(new_ws, "name", None):
            try:
                new_ws.name = base_name
            except Exception:
                pass
        final_path = target_folder / f"workspace_{new_id}.json"
        new_ws.serialize(final_path)
        info = workspace_manager.get_workspace_info(user_id, new_id) or {
            "workspace_id": new_id,
            "name": getattr(new_ws, "name", base_name),
        }
        return {"state": "successful", "workspace": info}
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to import workspace: {e}")
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass


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
    user_id = current_user["id"]
    graph_data = workspace_manager.get_workspace_graph(user_id, workspace_id)
    if not graph_data:
        raise HTTPException(status_code=404, detail="Workspace not found")
    try:  # enrichment with latest analyses
        from ...core.analysis_store import list_analyses  # type: ignore

        records = list_analyses(user_id, workspace_id)
        latest: Dict[str, Any] = {}
        for r in records:
            latest[str(r.task)] = {
                "task": str(r.task),
                "saved_at": json_sanitize(getattr(r, "saved_at", None)),
                "request": json_sanitize(getattr(r, "request", None)),
                "result": json_sanitize(getattr(r, "result", None)),
            }
        graph_data["latest_analysis"] = latest
    except Exception:
        pass
    return json_sanitize(graph_data)


@router.get("/{workspace_id}/nodes")
async def get_workspace_nodes(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    summaries = workspace_manager.get_node_summaries(user_id, workspace_id)
    return {"nodes": summaries}
