"""Simplified Workspace Manager (single in-memory workspace per user).

Design Goals:
* Each user can have many persisted workspaces on disk.
* At most ONE workspace object is resident in memory per user at any time.
* Switching workspaces always saves & unloads the previous one before loading the next.
* Business logic remains in docworkspace.Workspace / Node; this is only orchestration.
* Backward compatibility deliberately dropped.
"""

from datetime import datetime
from typing import Any, Dict, Optional

from docworkspace import Node, Workspace  # type: ignore

from .utils import generate_workspace_id, get_user_workspace_folder


class WorkspaceManager:
    """Single-workspace-per-user in-memory manager."""

    def __init__(self) -> None:
        self._current: Dict[str, Dict[str, Any]] = {}

    # ---------------- Core helpers ----------------
    def _get_current_entry(self, user_id: str) -> tuple[Optional[str], Optional[Any]]:
        entry = self._current.get(user_id)
        if not entry:
            return None, None
        return entry.get("id"), entry.get("ws")

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
            return None
        try:
            return Workspace.deserialize(workspace_file)
        except Exception as e:  # pragma: no cover
            print(f"Failed to deserialize workspace {workspace_id}: {e}")
            return None

    def _replace_current(self, user_id: str, new_id: str, new_ws: Any) -> None:
        current_id, current_ws = self._get_current_entry(user_id)
        if current_id and current_ws and current_id != new_id:
            try:
                self._save(user_id, current_id, current_ws)
            except Exception as e:  # pragma: no cover
                print(f"Warning: failed to save previous workspace {current_id}: {e}")
        self._current[user_id] = {"id": new_id, "ws": new_ws}

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
            self._current.pop(user_id, None)
            return True
        cid, cws = self._get_current_entry(user_id)
        if cid == workspace_id and cws is not None:
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
    ) -> Any:
        cid, cws = self._get_current_entry(user_id)
        if cid is not None and cws is not None:
            self._save(user_id, cid, cws)
        # Create an empty Workspace (initial data loading removed)
        ws = Workspace(name=name, data=None, data_name=None)
        wid = generate_workspace_id()
        now = datetime.now().isoformat()
        ws.set_metadata("id", wid)
        ws.set_metadata("description", description)
        ws.set_metadata("created_at", now)
        ws.set_metadata("modified_at", now)
        self._save(user_id, wid, ws)
        self._current[user_id] = {"id": wid, "ws": ws}
        return ws

    def get_workspace(self, user_id: str, workspace_id: str) -> Optional[Any]:
        cid, cws = self._get_current_entry(user_id)
        if cid == workspace_id:
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
        user_folder = get_user_workspace_folder(user_id)
        wf = user_folder / f"workspace_{workspace_id}.json"
        if wf.exists():
            wf.unlink()
            return True
        return False

    def unload_workspace(self, user_id: str, save: bool = True) -> bool:
        cid, cws = self._get_current_entry(user_id)
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
        if hasattr(ws, "to_api_graph"):
            graph = ws.to_api_graph()
        elif hasattr(ws, "to_react_flow_json"):
            graph = ws.to_react_flow_json()
        else:
            graph = ws.graph()  # type: ignore[attr-defined]
        if hasattr(graph, "model_dump"):
            return graph.model_dump()
        if hasattr(graph, "dict"):
            return graph.dict()  # type: ignore
        return graph  # type: ignore

    def get_node_summaries(self, user_id: str, workspace_id: str) -> list:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            return []
        return ws.get_node_summaries()

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
        result = ws.safe_operation(operation_func, *args, **kwargs)
        self._save(user_id, workspace_id, ws)
        return result

    def persist(self, user_id: str, workspace_id: str) -> None:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is not None:
            self._save(user_id, workspace_id, ws)


# Global singleton
workspace_manager = WorkspaceManager()
