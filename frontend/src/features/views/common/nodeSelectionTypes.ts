import type { WorkspaceNodeInfo } from '@/api';

/**
 * One selected workspace node plus the feature-specific column chosen for it.
 * Used by: analysis task flows, result panels, and node-input hooks because
 * they share the same persisted `{nodeId, column}` selection shape.
 */
export interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

export interface WorkspaceNodeLike
  extends Omit<Partial<WorkspaceNodeInfo>, 'id'>,
    Record<string, unknown> {
  id: WorkspaceNodeInfo['id'];
  name?: string;
  label?: string;
  color?: string | null;
  shape?: [number | null, number | null] | number[];
  columns?: string[];
  schema?: Record<string, unknown> | Record<string, unknown>[];
  dtypes?: Record<string, unknown>;
  column_schema?: Record<string, unknown>;
  tokenizer_models?: Record<string, string>;
  data?: {
    name?: string;
    label?: string;
    document?: string;
    columns?: string[];
    schema?: Record<string, unknown> | Record<string, unknown>[];
    dtypes?: Record<string, unknown>;
  };
}

/**
 * Returns the generated workspace node id used by live node-selection UIs.
 * Used by: analysis node selectors and per-node result panels because live
 * workspace nodes share `WorkspaceNodeInfo.id` as their only identity.
 */
export const getNodeIdentifier = (node: WorkspaceNodeLike): string => node.id;

/**
 * Resolves the human label used by shared node-selection controls while keeping
 * the identifier visible when backend metadata has no display name.
 * Used by: NodeSelectionList and shared selection panels because labels should prefer backend names, then labels, then stable ids when metadata is sparse.
 */
export const getNodeDisplayName = (node: WorkspaceNodeLike, fallbackId: string): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty name/label should fall through to the next display option
  node.name || node.label || fallbackId;
