"""Simplified Workspace Manager (single in-memory workspace per user).

Design Goals:
* Each user can have many persisted workspaces on disk.
* At most ONE workspace object is resident in memory per user at any time.
* Switching workspaces always saves & unloads the previous one before loading the next.
* Business logic remains in docworkspace.Workspace / Node; this is only orchestration.
* Backward compatibility deliberately dropped.
"""

import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import polars as pl
from docworkspace import Node, Workspace  # type: ignore

from .docworkspace_api import DocWorkspaceAPIUtils
from .utils import (
    allocate_workspace_folder,
    ensure_display_folder_name,
    get_user_workspace_folder,
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

    def _clear_user_cached_paths(self, user_id: str) -> None:
        """Remove all cached workspace-folder mappings for a user."""
        keys = [key for key in self._paths.keys() if key[0] == user_id]
        for key in keys:
            self._paths.pop(key, None)

    def _refresh_user_workspace_paths(self, user_id: str) -> None:
        """Actively rescan user workspace folders and rebuild id->path cache."""
        self._clear_user_cached_paths(user_id)
        user_folder = get_user_workspace_folder(user_id)
        if not user_folder.exists():
            return

        for workspace_dir in user_folder.iterdir():
            if not workspace_dir.is_dir():
                continue

            metadata_path = workspace_dir / "metadata.json"
            if not metadata_path.exists() or not metadata_path.is_file():
                continue

            try:
                with metadata_path.open("r", encoding="utf-8") as f:
                    raw = json.load(f)
            except Exception:
                continue

            wid = raw.get("workspace_metadata", {}).get("id")
            if wid:
                self._set_cached_path(user_id, wid, workspace_dir)

    def _get_indexed_path(self, user_id: str, workspace_id: str) -> Optional[Path]:
        """Get workspace folder from cache only (no active directory scans)."""
        cached = self._get_cached_path(user_id, workspace_id)
        if cached and cached.exists():
            return cached
        return None

    def _attach_workspace_dir(self, workspace: Workspace, path: Path) -> None:
        try:
            setattr(workspace, "_workspace_dir", path)
        except Exception:
            pass

    def _set_working_dir(self, path: Path) -> None:
        try:
            path.mkdir(parents=True, exist_ok=True)
            os.chdir(path)
        except Exception as exc:  # pragma: no cover
            print(f"Failed to set working directory to {path}: {exc}")

    def _workspace_artifacts_dir_from_workspace_dir(self, workspace_dir: Path) -> Path:
        """Return workspace-scoped analysis artifact directory.

        Artifact files are transient analysis outputs and are intentionally kept
        outside workspace payload files while still colocated with workspace data.
        """
        return workspace_dir / "data" / "artifacts"

    def _resolve_workspace_dir(
        self, user_id: str, workspace_id: str, workspace_name: str
    ) -> Path:
        """Resolve or allocate on-disk folder for a workspace id/name.

        Used by:
        - workspace persistence operations

        Why:
        - Keeps workspace folder naming consistent and discoverable on disk.
        """
        cached = self._get_indexed_path(user_id, workspace_id)
        if cached and cached.exists():
            updated = ensure_display_folder_name(cached, workspace_name)
            self._set_cached_path(user_id, workspace_id, updated)
            return updated

        # Allocate a new folder when none exists
        allocated = allocate_workspace_folder(user_id, workspace_name)
        self._set_cached_path(user_id, workspace_id, allocated)
        return allocated

    # ---------------- Public API ----------------
    def get_current_workspace_id(self, user_id: str) -> Optional[str]:
        cid, _, _ = self._get_current_entry(user_id)
        return cid

    def get_current_workspace(self, user_id: str) -> Optional[Any]:
        _, ws, _ = self._get_current_entry(user_id)
        return ws

    def set_current_workspace(self, user_id: str, workspace_id: Optional[str]) -> bool:
        if workspace_id is None:
            self.unload_workspace(user_id, save=True)
            return True
        cid, cws, _ = self._get_current_entry(user_id)
        if cid == workspace_id and cws is not None:
            return True
        if cid is not None and cws is not None:
            # Strict switch behavior: always unload current before loading next.
            self.unload_workspace(user_id, save=True)
        target_dir = self._get_indexed_path(user_id, workspace_id)
        if target_dir is None:
            print(
                f"Workspace folder not found for workspace {workspace_id} under user {user_id}"
            )
            return False
        try:
            new_ws = Workspace.load(target_dir)
            updated_dir = ensure_display_folder_name(target_dir, new_ws.name)
            self._attach_workspace_dir(new_ws, updated_dir)
            self._set_working_dir(updated_dir)
            self._set_cached_path(user_id, workspace_id, updated_dir)
        except Exception as e:  # pragma: no cover
            print(
                f"Failed to deserialize workspace {workspace_id} from {target_dir}: {e}"
            )
            return False
        if not new_ws:
            return False
        current_path = self._get_cached_path(user_id, workspace_id)
        self._current[user_id] = {
            "id": workspace_id,
            "ws": new_ws,
            "path": current_path,
        }
        self.ensure_workspace_artifacts_dir(user_id, workspace_id)
        return True

    def get_workspace(self, user_id: str, workspace_id: str) -> Optional[Any]:
        cid, cws, _ = self._get_current_entry(user_id)
        if cid == workspace_id:
            if cws is not None:
                cached = self._get_cached_path(user_id, workspace_id)
                if cached:
                    self._attach_workspace_dir(cws, cached)
                    self._set_working_dir(cached)
                    self.ensure_workspace_artifacts_dir(user_id, workspace_id)
            return cws
        if not self.set_current_workspace(user_id, workspace_id):
            return None
        _, ws, _ = self._get_current_entry(user_id)
        return ws

    def list_user_workspaces_summaries(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        summaries: Dict[str, Dict[str, Any]] = {}
        cid, cws, _ = self._get_current_entry(user_id)
        # Active refresh point: called when Data Loader opens and when user presses refresh.
        self._refresh_user_workspace_paths(user_id)

        user_workspace_items = [
            (wid, path)
            for (uid, wid), path in self._paths.items()
            if uid == user_id and path.exists()
        ]

        for wid, workspace_dir in user_workspace_items:
            if wid == cid and cws is not None:
                target = cws
            else:
                try:
                    target = Workspace.load(workspace_dir)
                    updated_dir = ensure_display_folder_name(workspace_dir, target.name)
                    self._attach_workspace_dir(target, updated_dir)
                    self._set_cached_path(user_id, wid, updated_dir)
                except Exception:
                    target = None
            if not target:
                continue
            try:
                summary = target.summary()
                cached_path = workspace_dir
                workspace_size_Byte = 0
                try:
                    for file_path in cached_path.rglob("*"):
                        if file_path.is_file():
                            workspace_size_Byte += file_path.stat().st_size
                except Exception:
                    workspace_size_Byte = 0
                summaries[wid] = {
                    "workspace_id": wid,
                    "name": getattr(target, "name", wid),
                    "description": target.get_metadata("description") or "",
                    "created_at": target.get_metadata("created_at") or "",
                    "modified_at": target.get_metadata("modified_at") or "",
                    "node_count": summary.get("total_nodes"),
                    "workspace_size_Byte": workspace_size_Byte,
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
                cws.set_metadata("modified_at", datetime.now().isoformat())
                target_dir = self._resolve_workspace_dir(
                    user_id=user_id,
                    workspace_id=cid,
                    workspace_name=cws.name,
                )
                self._attach_workspace_dir(cws, target_dir)
                cws.save(target_dir)
                self._set_cached_path(user_id, cid, target_dir)
            except Exception:
                pass
            self._current.pop(user_id, None)
        target_dir = self._get_indexed_path(user_id, workspace_id)
        if target_dir and target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
            self._paths.pop(self._path_key(user_id, workspace_id), None)
            return True
        return False

    def get_task_manager(self, user_id: str, workspace_id: str):
        """Return or create worker-task manager bound to user/workspace key.

        Used by:
        - task endpoints and analysis routes submitting background work

        Why:
        - Keeps worker task tracking isolated by workspace scope.

        Refactor note:
        - Lazy import avoids cycles but obscures typing; introducing a protocol or
            factory module could reduce import indirection.
        """
        from ldaca_web_app_backend.core.worker_task_manager import WorkerTaskManager

        key = (user_id, workspace_id)
        tm = self._task_managers.get(key)
        if tm is None:
            tm = WorkerTaskManager()
            self._task_managers[key] = tm
        return tm

    def list_user_task_scopes(self, user_id: str) -> list[str]:
        """List workspace/task scopes that currently have task manager instances.

        Includes any already-created task managers for this user plus the current
        workspace (if set) so callers can proactively subscribe.
        """
        scopes = {
            workspace_id
            for (uid, workspace_id) in self._task_managers.keys()
            if uid == user_id
        }
        current_workspace_id = self.get_current_workspace_id(user_id)
        if current_workspace_id:
            scopes.add(current_workspace_id)
        return sorted(scopes)

    def get_workspace_dir(self, user_id: str, workspace_id: str) -> Optional[Path]:
        cached = self._get_indexed_path(user_id, workspace_id)
        if cached is None:
            self._refresh_user_workspace_paths(user_id)
            cached = self._get_indexed_path(user_id, workspace_id)
        if cached and cached.exists():
            cid, cws, _ = self._get_current_entry(user_id)
            if cid == workspace_id and cws is not None:
                self._attach_workspace_dir(cws, cached)
            return cached
        return None

    def get_workspace_artifacts_dir(
        self, user_id: str, workspace_id: str
    ) -> Optional[Path]:
        """Get workspace analysis artifact directory path (without creating it)."""
        workspace_dir = self.get_workspace_dir(user_id, workspace_id)
        if workspace_dir is None:
            return None
        return self._workspace_artifacts_dir_from_workspace_dir(workspace_dir)

    def ensure_workspace_artifacts_dir(
        self, user_id: str, workspace_id: str
    ) -> Optional[Path]:
        """Create workspace analysis artifact directory if missing.

        Called on workspace load/switch to guarantee a dedicated transient
        artifact location exists for background analysis tasks.
        """
        artifact_dir = self.get_workspace_artifacts_dir(user_id, workspace_id)
        if artifact_dir is None:
            return None
        artifact_dir.mkdir(parents=True, exist_ok=True)
        return artifact_dir

    def clear_workspace_artifacts_dir(self, user_id: str, workspace_id: str) -> bool:
        """Delete workspace analysis artifact directory if it exists.

        Called on workspace unload to remove transient analysis artifacts.
        """
        artifact_dir = self.get_workspace_artifacts_dir(user_id, workspace_id)
        if artifact_dir is None or not artifact_dir.exists():
            return False
        shutil.rmtree(artifact_dir, ignore_errors=True)
        return True

    def unload_workspace(
        self,
        user_id: str,
        workspace_id: Optional[str] = None,
        save: bool = True,
    ) -> bool:
        """Unload current workspace object from memory, optionally persisting first.

        Used by:
        - lifecycle unload/switch operations

        Why:
        - Enforces one-active-workspace-per-user memory policy.
        """
        cid, cws, _ = self._get_current_entry(user_id)
        if not cid or not cws:
            return False
        if workspace_id is not None and workspace_id != cid:
            return False
        if save:
            cws.set_metadata("modified_at", datetime.now().isoformat())
            target_dir = self._resolve_workspace_dir(
                user_id=user_id,
                workspace_id=cid,
                workspace_name=cws.name,
            )
            self._attach_workspace_dir(cws, target_dir)
            cws.save(target_dir)
            self._set_cached_path(user_id, cid, target_dir)
        self.clear_workspace_artifacts_dir(user_id, cid)
        self._current.pop(user_id, None)
        return True

    # ---------------- Node operations ----------------
    def add_node_to_workspace(
        self,
        user_id: str,
        workspace_id: str,
        data: pl.LazyFrame,
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
            ws.set_metadata("modified_at", datetime.now().isoformat())
            target_dir = self._resolve_workspace_dir(
                user_id=user_id,
                workspace_id=workspace_id,
                workspace_name=ws.name,
            )
            self._attach_workspace_dir(ws, target_dir)
            ws.save(target_dir)
            self._set_cached_path(user_id, workspace_id, target_dir)
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
            ws.set_metadata("modified_at", datetime.now().isoformat())
            target_dir = self._resolve_workspace_dir(
                user_id=user_id,
                workspace_id=workspace_id,
                workspace_name=ws.name,
            )
            self._attach_workspace_dir(ws, target_dir)
            ws.save(target_dir)
            self._set_cached_path(user_id, workspace_id, target_dir)
        return success

    # ---------------- Graph / info operations ----------------
    def get_workspace_graph(
        self, user_id: str, workspace_id: str
    ) -> Optional[Dict[str, Any]]:
        ws = self.get_workspace(user_id, workspace_id)
        if ws is None:
            return None
        # Always use backend utility to produce API graph (no core monkey patching)
        graph = DocWorkspaceAPIUtils.workspace_to_ui_graph_payload(ws)
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
            DocWorkspaceAPIUtils.node_to_api_summary(node) for node in ws.nodes.values()
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


# Global singleton
workspace_manager = WorkspaceManager()
