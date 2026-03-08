import type { TokenFrequencyResponse } from '@/api/text';
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

export const STATS_SORT_ACCESSORS: Record<string, (stat: TokenFrequencyStatisticsEntry) => unknown> = {
  token: (stat) => stat.token,
  freq_corpus_0: (stat) => stat.freq_corpus_0,
  percent_corpus_0: (stat) => stat.percent_corpus_0,
  freq_corpus_1: (stat) => stat.freq_corpus_1,
  percent_corpus_1: (stat) => stat.percent_corpus_1,
  log_likelihood_llv: (stat) => stat.log_likelihood_llv,
  percent_diff: (stat) => stat.percent_diff,
  bayes_factor_bic: (stat) => stat.bayes_factor_bic,
  effect_size_ell: (stat) => stat.effect_size_ell,
  relative_risk: (stat) => stat.relative_risk,
  log_ratio: (stat) => stat.log_ratio,
  odds_ratio: (stat) => stat.odds_ratio,
};

const parseStatisticsNumericForSort = (value: unknown): number => {
  if (value === null || value === undefined) return NaN;
  if (value === '+Inf') return Number.POSITIVE_INFINITY;
  if (value === '-Inf') return Number.NEGATIVE_INFINITY;
  return Number(value);
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

export const filterStatisticsByStopWords = (statistics: unknown, appliedStopSet: Set<string>): TokenFrequencyStatisticsEntry[] => {
  if (!Array.isArray(statistics)) {
    return [];
  }
  return (statistics as TokenFrequencyStatisticsEntry[])
    .filter((stat) => !appliedStopSet.has(String(stat.token || '').toLowerCase()))
    .filter((stat) => Number(stat.log_likelihood_llv) > 0);
};

export const sortStatistics = (
  filteredStatistics: TokenFrequencyStatisticsEntry[],
  statsSortColumn: string,
  statsSortDirection: 'asc' | 'desc'
): TokenFrequencyStatisticsEntry[] => {
  if (filteredStatistics.length === 0) {
    return [];
  }

  const columnKey = statsSortColumn || 'log_likelihood_llv';
  const direction = statsSortDirection === 'asc' ? 1 : -1;

  return [...filteredStatistics].sort((a, b) => {
    if (columnKey === 'significance') {
      const rank = (stat: TokenFrequencyStatisticsEntry) => (stat.significance || '').length;
      const va = rank(a);
      const vb = rank(b);
      return direction * (va - vb);
    }

    const accessor = STATS_SORT_ACCESSORS[columnKey];
    if (!accessor) {
      return 0;
    }

    const va = accessor(a);
    const vb = accessor(b);
    if (columnKey === 'token') {
      const sa = (va ?? '').toString();
      const sb = (vb ?? '').toString();
      if (sa === sb) return 0;
      return direction * (sa < sb ? -1 : 1);
    }

    const numA = parseStatisticsNumericForSort(va);
    const numB = parseStatisticsNumericForSort(vb);
    const missingA = Number.isNaN(numA);
    const missingB = Number.isNaN(numB);

    if (missingA && missingB) return 0;
    if (missingA) return 1;
    if (missingB) return -1;

    return direction * (numA - numB);
  });
};