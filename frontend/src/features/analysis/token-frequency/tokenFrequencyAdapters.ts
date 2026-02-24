import type { TokenFrequencyResponse } from '@/api/text';
import { isNonEmptyString } from '../common';

export type NormalizedNodeResult = {
  nodeId: string;
  displayName: string;
  rows: any[];
  metadata: Record<string, unknown>;
};

export type NodeResultView = NormalizedNodeResult & {
  filteredRows: any[];
  displayRows: any[];
  filteredOutCount: number;
  appliedDisplayLimit: number | null;
  maxFrequency: number;
};

export const extractRows = (entry: unknown): any[] => {
  if (Array.isArray(entry)) {
    return entry as any[];
  }
  if (
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    Array.isArray((entry as any).data)
  ) {
    return (entry as any).data as any[];
  }
  return [];
};

export const extractMetadata = (entry: unknown): Record<string, unknown> => {
  if (
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    (entry as any).metadata &&
    typeof (entry as any).metadata === 'object'
  ) {
    return (entry as any).metadata as Record<string, unknown>;
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

export const STATS_SORT_ACCESSORS: Record<string, (stat: any) => unknown> = {
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

    let displayRows: any[];
    if (normalizedLimit === null || normalizedLimit <= 0) {
      displayRows = filteredRows;
    } else {
      const limitedRows: any[] = [];
      for (const row of rawRows) {
        if (shouldFilterToken(row?.token)) continue;
        limitedRows.push(row);
        if (limitedRows.length >= normalizedLimit) break;
      }
      displayRows = limitedRows;
    }

    const maxFrequencyRaw = rawRows.length > 0 ? maxBy(rawRows, (r: any) => Number(r?.frequency) || 0, 0) : 0;
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

export const filterStatisticsByStopWords = (statistics: unknown, appliedStopSet: Set<string>): any[] => {
  if (!Array.isArray(statistics)) {
    return [];
  }
  return statistics
    .filter((stat: any) => !appliedStopSet.has(String(stat.token || '').toLowerCase()))
    .filter((stat: any) => Number(stat.log_likelihood_llv) > 0);
};

export const sortStatistics = (
  filteredStatistics: any[],
  statsSortColumn: string,
  statsSortDirection: 'asc' | 'desc'
): any[] => {
  if (filteredStatistics.length === 0) {
    return [];
  }

  const columnKey = statsSortColumn || 'log_likelihood_llv';
  const direction = statsSortDirection === 'asc' ? 1 : -1;

  return [...filteredStatistics].sort((a, b) => {
    if (columnKey === 'significance') {
      const rank = (stat: any) => (stat.significance || '').length;
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
    if (typeof va === 'string' || typeof vb === 'string') {
      const sa = (va ?? '').toString();
      const sb = (vb ?? '').toString();
      if (sa === sb) return 0;
      return direction * (sa < sb ? -1 : 1);
    }

    const numA = Number(va);
    const numB = Number(vb);
    const na = Number.isFinite(numA) ? numA : -Infinity;
    const nb = Number.isFinite(numB) ? numB : -Infinity;
    return direction * (na - nb);
  });
};