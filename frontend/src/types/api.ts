import type {
  PaginationInfo,
  NodeDataResponse as GeneratedNodeDataResponse,
  WorkspaceGraphEdge as GeneratedWorkspaceGraphEdge,
  WorkspaceGraphResponse as GeneratedWorkspaceGraphResponse,
  WorkspaceNodeInfo as GeneratedWorkspaceNodeInfo,
} from '@/api/generated/types.gen';

// ---------- Node data (paginated table view) ----------

export type NodeDataPagination = PaginationInfo;

export type NodeDataResponse = GeneratedNodeDataResponse;

// ---------- Workspace graph ----------

export type GraphNode = GeneratedWorkspaceNodeInfo;

export type GraphEdge = GeneratedWorkspaceGraphEdge;

export type WorkspaceGraphResponse = GeneratedWorkspaceGraphResponse;
