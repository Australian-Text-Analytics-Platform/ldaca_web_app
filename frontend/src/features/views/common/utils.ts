import type { QueryClient } from '@tanstack/react-query';
import { applySelectedColumnsToSnapshots, createNodeSnapshots } from '@/features/workspace/common/hooks/useSchemaManagement';

/** Default result row limit used by analysis panels when preferences are absent. */
export const DEFAULT_TOKEN_LIMIT = 25;

type ClampResult = {
  limit: number;
  wasClamped: boolean;
};

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
 * Used by: formatNumber and token-frequency preference parsing because analysis metrics and inputs arrive as numbers, strings, or booleans and need finite numeric values.
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

export interface FormatNumberOptions {
  suffix?: string;
  multiplier?: number;
  fallback?: string;
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/**
 * Formats backend metrics for shared analysis UI elements that need consistent
 * fallbacks, scaling, and locale-aware decimal handling.
 * Used by: shared analysis summary cards, tables, and chart labels because backend metrics need fallback text, optional scaling, and locale-aware precision.
 * Flow: coerce the input with toFiniteNumber, apply fallback text for non-numeric values, scale and format with Intl.NumberFormat, then append any suffix.
 */
export const formatNumber = (
  value: unknown,
  decimals = 2,
  options: FormatNumberOptions = {},
): string => {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return options.fallback ?? '—';
  }

  const multiplier = typeof options.multiplier === 'number' ? options.multiplier : 1;
  const scaled = numeric * multiplier;
  const minimumFractionDigits =
    typeof options.minimumFractionDigits === 'number' ? options.minimumFractionDigits : decimals;
  const maximumFractionDigits =
    typeof options.maximumFractionDigits === 'number' ? options.maximumFractionDigits : decimals;

  const formatter = new Intl.NumberFormat(options.locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  });

  const formatted = formatter.format(scaled);
  return options.suffix ? `${formatted}${options.suffix}` : formatted;
};

/**
 * Narrows untyped request and metadata values before they become node ids,
 * column names, or option labels in analysis controls.
 * Used by: token-frequency adapters and request parsers because untyped node ids, column names, and option labels need a reusable non-empty string guard.
 */
export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export type AnalysisNodeColumnSelection = { nodeId: string; column: string };

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
 * requests so hydration and lock restoration can reuse one parser.
 * Used by: token-frequency hydration and lock restoration because backend requests store node_ids and node_columns that must become ordered selections.
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
    column: nodeColumns[nodeId] || '',
  }));

  return { nodeIds, nodeColumns, selections };
};

export interface RestoreAnalysisLockFromRequestArgs {
  workspaceId?: string | null;
  requestData: AnalysisNodeRequestShape | null | undefined;
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (snapshots: Array<{ id: string; name?: string; columns?: string[] }>) => void;
  /** Shared TanStack QueryClient — node-info reads route through its cache. */
  queryClient: QueryClient;
  maxNodes?: number;
}

/**
 * Rebuilds the locked node snapshots from a persisted task request, allowing
 * feature panels and task-center restores to show the exact submitted columns.
 * Used by: analysis task-flow hooks and hydration callbacks because restoring a task request must lock the same submitted nodes and selected columns in the UI.
 */
export const restoreAnalysisLockFromRequest = async ({
  workspaceId,
  requestData,
  getAuthHeaders,
  lockWithSnapshots,
  queryClient,
  maxNodes = 2,
}: RestoreAnalysisLockFromRequestArgs): Promise<ParsedAnalysisNodeRequest> => {
  const parsed = parseAnalysisNodeRequest(requestData, maxNodes);

  if (workspaceId && parsed.nodeIds.length) {
    const snapshots = await createNodeSnapshots(
      workspaceId,
      parsed.nodeIds,
      getAuthHeaders,
      queryClient,
    );
    const normalizedSnapshots = applySelectedColumnsToSnapshots(snapshots, parsed.nodeColumns);
    lockWithSnapshots(normalizedSnapshots);
  }

  return parsed;
};

export interface ResetAnalysisSelectionAfterClearArgs {
  unlockSelection: () => void;
}

/**
 * Provides a common post-clear hook for analyses that only need to unlock their
 * current selection after backend task records have been removed.
 * Used by: analysis clear handlers because tabs that only lock selections can release them through a tiny shared post-clear action.
 */
export const resetAnalysisSelectionAfterClear = ({
  unlockSelection,
}: ResetAnalysisSelectionAfterClearArgs): void => {
  unlockSelection();
};
