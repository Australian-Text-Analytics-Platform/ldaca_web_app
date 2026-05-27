import type { TokenFrequencyResponse } from '@/api/generated/types.gen';
import { isNonEmptyString } from '../common';

export type TokenFrequencyRow = { token: string; frequency: number };

export type TokenFrequencyStatisticsEntry = NonNullable<TokenFrequencyResponse['statistics']>[number];

export type NormalizedNodeResult = {
  nodeId: string;
  displayName: string;
  rows: TokenFrequencyRow[];
  metadata: Record<string, unknown>;
};

export type NodeResultView = NormalizedNodeResult & {
  filteredRows: TokenFrequencyRow[];
  displayRows: TokenFrequencyRow[];
  filteredOutCount: number;
  appliedDisplayLimit: number | null;
  maxFrequency: number;
};

export const extractRows = (entry: unknown): TokenFrequencyRow[] => {
  if (Array.isArray(entry)) {
    return entry as TokenFrequencyRow[];
  }
  if (
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    Array.isArray((entry as Record<string, unknown>).data)
  ) {
    return (entry as Record<string, unknown>).data as TokenFrequencyRow[];
  }
  return [];
};

export const extractMetadata = (entry: unknown): Record<string, unknown> => {
  if (
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    (entry as Record<string, unknown>).metadata &&
    typeof (entry as Record<string, unknown>).metadata === 'object'
  ) {
    return (entry as Record<string, unknown>).metadata as Record<string, unknown>;
  }
  return {};
};

export const maxBy = <T,>(items: T[], selector: (item: T) => number, fallback: number): number => {
  let max = fallback;
  for (const item of items) {
    const value = selector(item);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max;
};

export const buildResponseDisplayNameHints = (results?: TokenFrequencyResponse | null): Record<string, string> => {
  const mapping: Record<string, string> = {};
  const metadataNodeNames = ((results?.metadata as Record<string, unknown> | null | undefined)?.node_display_names ?? {}) as Record<string, unknown>;
  if (metadataNodeNames && typeof metadataNodeNames === 'object') {
    Object.entries(metadataNodeNames).forEach(([id, name]) => {
      if (isNonEmptyString(name)) {
        mapping[id] = name;
      }
    });
  }

  if (results?.data && typeof results.data === 'object') {
    Object.entries(results.data as Record<string, unknown>).forEach(([, value]) => {
      const entryMetadata = extractMetadata(value);
      const metaNodeId = entryMetadata['node_id'];
      const metaDisplayName = entryMetadata['display_name'];
      if (isNonEmptyString(metaNodeId) && isNonEmptyString(metaDisplayName)) {
        mapping[metaNodeId] = metaDisplayName;
      }
    });
  }

  return mapping;
};

export const computeAnalysisNodeIds = (
  paramsNodeIds: unknown,
  lastCompareNodeIds: string[],
  nodeColumnSelections: Array<{ nodeId: string }>
): string[] => {
  const combined: Array<string | null | undefined> = [];
  if (Array.isArray(paramsNodeIds)) {
    combined.push(...paramsNodeIds);
  }
  combined.push(...lastCompareNodeIds);
  combined.push(...nodeColumnSelections.map((sel) => sel.nodeId));

  const seen = new Set<string>();
  const deduped: string[] = [];
  combined.forEach((id) => {
    if (isNonEmptyString(id) && !seen.has(id)) {
      seen.add(id);
      deduped.push(id);
    }
  });
  return deduped;
};

export const normalizeNodeResults = (
  data: unknown,
  analysisNodeIds: string[],
  computeDisplayName: (nodeId: string, fallbackKey?: string) => string
): NormalizedNodeResult[] => {
  if (!data || typeof data !== 'object') {
    return [];
  }

  const dataRecord = data as Record<string, unknown>;
  const entries = Object.entries(dataRecord);
  const usedKeys = new Set<string>();
  const nodeIds = analysisNodeIds.length > 0 ? analysisNodeIds : entries.map(([key]) => key);

  const findUnusedEntryByNodeId = (nodeId: string) =>
    entries.find(([key, value]) => {
      if (usedKeys.has(key)) return false;
      const metadata = extractMetadata(value);
      return isNonEmptyString(metadata['node_id']) && metadata['node_id'] === nodeId;
    });

  return nodeIds.map((nodeId, index) => {
    const fallbackKey = entries[index]?.[0];
    const displayName = computeDisplayName(nodeId, fallbackKey);
    const directKey = [nodeId, displayName].find(
      (key) => !!key && Object.prototype.hasOwnProperty.call(dataRecord, key) && !usedKeys.has(key)
    );

    const matchedEntry =
      (directKey ? ([directKey, dataRecord[directKey]] as [string, unknown]) : null) ??
      findUnusedEntryByNodeId(nodeId) ??
      (fallbackKey && !usedKeys.has(fallbackKey)
        ? ([fallbackKey, dataRecord[fallbackKey]] as [string, unknown])
        : null) ??
      entries.find(([key]) => !usedKeys.has(key)) ??
      null;

    const entryKey = matchedEntry?.[0] ?? null;
    const entry = matchedEntry?.[1];

    if (entryKey) {
      usedKeys.add(entryKey);
    }

    const metadata = extractMetadata(entry);
    const rows = extractRows(entry);

    return {
      nodeId,
      displayName,
      rows,
      metadata,
    };
  });
};

export const deriveNodeDisplayResults = (
  normalizedNodeResults: NormalizedNodeResult[],
  appliedStopSet: Set<string>,
  effectiveTokenLimit: number | null
): NodeResultView[] => {
  const normalizedLimit =
    typeof effectiveTokenLimit === 'number' && Number.isFinite(effectiveTokenLimit)
      ? Math.max(0, Math.floor(effectiveTokenLimit))
      : null;

  const hasStopFilter = appliedStopSet.size > 0;
  const shouldFilterToken = (token: unknown) => {
    if (!hasStopFilter) return false;
    const normalizedToken = String(token ?? '').toLowerCase();
    return appliedStopSet.has(normalizedToken);
  };

  return normalizedNodeResults.map((result) => {
    const rawRows = Array.isArray(result.rows) ? result.rows : [];
    const filteredRows = hasStopFilter
      ? rawRows.filter((row) => !shouldFilterToken(row?.token))
      : rawRows;

    let displayRows: TokenFrequencyRow[];
    if (normalizedLimit === null || normalizedLimit <= 0) {
      displayRows = filteredRows;
    } else {
      const limitedRows: TokenFrequencyRow[] = [];
      for (const row of rawRows) {
        if (shouldFilterToken(row?.token)) continue;
        limitedRows.push(row);
        if (limitedRows.length >= normalizedLimit) break;
      }
      displayRows = limitedRows;
    }

    const maxFrequencyRaw = rawRows.length > 0 ? maxBy(rawRows, (r) => Number(r?.frequency) || 0, 0) : 0;
    const maxFrequency = maxFrequencyRaw > 0 ? maxFrequencyRaw : 1;

    return {
      ...result,
      rows: rawRows,
      filteredRows,
      displayRows,
      filteredOutCount: rawRows.length - filteredRows.length,
      appliedDisplayLimit: normalizedLimit,
      maxFrequency,
    };
  });
};

export const wildcardToRegExp = (pattern: string): RegExp | null => {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  // Escape regex special chars except * and ?
  const escaped = trimmed
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
};

