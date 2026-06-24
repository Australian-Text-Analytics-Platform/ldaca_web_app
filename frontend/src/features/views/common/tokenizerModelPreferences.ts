import type { WorkspaceNodeLike } from './nodeSelectionTypes';

export interface TokenizerModelColumnSelection {
  nodeId: string;
  column?: string | null;
}

/** Combines backend-persisted tokenizer choices with live per-node edits. */
/**
 * Used by: token-frequency and concordance analysis features because both render per-node tokenizer selectors whose defaults come from backend node metadata but must immediately reflect current-tab edits.
 * Flow: read selected columns, match nodes by id or node_id, copy stored model ids for those columns, then let live overrides win.
 */
export const deriveTokenizerModelsByNode = (
  selections: TokenizerModelColumnSelection[],
  panelSelectedNodes: WorkspaceNodeLike[],
  liveTokenizerModelsByNode: Record<string, string>,
): Record<string, string> => {
  const fromNodes: Record<string, string> = {};
  for (const selection of selections) {
    if (!selection.column) continue;
    const node = panelSelectedNodes.find((candidate) => {
      const ids = [candidate.id, candidate.node_id];
      return ids.some((id) => typeof id === 'string' && id === selection.nodeId);
    });
    const stored = node?.tokenizer_models?.[selection.column];
    if (stored) fromNodes[selection.nodeId] = stored;
  }
  return { ...fromNodes, ...liveTokenizerModelsByNode };
};
