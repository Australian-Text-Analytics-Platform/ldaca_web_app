/**
 * Shared app-level types.
 *
 * Kept intentionally small; most request/response shapes live in generated
 * API types or backend adapters under `src/lib/backend/`. Add a type here only if it is
 * used by at least two consumers across feature boundaries.
 */

// ---------- Auth ----------

export interface User {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  is_active?: boolean;
  is_verified?: boolean;
  created_at?: string;
  last_login?: string;
}

export interface AuthMethod {
  name: string;
  display_name: string;
  enabled: boolean;
}

/** GET /auth/ payload — hydrates useAuth, gates startup flows. */
export interface AuthInfoResponse {
  authenticated: boolean;
  user: User | null;
  available_auth_methods: AuthMethod[];
  requires_authentication: boolean;
  /** Only present in single-user mode. */
  data_folder?: string;
}

// ---------- Files ----------

export type {
  FileTreeFile,
  FileTreeDirectory,
  FileTreeNode,
} from '../lib/backend/files';

// ---------- Workspace / Node ----------

export type NodeShape = [number | null, number | null];

/**
 * Rich node shape used by the workspace graph/table view. The backend may
 * attach extra per-operation fields, hence the index signature.
 */
export interface WorkspaceNode {
  node_id: string;
  name: string;
  shape: NodeShape;
  columns: string[];
  preview: Record<string, unknown>[];
  is_text_data: boolean;
  can_undo?: boolean;
  can_redo?: boolean;
  data_type?: string;
  column_schema?: Record<string, string>;
  dtypes?: Record<string, string>;
  /** Per-tokenisation metadata keyed by source column. */
  tokenization?: Record<string, TokenizationMeta>;
  [key: string]: unknown;
}

/** Metadata for one source column's tokenisation spec. */
export interface TokenizationMeta {
  column_name: string;
  model: string;
  language: string | null;
  params?: Record<string, unknown>;
}

export interface NodeSchemaResponse {
  node_id: string;
  schema: Record<string, string>;
  columns: string[];
  column_types: Record<string, string>;
  is_text_data: boolean;
  document_column?: string;
}
