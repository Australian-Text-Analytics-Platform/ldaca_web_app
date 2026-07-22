import type { WorkspaceNodeInfo } from '@/api';

export interface TokenizerModelColumnSelection {
  nodeId: string;
  column?: string | null;
}

/** Combines backend-persisted tokenizer choices with live per-node edits. */
/**
 * Used by: token-frequency and concordance analysis features because both render per-node tokenizer selectors whose defaults come from backend node metadata but must immediately reflect current-tab edits.
 * Flow: read selected Data Blocks, look up their node-level preference, then
 * let explicit live overrides (including an empty clear) win.
 */
export const deriveTokenizerModelsByNode = (
  selections: TokenizerModelColumnSelection[],
  nodeInfoCache: Record<string, WorkspaceNodeInfo>,
  liveTokenizerModelsByNode: Record<string, string>,
): Record<string, string> => {
  const fromNodes: Record<string, string> = {};
  for (const selection of selections) {
    const node = nodeInfoCache[selection.nodeId];
    const stored = node?.tokenizer_model;
    if (stored) fromNodes[selection.nodeId] = stored;
  }
  return { ...fromNodes, ...liveTokenizerModelsByNode };
};
