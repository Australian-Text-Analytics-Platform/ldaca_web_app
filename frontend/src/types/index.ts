/**
 * Shared app-level types.
 *
 * Kept intentionally small; most request/response shapes live in generated
 * API types or backend adapters under `src/lib/backend/`. Add a type here only if it is
 * used by at least two consumers across feature boundaries.
 */

export type { AuthInfoResponse, AuthMethod, User } from '@/api/generated/types.gen';
import type { FileTreeNodeResponse } from '@/api/generated/types.gen';

// ---------- Files ----------

export type FileTreeFile = Omit<FileTreeNodeResponse, 'children' | 'size' | 'type'> & {
  type: 'file';
  size: number;
};

export type FileTreeDirectory = Omit<FileTreeNodeResponse, 'children' | 'type'> & {
  type: 'directory';
  children: FileTreeNode[];
};

export type FileTreeNode = FileTreeFile | FileTreeDirectory;

// ---------- Workspace / Node ----------

export type NodeShape = [number | null, number | null];

/**
 * Rich node shape used by the workspace graph/table view. The backend may
 * attach extra per-operation fields, hence the index signature.
 */
export type WorkspaceNode = {
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
};

/** Metadata for one source column's tokenisation spec. */
export type TokenizationMeta = {
  column_name: string;
  model: string;
  language: string | null;
  params?: Record<string, unknown>;
};

export type NodeSchemaResponse = {
  node_id: string;
  schema: Record<string, string>;
  columns: string[];
  column_types: Record<string, string>;
  is_text_data: boolean;
  document_column?: string;
};
