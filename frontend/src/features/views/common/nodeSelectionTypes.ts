export type { NodeColumnSelection } from '@/features/workspace/common/hooks/useAutoNodeColumns';

export interface WorkspaceNodeLike extends Record<string, unknown> {
  id?: string;
  node_id?: string;
  name?: string;
  label?: string;
  color?: string | null;
  shape?: [number | null, number | null] | number[];
  columns?: string[];
  schema?: Record<string, unknown>;
  dtypes?: Record<string, unknown>;
  column_schema?: Record<string, unknown>;
  tokenizer_models?: Record<string, string>;
}

/**
 * Gives shared analysis selection UIs a stable id even when backend previews use
 * either node_id or id fields, with index fallback for incomplete fixtures.
 * Used by: analysis node selectors and per-node result panels because backend nodes may arrive with id, node_id, or neither in tests and fixtures.
 */
export const getNodeIdentifier = (node: WorkspaceNodeLike, fallbackIndex: number): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty id/node_id should fall through to the index fallback
  node.id || node.node_id || `node-${String(fallbackIndex)}`;

/**
 * Resolves the human label used by shared node-selection controls while keeping
 * the identifier visible when backend metadata has no display name.
 * Used by: NodeSelectionList and shared selection panels because labels should prefer backend names, then labels, then stable ids when metadata is sparse.
 */
export const getNodeDisplayName = (node: WorkspaceNodeLike, fallbackId: string): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty name/label should fall through to the next display option
  node.name || node.label || fallbackId;
