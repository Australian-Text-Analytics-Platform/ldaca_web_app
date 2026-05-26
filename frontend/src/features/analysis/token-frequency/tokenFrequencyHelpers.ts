import type { ConcordanceAnalysisRequest } from '@/lib/backend/text';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';

export interface TokenFrequencyAnalysisParams {
  node_ids?: string[];
  node_columns?: Record<string, string>;
}

export interface TokenFrequencyNodeContextArgs {
  lastCompareNodeIds?: string[];
  analysisParams?: TokenFrequencyAnalysisParams | null | undefined;
  selectedNodes?: Array<{ id?: string | null | undefined }>;
  nodeColumnSelections: NodeColumnSelection[];
  maxNodes?: number;
}

export interface TokenFrequencyNodeContext {
  nodeIds: string[];
  selections: NodeColumnSelection[];
}

const isValidId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

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

export function resolveTokenFrequencyNodeContext({
  lastCompareNodeIds = [],
  analysisParams,
  selectedNodes = [],
  nodeColumnSelections,
  maxNodes = 2,
}: TokenFrequencyNodeContextArgs): TokenFrequencyNodeContext {
  const orderedCandidates = dedupePreserveOrder([
    ...lastCompareNodeIds.filter(isValidId),
    ...((analysisParams?.node_ids ?? []).filter(isValidId)),
    ...selectedNodes
      .map((node) => node?.id)
      .filter(isValidId),
  ]);

  const candidateIds = orderedCandidates.slice(0, maxNodes);
  if (candidateIds.length === 0) {
    return { nodeIds: [], selections: [] };
  }

  const selectionMap = new Map<string, string>();
  nodeColumnSelections.forEach((sel) => {
    if (isValidId(sel?.nodeId) && isValidId(sel?.column)) {
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

export interface ConcordanceSeedParams {
  selectedNodes: Array<{ id: string }>;
  nodeColumnSelections: NodeColumnSelection[];
  maxNodes?: number;
  numLeftTokens?: number;
  numRightTokens?: number;
  combined?: boolean;
}

export function createConcordanceSeedRequest(
  token: string,
  {
    selectedNodes,
    nodeColumnSelections,
    maxNodes = 2,
    numLeftTokens = 10,
    numRightTokens = 10,
    combined = false,
  }: ConcordanceSeedParams
): ConcordanceAnalysisRequest | null {
  const trimmedToken = token?.toString().trim();
  if (!trimmedToken) {
    return null;
  }

  if (!Array.isArray(selectedNodes) || selectedNodes.length === 0) {
    return null;
  }

  const nodeColumns: Record<string, string> = {};
  selectedNodes.slice(0, maxNodes).forEach((node) => {
    const selection = nodeColumnSelections.find((sel) => sel.nodeId === node.id);
    if (selection?.column) {
      nodeColumns[node.id] = selection.column;
    }
  });

  const nodeIds = Object.keys(nodeColumns);
  if (nodeIds.length === 0) {
    return null;
  }

  return {
    node_ids: nodeIds,
    node_columns: nodeColumns,
    search_word: trimmedToken,
    num_left_tokens: numLeftTokens,
    num_right_tokens: numRightTokens,
    regex: false,
    case_sensitive: false,
    combined,
  };
}
