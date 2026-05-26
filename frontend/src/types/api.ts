import type { PaginationInfo } from '@/api/generated/types.gen';

// ---------- Node data (paginated table view) ----------

export type NodeDataPagination = PaginationInfo;

export type NodeDataResponse = {
  data: Record<string, unknown>[];
  pagination: NodeDataPagination;
  columns: string[];
  dtypes: Record<string, string>;
  sorting?: { sort_by: string | null; descending: boolean };
  filtering?: { column: string | null; value: string | null; op: string };
  [key: string]: unknown;
};

// ---------- Workspace graph ----------

export type GraphNode = {
  id: string;
  name: string;
  operation: string;
  shape?: [number, number] | [number | null, number | null] | number[];
  [key: string]: unknown;
};

export type GraphEdge = {
  source: string;
  target: string;
};

export type WorkspaceGraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
