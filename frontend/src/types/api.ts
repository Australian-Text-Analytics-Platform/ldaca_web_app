/**
 * API response/request types shared across hooks and feature modules.
 *
 * Scope:
 * - Workspace listing and graph shapes consumed by multiple features.
 * - Generic node-data pagination used by the data-view table.
 *
 * Not in scope:
 * - Per-operation request/response types live with their feature
 *   (e.g. `features/preprocessing/types`) or the API client.
 */

// ---------- Workspace listing ----------

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string;
  created_at: string;
  modified_at: string;
  total_nodes: number;
  dataframe_count?: number;
  updated_at?: string;
  workspace_size_Byte?: number;
}

// ---------- Node data (paginated table view) ----------

export interface NodeDataPagination {
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  [key: string]: unknown;
}

export interface NodeDataResponse {
  data: Record<string, unknown>[];
  pagination: NodeDataPagination;
  columns: string[];
  dtypes: Record<string, string>;
  [key: string]: unknown;
}

// ---------- Workspace graph ----------

export interface GraphNode {
  id: string;
  name: string;
  operation: string;
  shape?: [number, number] | [number | null, number | null] | number[];
  [key: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface WorkspaceGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
