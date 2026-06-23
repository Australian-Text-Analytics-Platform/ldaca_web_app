/** Default result row limit used by analysis panels when preferences are absent. */
export const DEFAULT_TOKEN_LIMIT = 25;

interface ClampResult {
  limit: number;
  wasClamped: boolean;
}

/**
 * Keeps display limits in the backend-supported positive integer range while
 * reporting whether a saved preference needed correction.
 * Used by: token-frequency preferences and hydration writes because display limits must be positive integers before they are stored locally or sent to the backend.
 */
export const clampDisplayTokenLimit = (value: number | null | undefined): ClampResult => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TOKEN_LIMIT;
  const floored = Math.floor(numeric);
  const bounded = Math.max(1, Number.isFinite(floored) ? floored : DEFAULT_TOKEN_LIMIT);
  return {
    limit: bounded,
    wasClamped: bounded !== floored,
  };
};

/**
 * Coerces loose metric values from analysis responses into finite numbers for
 * summary cards and chart labels without leaking NaN into the UI.
 * Used by: token-frequency preference parsing because analysis metrics and inputs arrive as numbers, strings, or booleans and need finite numeric values.
 */
export const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return null;
};

/**
 * Narrows untyped request and metadata values before they become node ids,
 * column names, or option labels in analysis controls.
 * Used by: token-frequency adapters and request parsers because untyped node ids, column names, and option labels need a reusable non-empty string guard.
 */
export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

interface AnalysisNodeColumnSelection {
  nodeId: string;
  column: string;
}

export interface ParsedAnalysisNodeRequest {
  nodeIds: string[];
  nodeColumns: Record<string, string>;
  selections: AnalysisNodeColumnSelection[];
}

export interface AnalysisNodeRequestShape {
  node_ids?: string[];
  node_columns?: Record<string, string | undefined>;
}

/**
 * Extracts the node/column selection shape shared by multi-node analysis task
 * requests so hydration and legacy tab-input migration can reuse one parser.
 * Used by: analysis hydration because backend requests store node_ids and node_columns that must become ordered selections.
 * Flow: slice valid node_ids to the requested limit, read the node_columns map, then return node ids, column lookup, and ordered selections.
 */
export const parseAnalysisNodeRequest = (
  requestData: AnalysisNodeRequestShape | null | undefined,
  maxNodes = 2,
): ParsedAnalysisNodeRequest => {
  const nodeIds: string[] = Array.isArray(requestData?.node_ids)
    ? requestData.node_ids
        .slice(0, maxNodes)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];

  const nodeColumns: Record<string, string> =
    requestData?.node_columns && typeof requestData.node_columns === 'object'
      ? (requestData.node_columns as Record<string, string>)
      : {};

  const selections: AnalysisNodeColumnSelection[] = nodeIds.map((nodeId) => ({
    nodeId,
    column: nodeColumns[nodeId] ?? '',
  }));

  return { nodeIds, nodeColumns, selections };
};
