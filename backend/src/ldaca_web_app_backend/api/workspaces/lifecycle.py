"""Workspace lifecycle endpoints for workspace create/load/save/import flows."""

import json
from typing import Any, Dict, Optional

from docworkspace.workspace.io import (
    deserialize_workspace,  # type: ignore
    serialize_workspace,
)
from fastapi import APIRouter, Depends, HTTPException

from ...core.auth import get_current_user
from ...core.json_utils import json_sanitize
from ...core.utils import generate_workspace_id, validate_workspace_name
from ...core.workspace import workspace_manager
from ...models import WorkspaceCreateRequest, WorkspaceInfo
from .analyses.token_frequencies import (
    _unwrap_task_manager_result as unwrap_task_manager_result,
)

router = APIRouter(prefix="/workspaces", tags=["lifecycle"])


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
        workspace = workspace_manager.create_workspace(
            user_id=user_id, name=request.name, description=request.description or ""
        )
        workspace_id = workspace.id
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
        payload = serialize_workspace(source)
        new_id = generate_workspace_id()
        new_name = folder_name.replace(".json", "")

        ws_meta = payload.get("workspace_metadata", {})
        ws_meta["id"] = new_id
        ws_meta["name"] = new_name
        payload["workspace_metadata"] = ws_meta

        new_ws = deserialize_workspace(payload)
        new_ws.id = new_id

        workspace_manager.save_workspace_object(user_id, new_id, new_ws)
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


@router.post("/import")
async def import_workspace(
    request: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    """Import a workspace from JSON content.

    Used by:
    - frontend workspace import flow

    Why:
    - Rehydrates a serialized workspace payload into persistent user workspace
      storage.
    """
    user_id = current_user["id"]
    json_content = str(request.get("json_content") or "")
    filename = str(request.get("filename") or "workspace.json")

    if not json_content:
        raise HTTPException(status_code=400, detail="Missing json_content")

    try:
        try:
            data = json.loads(json_content)
            new_ws = deserialize_workspace(data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid workspace JSON: {e}")

        new_id = generate_workspace_id()
        new_ws.id = new_id
        base_name = filename.rsplit("/", 1)[-1].rsplit(".json", 1)[0]
        if not getattr(new_ws, "name", None):
            try:
                new_ws.name = base_name
            except Exception:
                pass

        workspace_manager.save_workspace_object(user_id, new_id, new_ws)
        info = workspace_manager.get_workspace_info(user_id, new_id) or {
            "workspace_id": new_id,
            "name": getattr(new_ws, "name", base_name),
        }
        return {"state": "successful", "workspace": info}
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to import workspace: {e}")


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
                "saved_at": json_sanitize(getattr(task, "updated_at", None)),
                "request": json_sanitize(getattr(task, "request", None)),
                "result": json_sanitize(unwrapped_result),
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
