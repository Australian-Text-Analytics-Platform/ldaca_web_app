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
  sorting?: { sort_by: string | null; descending: boolean };
  filtering?: { column: string | null; value: string | null; op: string };
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

/**
 * State written by the backend's workspace-load tokens-cache repair pass.
 * Present in the graph response only when the most-recent load stubbed at
 * least one node's cache (i.e. cross-machine workspace transfer where the
 * receiver doesn't have the donor's cache files). Cleared automatically as
 * the user retokenises each listed node. See backend docs:
 * developer-guide/tokens-cache-portability.md.
 */
export interface TokensCacheRepairState {
  stubbed_node_ids: string[];
}

export interface WorkspaceGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tokens_cache_repair?: TokensCacheRepairState;
}
