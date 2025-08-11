"""
Thin workspace manager for multi-user DocWorkspace integration.

This manager only handles:
1. User session management (multiple users, workspace isolation)
2. Disk persistence (save/load workspace state)
3. Simple delegation to DocWorkspace methods

All workspace business logic is handled by DocWorkspace directly.
"""

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Union

import polars as pl
from core.utils import (
    DOCWORKSPACE_AVAILABLE,
    generate_workspace_id,
    get_user_workspace_folder,
)

# Import DocWorkspace components if available
if DOCWORKSPACE_AVAILABLE:
    try:
        from docworkspace import Node, Workspace
    except ImportError:
        Node = None
        Workspace = None
else:
    Node = None
    Workspace = None


class WorkspaceManager:
    """
    Thin manager for multi-user DocWorkspace sessions.

    Delegates all workspace operations to DocWorkspace methods.
    Only handles user sessions and persistence.
    """

    def __init__(self):
        if not DOCWORKSPACE_AVAILABLE:
            raise ImportError("DocWorkspace library is required but not available")

        # Simple session management - user_id -> Dict[workspace_id, Workspace]
        self._user_sessions: Dict[str, Dict[str, Any]] = {}
        # Track user current workspace - user_id -> workspace_id
        self._user_current: Dict[str, Optional[str]] = {}

    # ============================================================================
    # SESSION MANAGEMENT - Only thing this class actually manages
    # ============================================================================

    def _get_user_session(self, user_id: str) -> Dict[str, Any]:
        """Get or create user's workspace session"""
        if user_id not in self._user_sessions:
            self._user_sessions[user_id] = {}
        return self._user_sessions[user_id]

    def get_current_workspace_id(self, user_id: str) -> Optional[str]:
        """Get user's current workspace ID"""
        return self._user_current.get(user_id)

    def set_current_workspace(self, user_id: str, workspace_id: Optional[str]) -> bool:
        """Set user's current workspace"""
        if workspace_id is None:
            self._user_current[user_id] = None
            return True

        # Verify workspace exists
        session = self._get_user_session(user_id)
        if workspace_id not in session:
            return False

        self._user_current[user_id] = workspace_id
        return True

    def get_current_workspace(self, user_id: str) -> Optional[Any]:
        """Get user's current workspace object"""
        workspace_id = self.get_current_workspace_id(user_id)
        if not workspace_id:
            return None
        return self.get_workspace(user_id, workspace_id)

    # ============================================================================
    # WORKSPACE OPERATIONS - Direct delegation to DocWorkspace
    # ============================================================================

    def create_workspace(
        self,
        user_id: str,
        name: str,
        description: str = "",
        data: Optional[Union[str, Path, pl.DataFrame, pl.LazyFrame]] = None,
        data_name: Optional[str] = None,
    ) -> Any:
        """Create workspace using DocWorkspace constructor"""
        if not DOCWORKSPACE_AVAILABLE or Workspace is None:
            raise RuntimeError("DocWorkspace not available")

        # Use DocWorkspace constructor directly
        workspace = Workspace(name=name, data=data, data_name=data_name)

        # Add metadata for web app compatibility
        workspace_id = generate_workspace_id()
        workspace.set_metadata("id", workspace_id)
        workspace.set_metadata("description", description)
        workspace.set_metadata("created_at", datetime.now().isoformat())
        workspace.set_metadata("modified_at", datetime.now().isoformat())

        # Add to user session
        session = self._get_user_session(user_id)
        session[workspace_id] = workspace

        # Set as current if first workspace
        if not self.get_current_workspace_id(user_id):
            self.set_current_workspace(user_id, workspace_id)

        # Save to disk
        self._save_workspace_to_disk(user_id, workspace_id, workspace)

        return workspace

    def get_workspace(self, user_id: str, workspace_id: str) -> Optional[Any]:
        """Get workspace, loading from disk if needed"""
        session = self._get_user_session(user_id)

        if workspace_id not in session:
            # Try to load from disk
            workspace = self._load_workspace_from_disk(user_id, workspace_id)
            if workspace:
                session[workspace_id] = workspace
            else:
                return None

        return session[workspace_id]

    def list_user_workspaces(self, user_id: str) -> Dict[str, Any]:
        """List all workspaces for user"""
        session = self._get_user_session(user_id)

        # Load any workspaces from disk that aren't in session
        user_folder = get_user_workspace_folder(user_id)
        if user_folder.exists():
            for workspace_file in user_folder.glob("workspace_*.json"):
                workspace_id = workspace_file.stem.replace("workspace_", "")
                if workspace_id not in session:
                    workspace = self._load_workspace_from_disk(user_id, workspace_id)
                    if workspace:
                        session[workspace_id] = workspace

        return session

    def delete_workspace(self, user_id: str, workspace_id: str) -> bool:
        """Delete workspace from session and disk"""
        session = self._get_user_session(user_id)

        # Remove from session
        if workspace_id in session:
            del session[workspace_id]

        # Clear current if this was current
        if self.get_current_workspace_id(user_id) == workspace_id:
            self.set_current_workspace(user_id, None)

        # Remove from disk
        user_folder = get_user_workspace_folder(user_id)
        workspace_file = user_folder / f"workspace_{workspace_id}.json"
        if workspace_file.exists():
            workspace_file.unlink()
            return True

        return False

    def unload_workspace(
        self, user_id: str, workspace_id: str, save: bool = True
    ) -> bool:
        """Persist (optional) then remove a workspace from in-memory session.

        After unloading, subsequent access will lazy-load from disk via
        get_workspace(). This helps reduce memory footprint for large
        workspaces while keeping on-disk state authoritative.

        Returns True if the workspace was in memory (and is now removed) or
        if it was already absent but a persisted file exists. Returns False
        only if neither an in-memory instance nor a persisted file exists.
        """
        session = self._get_user_session(user_id)

        # If workspace currently in memory, optionally save then drop
        if workspace_id in session:
            workspace = session[workspace_id]
            if save:
                try:
                    self._save_workspace_to_disk(user_id, workspace_id, workspace)
                except Exception:
                    # Don't block unload on save failure; still attempt removal
                    import traceback

                    print(
                        f"Warning: failed to save workspace {workspace_id} before unload"
                    )
                    traceback.print_exc()
            del session[workspace_id]
            # Clear current pointer if it referenced this workspace
            if self.get_current_workspace_id(user_id) == workspace_id:
                self.set_current_workspace(user_id, None)
            return True

        # Not in memory: treat as success if on-disk file exists
        user_folder = get_user_workspace_folder(user_id)
        workspace_file = user_folder / f"workspace_{workspace_id}.json"
        if workspace_file.exists():
            # Already effectively unloaded
            if self.get_current_workspace_id(user_id) == workspace_id:
                self.set_current_workspace(user_id, None)
            return True
        return False

    # ============================================================================
    # NODE OPERATIONS - Direct delegation to DocWorkspace methods
    # ============================================================================

    def add_node_to_workspace(
        self,
        user_id: str,
        workspace_id: str,
        data: Any,
        node_name: str,
        operation: str = "manual_add",
        parents: Optional[list[Any]] = None,
    ) -> Optional[Any]:
        """Add node to workspace using DocWorkspace methods.

        parents: Optional list of parent Node(s) to establish graph relationships.
        When provided, the created node will be connected to these parents and
        edges will be visible in the workspace graph API.
        """
        workspace = self.get_workspace(user_id, workspace_id)

        if workspace is None or Node is None:
            return None

        try:
            # Use DocWorkspace Node constructor directly
            node = Node(
                data=data,  # Node itself validates supported types (incl. Doc*Frame)
                name=node_name,
                workspace=workspace,
                parents=parents or [],
                operation=operation,
            )

            # DocWorkspace automatically handles adding to workspace
            # Just save to disk and return
            self._save_workspace_to_disk(user_id, workspace_id, workspace)
            return node
        except Exception as e:
            print(f"Error creating node: {e}")
            import traceback

            traceback.print_exc()
            return None

    def get_node_from_workspace(
        self, user_id: str, workspace_id: str, node_id: str
    ) -> Optional[Any]:
        """Get node from workspace using DocWorkspace methods"""
        workspace = self.get_workspace(user_id, workspace_id)
        if workspace is None:
            return None

        # Direct delegation to DocWorkspace
        return workspace.get_node(node_id)

    def delete_node_from_workspace(
        self, user_id: str, workspace_id: str, node_id: str
    ) -> bool:
        """Delete node using DocWorkspace methods"""
        workspace = self.get_workspace(user_id, workspace_id)
        if workspace is None:
            return False

        # Use DocWorkspace remove_node method directly
        success = workspace.remove_node(node_id)
        if success:
            self._save_workspace_to_disk(user_id, workspace_id, workspace)

        return success

    # ============================================================================
    # API DELEGATION - Direct pass-through to DocWorkspace methods
    # ============================================================================

    def get_workspace_graph(
        self, user_id: str, workspace_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get React Flow graph using DocWorkspace to_api_graph method"""
        workspace = self.get_workspace(user_id, workspace_id)
        if workspace is None:
            return None

        # Prefer DocWorkspace API extension method; fall back to built-ins
        if hasattr(workspace, "to_api_graph"):
            graph_result = workspace.to_api_graph()
        elif hasattr(workspace, "to_react_flow_json"):
            graph_result = workspace.to_react_flow_json()
        else:
            # Last resort: use generic graph structure
            graph_result = workspace.graph()  # type: ignore[attr-defined]

        # Convert Pydantic WorkspaceGraph object to dictionary for frontend compatibility
        if hasattr(graph_result, "model_dump"):
            result = graph_result.model_dump()
        else:
            # Fallback for older Pydantic versions
            result = (
                graph_result.dict() if hasattr(graph_result, "dict") else graph_result
            )

        return result

    def get_node_summaries(self, user_id: str, workspace_id: str) -> list:
        """Get node summaries using DocWorkspace get_node_summaries method"""
        workspace = self.get_workspace(user_id, workspace_id)
        if workspace is None:
            return []

        # Direct delegation to DocWorkspace API method
        return workspace.get_node_summaries()

    def get_workspace_info(
        self, user_id: str, workspace_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get workspace info using DocWorkspace summary method"""
        workspace = self.get_workspace(user_id, workspace_id)
        if workspace is None:
            return None

        # Use DocWorkspace summary method + metadata
        summary = workspace.summary()

        return {
            "workspace_id": workspace_id,
            "name": workspace.name,
            "description": workspace.get_metadata("description") or "",
            "created_at": workspace.get_metadata("created_at") or "",
            "modified_at": workspace.get_metadata("modified_at") or "",
            "total_nodes": summary["total_nodes"],
            "root_nodes": summary["root_nodes"],
            "leaf_nodes": summary["leaf_nodes"],
            "node_types": summary["node_types"],
            "status_counts": summary["status_counts"],
        }

    def execute_safe_operation(
        self, user_id: str, workspace_id: str, operation_func, *args, **kwargs
    ):
        """Execute operation safely using DocWorkspace safe_operation method"""
        workspace = self.get_workspace(user_id, workspace_id)
        if workspace is None:
            return {"success": False, "message": "Workspace not found"}

        # Direct delegation to DocWorkspace safe operation method
        result = workspace.safe_operation(operation_func, *args, **kwargs)

        # Save workspace after operation
        self._save_workspace_to_disk(user_id, workspace_id, workspace)

        return result

    # Small public helper to persist after in-place mutations
    def persist(self, user_id: str, workspace_id: str) -> None:
        workspace = self.get_workspace(user_id, workspace_id)
        if workspace is not None:
            self._save_workspace_to_disk(user_id, workspace_id, workspace)

    # ============================================================================
    # DISK PERSISTENCE - Only other thing this class manages
    # ============================================================================

    def _save_workspace_to_disk(
        self, user_id: str, workspace_id: str, workspace: Any
    ) -> None:
        """Save workspace to disk using DocWorkspace serialization"""
        user_folder = get_user_workspace_folder(user_id)
        user_folder.mkdir(parents=True, exist_ok=True)

        workspace_file = user_folder / f"workspace_{workspace_id}.json"

        # Update modified timestamp
        workspace.set_metadata("modified_at", datetime.now().isoformat())

        # Use DocWorkspace serialization directly
        workspace.serialize(workspace_file)

    def _load_workspace_from_disk(
        self, user_id: str, workspace_id: str
    ) -> Optional[Any]:
        """Load workspace from disk using DocWorkspace deserialization"""
        if not Workspace:
            return None

        user_folder = get_user_workspace_folder(user_id)
        workspace_file = user_folder / f"workspace_{workspace_id}.json"

        if not workspace_file.exists():
            return None

        try:
            # Use DocWorkspace deserialization directly
            workspace = Workspace.deserialize(workspace_file)
            return workspace
        except Exception as e:
            print(f"Failed to load workspace {workspace_id}: {e}")
            return None


# Global instance - single point of access
workspace_manager = WorkspaceManager()
