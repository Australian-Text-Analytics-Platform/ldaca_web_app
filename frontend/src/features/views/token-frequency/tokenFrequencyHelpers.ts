import type { NodeColumnSelection } from '@/features/workspace/common/hooks/useAutoNodeColumns';

export interface TokenFrequencyAnalysisParams {
  node_ids?: string[];
  node_columns?: Record<string, string>;
}

export interface TokenFrequencyNodeContextArgs {
  lastCompareNodeIds?: string[];
  analysisParams?: TokenFrequencyAnalysisParams | null | undefined;
  selectedNodes?: { id?: string | null | undefined }[];
  nodeColumnSelections: NodeColumnSelection[];
  maxNodes?: number;
}

export interface TokenFrequencyNodeContext {
  nodeIds: string[];
  selections: NodeColumnSelection[];
}

/** Narrows unknown values to usable non-empty node or column identifiers. */
/**
 * Called by: tokenFrequencyHelpers analysis helper module during this analysis workflow because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
const isValidId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** Removes duplicate node IDs while preserving the user's comparison order. */
/**
 * Called by: tokenFrequencyHelpers analysis helper module during this analysis workflow because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
const dedupePreserveOrder = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  ids.forEach((id) => {
    if (isValidId(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  });
  return result;
};

/** Resolves the node and column context needed when token clicks jump to concordance. */
/**
 * Used by: useTokenFrequencyTaskFlow.ts because callers need the same normalization and view-model rules before rendering or testing analysis results.
 * Flow: normalize raw analysis values, apply filtering or mapping rules, then return the view model consumed by components or tests.
 */
export function resolveTokenFrequencyNodeContext({
  lastCompareNodeIds = [],
  analysisParams,
  selectedNodes = [],
  nodeColumnSelections,
  maxNodes = 2,
}: TokenFrequencyNodeContextArgs): TokenFrequencyNodeContext {
  const orderedCandidates = dedupePreserveOrder([
    ...lastCompareNodeIds.filter(isValidId),
    ...(analysisParams?.node_ids ?? []).filter(isValidId),
    ...selectedNodes.map((node) => node.id).filter(isValidId),
  ]);

  const candidateIds = orderedCandidates.slice(0, maxNodes);
  if (candidateIds.length === 0) {
    return { nodeIds: [], selections: [] };
  }

  const selectionMap = new Map<string, string>();
  nodeColumnSelections.forEach((sel) => {
    if (isValidId(sel.nodeId) && isValidId(sel.column)) {
      selectionMap.set(sel.nodeId, sel.column);
    }
  });

  const analysisColumns = analysisParams?.node_columns ?? {};
  const nodeIds: string[] = [];
  const selections: NodeColumnSelection[] = [];

  candidateIds.forEach((id) => {
    const column = selectionMap.get(id) ?? analysisColumns[id];
    if (isValidId(column)) {
      nodeIds.push(id);
      selections.push({ nodeId: id, column });
    }
  });

  return { nodeIds, selections };
}

