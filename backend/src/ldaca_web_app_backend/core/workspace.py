"""Simplified Workspace Manager (single in-memory workspace per user).

Design Goals:
* Each user can have many persisted workspaces on disk.
* At most ONE workspace object is resident in memory per user at any time.
* Switching workspaces always saves & unloads the previous one before loading the next.
* Business logic remains in docworkspace.Workspace / Node; this is only orchestration.
* Backward compatibility deliberately dropped.
"""

import json
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from docworkspace import Workspace  # type: ignore
from docworkspace.workspace.io import read_workspace_metadata

from ldaca_web_app_backend.models import WorkspaceSummary

from .utils import (
    allocate_workspace_folder,
    ensure_display_folder_name,
    get_user_workspace_folder,
)

logger = logging.getLogger(__name__)


class WorkspaceManager:
    """Single-workspace-per-user in-memory manager."""

    def __init__(self) -> None:
        self._current: Dict[str, Dict[str, Any]] = {}
        # Per-user task managers (single channel per user, not serialized)
        self._task_managers: Dict[str, Any] = {}
        # Track on-disk workspace folder paths per user/workspace
        self._paths: Dict[tuple[str, str], Path] = {}

    # ---------------- Core helpers ----------------
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
            setattr(workspace, "ws_root_dir", path)
        except Exception as exc:
            logger.debug(
                "Failed to attach workspace_dir metadata to workspace object: %s", exc
            )

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
        entry = self._current.get(user_id)
        if not entry:
            return None
        return entry.get("wid")

    def get_current_workspace(self, user_id: str) -> Optional[Any]:
        entry = self._current.get(user_id)
        if not entry:
            return None
        return entry.get("workspace")

    def get_current_workspace_path(self, user_id: str) -> Optional[Path]:
        entry = self._current.get(user_id)
        if not entry:
            return None
        return entry.get("path")

    def set_current_workspace(self, user_id: str, workspace_id: Optional[str]) -> bool:
        if workspace_id is None:
            self.unload_workspace(user_id, save=True)
            return True
        cid = self.get_current_workspace_id(user_id)
        cws = self.get_current_workspace(user_id)
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
            "wid": workspace_id,
            "workspace": new_ws,
            "path": current_path,
        }
        self.ensure_workspace_artifacts_dir(user_id, workspace_id)
        return True

    def list_user_workspaces_summaries(self, user_id: str) -> list[dict[str, Any]]:
        summaries: list[dict[str, Any]] = []
        # Active refresh point: called when Data Loader opens and when user presses refresh.
        self._refresh_user_workspace_paths(user_id)

        user_workspace_items = [
            (wid, path)
            for (uid, wid), path in self._paths.items()
            if uid == user_id and path.exists()
        ]

        def _workspace_size_bytes(workspace_dir: Path) -> int:
            total = 0
            for file_path in workspace_dir.rglob("*"):
                if not file_path.is_file():
                    continue
                try:
                    total += file_path.stat().st_size
                except Exception:
                    continue
            return total

        for wid, workspace_dir in user_workspace_items:
            workspace_size_byte = _workspace_size_bytes(workspace_dir)
            folder_name = workspace_dir.name

            try:
                ws = Workspace.load(workspace_dir)
                summary_payload = WorkspaceSummary(**ws.info_json()).model_dump()
                summary_payload["workspace_size_Byte"] = workspace_size_byte
                summary_payload["workspace_size_byte"] = workspace_size_byte
                summary_payload["folder_name"] = folder_name
                summaries.append(summary_payload)
            except Exception:
                try:
                    metadata = read_workspace_metadata(workspace_dir)[
                        "workspace_metadata"
                    ]
                    summary_payload = WorkspaceSummary(**metadata).model_dump()
                    summary_payload["workspace_size_Byte"] = workspace_size_byte
                    summary_payload["folder_name"] = folder_name
                    summaries.append(summary_payload)
                except Exception:
                    continue
        return summaries

    def delete_workspace(self, user_id: str, workspace_id: str) -> bool:
        cid = self.get_current_workspace_id(user_id)
        cws = self.get_current_workspace(user_id)
        if cid == workspace_id and cws is not None:
            try:
                cws.modified_at = datetime.now().isoformat()
                target_dir = self._resolve_workspace_dir(
                    user_id=user_id,
                    workspace_id=cid,
                    workspace_name=cws.name,
                )
                self._attach_workspace_dir(cws, target_dir)
                cws.save(target_dir)
                self._set_cached_path(user_id, cid, target_dir)
            except Exception as exc:
                logger.debug(
                    "Best-effort save before delete failed for workspace %s: %s",
                    workspace_id,
                    exc,
                )
            self._current.pop(user_id, None)
        target_dir = self._get_indexed_path(user_id, workspace_id)
        if target_dir and target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
            self._paths.pop(self._path_key(user_id, workspace_id), None)
            return True
        return False

    def get_task_manager(self, user_id: str):
        """Return or create worker-task manager bound to user.

        Used by:
        - task endpoints and analysis routes submitting background work

                Why:
                - Uses one unified task channel per user while retaining workspace
                    filtering at API/query level via task metadata.

        Refactor note:
        - Lazy import avoids cycles but obscures typing; introducing a protocol or
            factory module could reduce import indirection.
        """
        from ldaca_web_app_backend.core.worker_task_manager import WorkerTaskManager

        tm = self._task_managers.get(user_id)
        if tm is None:
            tm = WorkerTaskManager()
            self._task_managers[user_id] = tm
        return tm

    def get_workspace_dir(self, user_id: str, workspace_id: str) -> Optional[Path]:
        cached = self._get_indexed_path(user_id, workspace_id)
        if cached is None:
            self._refresh_user_workspace_paths(user_id)
            cached = self._get_indexed_path(user_id, workspace_id)
        if cached and cached.exists():
            cid = self.get_current_workspace_id(user_id)
            cws = self.get_current_workspace(user_id)
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
        cid = self.get_current_workspace_id(user_id)
        cws = self.get_current_workspace(user_id)
        if not cid or not cws:
            return False
        if workspace_id is not None and workspace_id != cid:
            return False
        if save:
            cws.modified_at = datetime.now().isoformat()
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


workspace_manager = WorkspaceManager()
