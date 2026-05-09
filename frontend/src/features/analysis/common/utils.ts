import { applySelectedColumnsToSnapshots, createNodeSnapshots } from '@/hooks/useSchemaManagement';

export const DEFAULT_TOKEN_LIMIT = 25;

type ClampResult = {
  limit: number;
  wasClamped: boolean;
};

export const clampDisplayTokenLimit = (value: number | null | undefined): ClampResult => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TOKEN_LIMIT;
  const floored = Math.floor(numeric);
  const bounded = Math.max(1, Number.isFinite(floored) ? floored : DEFAULT_TOKEN_LIMIT);
  return {
    limit: bounded,
    wasClamped: bounded !== floored,
  };
};

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

export const formatNumber = (
  value: unknown,
  decimals = 2,
  options: FormatNumberOptions = {}
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

export const parseAnalysisNodeRequest = (
  requestData: AnalysisNodeRequestShape | null | undefined,
  maxNodes = 2
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
  maxNodes?: number;
}

export const restoreAnalysisLockFromRequest = async ({
  workspaceId,
  requestData,
  getAuthHeaders,
  lockWithSnapshots,
  maxNodes = 2,
}: RestoreAnalysisLockFromRequestArgs): Promise<ParsedAnalysisNodeRequest> => {
  const parsed = parseAnalysisNodeRequest(requestData, maxNodes);

  if (workspaceId && parsed.nodeIds.length) {
    const snapshots = await createNodeSnapshots(workspaceId, parsed.nodeIds, getAuthHeaders);
    const normalizedSnapshots = applySelectedColumnsToSnapshots(snapshots, parsed.nodeColumns);
    lockWithSnapshots(normalizedSnapshots);
  }

  return parsed;
};

export interface ResetAnalysisSelectionAfterClearArgs {
  unlockSelection: () => void;
}

export const resetAnalysisSelectionAfterClear = ({
  unlockSelection,
}: ResetAnalysisSelectionAfterClearArgs): void => {
  unlockSelection();
};
