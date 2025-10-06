"""Simplified Workspace Manager (single in-memory workspace per user).

Design Goals:
* Each user can have many persisted workspaces on disk.
* At most ONE workspace object is resident in memory per user at any time.
* Switching workspaces always saves & unloads the previous one before loading the next.
* Business logic remains in docworkspace.Workspace / Node; this is only orchestration.
* Backward compatibility deliberately dropped.
"""

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Union

import polars as pl
from docworkspace import Node, Workspace  # type: ignore

from .docworkspace_api import (
    DocWorkspaceAPIUtils,
    create_operation_result,
    handle_api_error,
)
from .utils import generate_workspace_id, get_user_workspace_folder


class WorkspaceManager:
    """Single-workspace-per-user in-memory manager."""

    def __init__(self) -> None:
        self._current: Dict[str, Dict[str, Any]] = {}
        # Per-user/workspace task managers (not serialized)
        self._task_managers: Dict[tuple[str, str], Any] = {}
        # In-memory analysis cache per user/workspace
        self._analysis_state: Dict[tuple[str, str], Dict[str, Dict[str, Any]]] = {}

    # ---------------- Core helpers ----------------
    def _get_current_entry(self, user_id: str) -> tuple[Optional[str], Optional[Any]]:
        entry = self._current.get(user_id)
        if not entry:
            return None, None
        return entry.get("id"), entry.get("ws")

    def _analysis_key(self, user_id: str, workspace_id: str) -> tuple[str, str]:
        return (user_id, workspace_id)

    def _ensure_analysis_state(
        self, user_id: str, workspace_id: str
    ) -> Dict[str, Dict[str, Any]]:
        key = self._analysis_key(user_id, workspace_id)
        return self._analysis_state.setdefault(key, {})

    def get_analysis_state(
        self, user_id: str, workspace_id: str
    ) -> Dict[str, Dict[str, Any]]:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            raise ValueError("Workspace not found")
        return self._ensure_analysis_state(user_id, workspace_id)

    def drop_analysis_state(self, user_id: str, workspace_id: str) -> None:
        key = self._analysis_key(user_id, workspace_id)
        self._analysis_state.pop(key, None)

    def _save(self, user_id: str, workspace_id: str, workspace: Workspace) -> None:
        user_folder = get_user_workspace_folder(user_id)
        user_folder.mkdir(parents=True, exist_ok=True)
        workspace.set_metadata("modified_at", datetime.now().isoformat())
        workspace_file = user_folder / f"workspace_{workspace_id}.json"
        workspace.serialize(workspace_file)

    def _load(self, user_id: str, workspace_id: str) -> Workspace | None:
        if not Workspace:
            return None
        user_folder = get_user_workspace_folder(user_id)
        workspace_file = user_folder / f"workspace_{workspace_id}.json"
        if not workspace_file.exists():
            print(f"Workspace file not found: {workspace_file}")
            return None
        try:
            print(f"Attempting to load workspace {workspace_id} from {workspace_file}")
            ws = Workspace.deserialize(workspace_file)
            if ws is not None:
                self._ensure_analysis_state(user_id, workspace_id)
            return ws
        except Exception as e:  # pragma: no cover
            print(
                f"Failed to deserialize workspace {workspace_id} from {workspace_file}: {e}"
            )
            # Try to get more specific error info
            try:
                with open(workspace_file, "r") as f:
                    content = f.read()
                    print(f"Workspace file size: {len(content)} bytes")
                    if len(content) > 1000:
                        print(f"First 500 chars: {content[:500]!r}")
                        print(f"Last 500 chars: {content[-500:]!r}")
                    else:
                        print(f"Full content: {content!r}")
            except Exception as read_e:
                print(f"Could not read workspace file for debugging: {read_e}")
            return None

    def _replace_current(self, user_id: str, new_id: str, new_ws: Any):
        current_id, current_ws = self._get_current_entry(user_id)
        if current_id is not None and current_ws is not None:
            self._save(user_id, current_id, current_ws)
            # Don't drop analysis state when switching workspaces - analyses should
            # persist across workspace switches until explicitly cleared or unloaded
            # if current_id != new_id:
            #     self.drop_analysis_state(user_id, current_id)
        self._current[user_id] = {"id": new_id, "ws": new_ws}
        self._ensure_analysis_state(user_id, new_id)

    # ---------------- Public API ----------------
    def get_current_workspace_id(self, user_id: str) -> Optional[str]:
        cid, _ = self._get_current_entry(user_id)
        return cid

    def get_current_workspace(self, user_id: str) -> Optional[Any]:
        _, ws = self._get_current_entry(user_id)
        return ws

    def set_current_workspace(self, user_id: str, workspace_id: Optional[str]) -> bool:
        if workspace_id is None:
            cid, cws = self._get_current_entry(user_id)
            if cid and cws:
                self._save(user_id, cid, cws)
                self.drop_analysis_state(user_id, cid)
            self._current.pop(user_id, None)
            return True
        cid, cws = self._get_current_entry(user_id)
        if cid == workspace_id and cws is not None:
            self._ensure_analysis_state(user_id, workspace_id)
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
        cid, cws = self._get_current_entry(user_id)
        if cid is not None and cws is not None:
            self._save(user_id, cid, cws)
        ws = Workspace(name=name, data=data, data_name=data_name)
        wid = generate_workspace_id()
        now = datetime.now().isoformat()
        ws.set_metadata("id", wid)
        ws.set_metadata("description", description)
        ws.set_metadata("created_at", now)
        ws.set_metadata("modified_at", now)
        self._save(user_id, wid, ws)
        self._current[user_id] = {"id": wid, "ws": ws}
        self._ensure_analysis_state(user_id, wid)
        return ws

    def get_workspace(self, user_id: str, workspace_id: str) -> Optional[Any]:
        cid, cws = self._get_current_entry(user_id)
        if cid == workspace_id:
            if cws is not None:
                self._ensure_analysis_state(user_id, workspace_id)
            return cws
        ws = self._load(user_id, workspace_id)
        if not ws:
            return None
        self._replace_current(user_id, workspace_id, ws)
        return ws

    def list_user_workspaces(self, user_id: str) -> Dict[str, Any]:
        cid, cws = self._get_current_entry(user_id)
        if cid and cws:
            return {cid: cws}
        return {}

    def list_user_workspaces_summaries(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        summaries: Dict[str, Dict[str, Any]] = {}
        cid, cws = self._get_current_entry(user_id)
        user_folder = get_user_workspace_folder(user_id)
        if not user_folder.exists():
            return summaries
        for wf in user_folder.glob("workspace_*.json"):
            wid = wf.stem.replace("workspace_", "")
            if wid == cid and cws is not None:
                target = cws
            else:
                target = self._load(user_id, wid)
            if not target:
                continue
            try:
                summary = target.summary()
                summaries[wid] = {
                    "workspace_id": wid,
                    "name": getattr(target, "name", wid),
                    "description": target.get_metadata("description") or "",
                    "created_at": target.get_metadata("created_at") or "",
                    "modified_at": target.get_metadata("modified_at") or "",
                    "file_size": wf.stat().st_size,
                    "node_count": summary.get("total_nodes"),
                    "root_nodes": summary.get("root_nodes"),
                    "leaf_nodes": summary.get("leaf_nodes"),
                    "node_types": summary.get("node_types"),
                }
            except Exception:
                summaries[wid] = {"workspace_id": wid, "error": "summary_failed"}
            if wid != cid:
                del target
        return summaries

    def delete_workspace(self, user_id: str, workspace_id: str) -> bool:
        cid, cws = self._get_current_entry(user_id)
        if cid == workspace_id and cws is not None:
            try:
                self._save(user_id, cid, cws)
            except Exception:
                pass
            self._current.pop(user_id, None)
            self.drop_analysis_state(user_id, cid)
        user_folder = get_user_workspace_folder(user_id)
        wf = user_folder / f"workspace_{workspace_id}.json"
        if wf.exists():
            wf.unlink()
            self.drop_analysis_state(user_id, workspace_id)
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

    def unload_workspace(self, user_id: str, save: bool = True) -> bool:
        cid, cws = self._get_current_entry(user_id)
        if not cid or not cws:
            return False
        if save:
            self._save(user_id, cid, cws)
        self._current.pop(user_id, None)
        self.drop_analysis_state(user_id, cid)
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
        if ws is None or Node is None:
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
