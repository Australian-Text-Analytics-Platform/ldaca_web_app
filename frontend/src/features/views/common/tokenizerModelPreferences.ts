import type { WorkspaceNodeInfo } from '@/api';

export interface TokenizerModelColumnSelection {
  nodeId: string;
  column?: string | null;
}

/** Combines backend-persisted tokenizer choices with live per-node edits. */
/**
 * Used by: token-frequency and concordance analysis features because both render per-node tokenizer selectors whose defaults come from backend node metadata but must immediately reflect current-tab edits.
 * Flow: read selected columns, look up authoritative node-info metadata by id,
 * copy stored model ids for those columns, then let live overrides win.
 */
export const deriveTokenizerModelsByNode = (
  selections: TokenizerModelColumnSelection[],
  nodeInfoCache: Record<string, WorkspaceNodeInfo>,
  liveTokenizerModelsByNode: Record<string, string>,
): Record<string, string> => {
  const fromNodes: Record<string, string> = {};
  for (const selection of selections) {
    if (!selection.column) continue;
    const node = nodeInfoCache[selection.nodeId];
    const stored = node?.tokenizer_models?.[selection.column];
    if (stored) fromNodes[selection.nodeId] = stored;
  }
  return { ...fromNodes, ...liveTokenizerModelsByNode };
};
