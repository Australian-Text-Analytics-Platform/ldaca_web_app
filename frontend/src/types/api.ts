import type {
  PaginationInfo,
  NodeDataResponse as GeneratedNodeDataResponse,
  WorkspaceGraphEdge as GeneratedWorkspaceGraphEdge,
  WorkspaceGraphResponse as GeneratedWorkspaceGraphResponse,
  WorkspaceNodeInfo as GeneratedWorkspaceNodeInfo,
} from '@/api/generated/types.gen';

// ---------- Node data (paginated table view) ----------

/** Re-exported pagination envelope for table hooks that should not import generated paths directly. */
export type NodeDataPagination = PaginationInfo;

/** Paginated node-data response used by workspace tables and preprocessing previews. */
export type NodeDataResponse = GeneratedNodeDataResponse;

// ---------- Workspace graph ----------

/** Workspace graph node payload shared by graph, sidebar, and node metadata helpers. */
export type GraphNode = GeneratedWorkspaceNodeInfo;

/** Workspace graph edge payload shared by graph rendering and topology utilities. */
export type GraphEdge = GeneratedWorkspaceGraphEdge;

/** Full workspace graph envelope consumed by graph-query hooks. */
export type WorkspaceGraphResponse = GeneratedWorkspaceGraphResponse;
