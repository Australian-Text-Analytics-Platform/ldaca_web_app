"""Simplified Workspace Manager (single in-memory workspace per user).

Design Goals:
* Each user can have many persisted workspaces on disk.
* At most ONE workspace object is resident in memory per user at any time.
* Switching workspaces always saves & unloads the previous one before loading the next.
* Business logic remains in docworkspace.Workspace / Node; this is only orchestration.
* Backward compatibility deliberately dropped.
"""

import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Union

import polars as pl
from docworkspace import Node, Workspace  # type: ignore
from docworkspace.workspace.io import read_workspace  # type: ignore
from docworkspace.workspace.io import write_workspace
from ldaca_web_app_backend.analysis.manager import get_analysis_manager

from .docworkspace_api import (
    DocWorkspaceAPIUtils,
    create_operation_result,
    handle_api_error,
)
from .utils import (
    allocate_workspace_folder,
    ensure_display_folder_name,
    find_workspace_folder_by_id,
    generate_workspace_id,
    get_user_workspace_folder,
    load_workspace_metadata,
)


class WorkspaceManager:
    """Single-workspace-per-user in-memory manager."""

    def __init__(self) -> None:
        self._current: Dict[str, Dict[str, Any]] = {}
        # Per-user/workspace task managers (not serialized)
        self._task_managers: Dict[tuple[str, str], Any] = {}
        # Track on-disk workspace folder paths per user/workspace
        self._paths: Dict[tuple[str, str], Path] = {}

    # ---------------- Core helpers ----------------
    def _get_current_entry(
        self, user_id: str
    ) -> tuple[Optional[str], Optional[Any], Optional[Path]]:
        entry = self._current.get(user_id)
        if not entry:
            return None, None, None
        return entry.get("id"), entry.get("ws"), entry.get("path")

    def _path_key(self, user_id: str, workspace_id: str) -> tuple[str, str]:
        return (user_id, workspace_id)

    def _get_cached_path(self, user_id: str, workspace_id: str) -> Optional[Path]:
        return self._paths.get(self._path_key(user_id, workspace_id))

    def _set_cached_path(self, user_id: str, workspace_id: str, path: Path) -> None:
        self._paths[self._path_key(user_id, workspace_id)] = path

    def _attach_workspace_dir(self, workspace: Workspace, path: Path) -> None:
        try:
            setattr(workspace, "_workspace_dir", path)
        except Exception:
            pass

    def _attach_analysis_manager(self, user_id: str, workspace: Workspace) -> None:
        """Attach analysis manager to workspace instance."""
        try:
            workspace.analysis = get_analysis_manager(user_id, workspace.id)
        except Exception:
            pass

    def _resolve_workspace_dir(
        self, user_id: str, workspace_id: str, workspace_name: str
    ) -> Path:
        cached = self._get_cached_path(user_id, workspace_id)
        if cached and cached.exists():
            updated = ensure_display_folder_name(cached, workspace_name)
            self._set_cached_path(user_id, workspace_id, updated)
            return updated

        found = find_workspace_folder_by_id(user_id, workspace_id)
        if found:
            updated = ensure_display_folder_name(found, workspace_name)
            self._set_cached_path(user_id, workspace_id, updated)
            return updated

        # Allocate a new folder when none exists
        allocated = allocate_workspace_folder(user_id, workspace_name)
        self._set_cached_path(user_id, workspace_id, allocated)
        return allocated

    def _save(self, user_id: str, workspace_id: str, workspace: Workspace) -> None:
        workspace.set_metadata("modified_at", datetime.now().isoformat())
        target_dir = self._resolve_workspace_dir(
            user_id=user_id, workspace_id=workspace_id, workspace_name=workspace.name
        )
        self._attach_workspace_dir(workspace, target_dir)
        write_workspace(workspace, target_dir)
        self._set_cached_path(user_id, workspace_id, target_dir)
        current_entry = self._current.get(user_id)
        if current_entry and current_entry.get("id") == workspace_id:
            current_entry["path"] = target_dir
            self._current[user_id] = current_entry

    def _load(self, user_id: str, workspace_id: str) -> Workspace | None:
        target_dir = find_workspace_folder_by_id(user_id, workspace_id)
        if target_dir is None:
            print(
                f"Workspace folder not found for workspace {workspace_id} under user {user_id}"
            )
            return None
        try:
            ws = read_workspace(target_dir)
            # Ensure folder name mirrors current workspace name for discoverability
            updated_dir = ensure_display_folder_name(target_dir, ws.name)
            self._attach_workspace_dir(ws, updated_dir)
            self._set_cached_path(user_id, workspace_id, updated_dir)
            self._attach_analysis_manager(user_id, ws)
            return ws
        except Exception as e:  # pragma: no cover
            print(
                f"Failed to deserialize workspace {workspace_id} from {target_dir}: {e}"
            )
            return None

    def _replace_current(self, user_id: str, new_id: str, new_ws: Any):
        current_id, current_ws, _ = self._get_current_entry(user_id)
        if current_id is not None and current_ws is not None:
            self._save(user_id, current_id, current_ws)
            # Don't drop analysis state when switching workspaces - analyses should
            # persist across workspace switches until explicitly cleared or unloaded
            # if current_id != new_id:
            #     self.drop_analysis_state(user_id, current_id)
        new_path = self._resolve_workspace_dir(user_id, new_id, new_ws.name)
        self._attach_workspace_dir(new_ws, new_path)
        self._current[user_id] = {"id": new_id, "ws": new_ws, "path": new_path}
        self._attach_analysis_manager(user_id, new_ws)

    # ---------------- Public API ----------------
    def get_current_workspace_id(self, user_id: str) -> Optional[str]:
        cid, _, _ = self._get_current_entry(user_id)
        return cid

    def get_current_workspace(self, user_id: str) -> Optional[Any]:
        _, ws, _ = self._get_current_entry(user_id)
        return ws

    def set_current_workspace(self, user_id: str, workspace_id: Optional[str]) -> bool:
        if workspace_id is None:
            cid, cws, _ = self._get_current_entry(user_id)
            if cid and cws:
                self._save(user_id, cid, cws)
                # Analysis state is now managed by AnalysisManager attached to workspace
            self._current.pop(user_id, None)
            return True
        cid, cws, _ = self._get_current_entry(user_id)
        if cid == workspace_id and cws is not None:
            # Ensure analysis manager is attached if it was somehow lost (e.g. reload)
            if not getattr(cws, "analysis", None):
                self._attach_analysis_manager(user_id, cws)
            return True
        new_ws = self._load(user_id, workspace_id)
        if not new_ws:
            return False
        self._replace_current(user_id, workspace_id, new_ws)
        return True

    def create_workspace(
        self,
        user_id: str,
        name: str,
        description: str = "",
        data: Optional[Union[str, Path, pl.DataFrame, pl.LazyFrame]] = None,
        data_name: Optional[str] = None,
    ) -> Any:
        cid, cws, _ = self._get_current_entry(user_id)
        if cid is not None and cws is not None:
            self._save(user_id, cid, cws)
        ws = Workspace(name=name, data=data, data_name=data_name)
        wid = generate_workspace_id()
        ws.id = wid
        now = datetime.now().isoformat()
        ws.set_metadata("description", description)
        ws.set_metadata("created_at", now)
        ws.set_metadata("modified_at", now)
        target_dir = self._resolve_workspace_dir(user_id, wid, ws.name)
        self._attach_workspace_dir(ws, target_dir)
        write_workspace(ws, target_dir)
        self._set_cached_path(user_id, wid, target_dir)
        self._current[user_id] = {"id": wid, "ws": ws, "path": target_dir}
        self._attach_analysis_manager(user_id, ws)
        return ws

    def get_workspace(self, user_id: str, workspace_id: str) -> Optional[Any]:
        cid, cws, _ = self._get_current_entry(user_id)
        if cid == workspace_id:
            if cws is not None:
                cached = self._get_cached_path(user_id, workspace_id)
                if cached:
                    self._attach_workspace_dir(cws, cached)
                self._attach_analysis_manager(user_id, cws)
            return cws
        ws = self._load(user_id, workspace_id)
        if not ws:
            return None
        self._replace_current(user_id, workspace_id, ws)
        return ws

    def list_user_workspaces(self, user_id: str) -> Dict[str, Any]:
        cid, cws, _ = self._get_current_entry(user_id)
        if cid and cws:
            return {cid: cws}
        return {}

    def list_user_workspaces_summaries(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        summaries: Dict[str, Dict[str, Any]] = {}
        cid, cws, _ = self._get_current_entry(user_id)
        user_folder = get_user_workspace_folder(user_id)
        if not user_folder.exists():
            return summaries
        for workspace_dir in user_folder.iterdir():
            if not workspace_dir.is_dir():
                continue
            metadata_path = workspace_dir / "metadata.json"
            raw = load_workspace_metadata(metadata_path)
            if not raw:
                continue
            ws_meta = raw.get("workspace_metadata", {})
            wid = ws_meta.get("id")
            if not wid:
                continue
            if wid == cid and cws is not None:
                target = cws
            else:
                target = self._load(user_id, wid)
            if not target:
                continue
            try:
                summary = target.summary()
                cached_path = self._get_cached_path(user_id, wid) or workspace_dir
                summaries[wid] = {
                    "workspace_id": wid,
                    "name": getattr(target, "name", wid),
                    "description": target.get_metadata("description") or "",
                    "created_at": target.get_metadata("created_at") or "",
                    "modified_at": target.get_metadata("modified_at") or "",
                    "file_size": metadata_path.stat().st_size,
                    "node_count": summary.get("total_nodes"),
                    "root_nodes": summary.get("root_nodes"),
                    "leaf_nodes": summary.get("leaf_nodes"),
                    "node_types": summary.get("node_types"),
                    "folder_name": cached_path.name,
                }
            except Exception:
                summaries[wid] = {"workspace_id": wid, "error": "summary_failed"}
            if wid != cid:
                del target
        return summaries

    def delete_workspace(self, user_id: str, workspace_id: str) -> bool:
        cid, cws, _ = self._get_current_entry(user_id)
        if cid == workspace_id and cws is not None:
            try:
                self._save(user_id, cid, cws)
            except Exception:
                pass
            self._current.pop(user_id, None)
        target_dir = self._get_cached_path(
            user_id, workspace_id
        ) or find_workspace_folder_by_id(user_id, workspace_id)
        if target_dir and target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
            self._paths.pop(self._path_key(user_id, workspace_id), None)
            return True
        return False

    def get_task_manager(self, user_id: str, workspace_id: str):
        from ldaca_web_app_backend.core.process_task_manager import ProcessTaskManager

        key = (user_id, workspace_id)
        tm = self._task_managers.get(key)
        if tm is None:
            tm = ProcessTaskManager()
            self._task_managers[key] = tm
        return tm

    def get_workspace_dir(self, user_id: str, workspace_id: str) -> Optional[Path]:
        cached = self._get_cached_path(user_id, workspace_id)
        if cached and cached.exists():
            cid, cws, _ = self._get_current_entry(user_id)
            if cid == workspace_id and cws is not None:
                self._attach_workspace_dir(cws, cached)
            return cached
        found = find_workspace_folder_by_id(user_id, workspace_id)
        if found:
            self._set_cached_path(user_id, workspace_id, found)
            cid, cws, _ = self._get_current_entry(user_id)
            if cid == workspace_id and cws is not None:
                self._attach_workspace_dir(cws, found)
            return found
        return None

    def unload_workspace(self, user_id: str, save: bool = True) -> bool:
        cid, cws, _ = self._get_current_entry(user_id)
        if not cid or not cws:
            return False
        if save:
            self._save(user_id, cid, cws)
        self._current.pop(user_id, None)
        return True

    # ---------------- Node operations ----------------
    def add_node_to_workspace(
        self,
        user_id: str,
        workspace_id: str,
        data: Any,
        node_name: str,
        operation: str = "manual_add",
        parents: Optional[list[Any]] = None,
    ) -> Optional[Any]:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            return None
        try:
            node = Node(
                data=data,
                name=node_name,
                workspace=ws,
                parents=parents or [],
                operation=operation,
            )
            self._save(user_id, workspace_id, ws)
            return node
        except Exception as e:  # pragma: no cover
            print(f"Error creating node: {e}")
            return None

    def get_node_from_workspace(
        self, user_id: str, workspace_id: str, node_id: str
    ) -> Optional[Any]:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            return None
        return ws.get_node(node_id)

    def delete_node_from_workspace(
        self, user_id: str, workspace_id: str, node_id: str
    ) -> bool:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            return False
        success = ws.remove_node(node_id)
        if success:
            try:
                workspace_dir = self.get_workspace_dir(user_id, workspace_id)
                if workspace_dir is not None:
                    # Current workspace persistence stores node payloads as
                    # Polars binary blobs under data/<node_id>.plbin.
                    for suffix in (".plbin", ".lazy"):
                        candidate = workspace_dir / "data" / f"{node_id}{suffix}"
                        if candidate.exists():
                            candidate.unlink()
            except Exception:
                pass
            self._save(user_id, workspace_id, ws)
        return success

    # ---------------- Graph / info operations ----------------
    def get_workspace_graph(
        self, user_id: str, workspace_id: str
    ) -> Optional[Dict[str, Any]]:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            return None
        # Always use backend utility to produce API graph (no core monkey patching)
        graph = DocWorkspaceAPIUtils.workspace_to_react_flow(ws)
        if hasattr(graph, "model_dump"):
            return graph.model_dump()
        if hasattr(graph, "dict"):
            return graph.dict()  # type: ignore
        return graph  # type: ignore

    def get_node_summaries(self, user_id: str, workspace_id: str) -> list:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            return []
        return [
            DocWorkspaceAPIUtils.node_to_summary(node) for node in ws.nodes.values()
        ]

    def get_workspace_info(
        self, user_id: str, workspace_id: str
    ) -> Optional[Dict[str, Any]]:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            return None
        summary = ws.summary()
        return {
            "workspace_id": workspace_id,
            "name": ws.name,
            "description": ws.get_metadata("description") or "",
            "created_at": ws.get_metadata("created_at") or "",
            "modified_at": ws.get_metadata("modified_at") or "",
            "total_nodes": summary["total_nodes"],
            "root_nodes": summary["root_nodes"],
            "leaf_nodes": summary["leaf_nodes"],
            "node_types": summary["node_types"],
            "status_counts": summary["status_counts"],
        }

    def execute_safe_operation(
        self, user_id: str, workspace_id: str, operation_func, *args, **kwargs
    ):
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            return {"success": False, "message": "Workspace not found"}
        try:
            result = operation_func(*args, **kwargs)
            # If operation produced a Node, include metadata; else, include stringified result
            if Node is not None and isinstance(result, Node):  # type: ignore[arg-type]
                op_result = create_operation_result(
                    success=True,
                    message="Operation completed successfully",
                    node_id=result.id,
                    data={
                        "node_name": result.name,
                        "data_type": type(result.data).__name__,
                    },
                )
            else:
                op_result = create_operation_result(
                    success=True,
                    message="Operation completed successfully",
                    data={"result": str(result)},
                )
        except Exception as e:
            error_response = handle_api_error(e)
            op_result = create_operation_result(
                success=False,
                message=f"Operation failed: {error_response.message}",
                errors=[error_response.error],
            )
        self._save(user_id, workspace_id, ws)
        return op_result

    def persist(self, user_id: str, workspace_id: str) -> None:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is not None:
            self._save(user_id, workspace_id, ws)


# Global singleton
workspace_manager = WorkspaceManager()

# Global singleton
workspace_manager = WorkspaceManager()

# Global singleton
workspace_manager = WorkspaceManager()
