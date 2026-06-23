import type { TokenFrequencyResponse } from '@/api';
import { isNonEmptyString } from '../common';

interface TokenFrequencyRow {
  token: string;
  frequency: number;
}

export type TokenFrequencyStatisticsEntry = NonNullable<
  TokenFrequencyResponse['statistics']
>[number];

export interface NormalizedNodeResult {
  nodeId: string;
  displayName: string;
  rows: TokenFrequencyRow[];
  metadata: Record<string, unknown>;
}

export type NodeResultView = NormalizedNodeResult & {
  filteredRows: TokenFrequencyRow[];
  displayRows: TokenFrequencyRow[];
  filteredOutCount: number;
  appliedDisplayLimit: number | null;
  maxFrequency: number;
};

/** Extracts token-frequency rows from either raw arrays or backend node-result envelopes. */
/**
 * Used by: tokenFrequencyAdapters analysis helper module exports or same-file callers because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
const extractRows = (entry: unknown): TokenFrequencyRow[] => {
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

/** Pulls backend metadata from a node-result envelope for display-name recovery. */
/**
 * Used by: tokenFrequencyAdapters analysis helper module exports or same-file callers because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
const extractMetadata = (entry: unknown): Record<string, unknown> => {
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

/** Returns the largest selected numeric value while preserving a caller-provided fallback. */
/**
 * Used by: tokenFrequencyAdapters analysis helper module exports or same-file callers because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
const maxBy = <T>(items: T[], selector: (item: T) => number, fallback: number): number => {
  let max = fallback;
  for (const item of items) {
    const value = selector(item);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max;
};

/** Builds node display-name hints from response metadata before UI-level fallback naming runs. */
/**
 * Used by: TokenFrequencyFeature.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
 * Flow: read metadata node_display_names, scan per-node result metadata for node/display-name pairs, then return the hint map.
 */
export const buildResponseDisplayNameHints = (
  results?: TokenFrequencyResponse | null,
): Record<string, string> => {
  const mapping: Record<string, string> = {};
  const metadataNodeNames = (results?.metadata?.node_display_names ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof metadataNodeNames === 'object') {
    Object.entries(metadataNodeNames).forEach(([id, name]) => {
      if (isNonEmptyString(name)) {
        mapping[id] = name;
      }
    });
  }

  if (results?.data && typeof results.data === 'object') {
    Object.entries(results.data as Record<string, unknown>).forEach(([, value]) => {
      const entryMetadata = extractMetadata(value);
      const metaNodeId = entryMetadata.node_id;
      const metaDisplayName = entryMetadata.display_name;
      if (isNonEmptyString(metaNodeId) && isNonEmptyString(metaDisplayName)) {
        mapping[metaNodeId] = metaDisplayName;
      }
    });
  }

  return mapping;
};

/** Resolves the node ordering that downstream adapters should use for result display. */
/**
 * Used by: TokenFrequencyFeature.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
 * Flow: combine request node_ids, previous comparison ids, and selected node ids, then keep first nonempty occurrence of each id.
 */
export const computeAnalysisNodeIds = (
  paramsNodeIds: unknown,
  lastCompareNodeIds: string[],
  nodeColumnSelections: { nodeId: string }[],
): string[] => {
  const combined: (string | null | undefined)[] = [];
  if (Array.isArray(paramsNodeIds)) {
    combined.push(...(paramsNodeIds as string[]));
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

/** Normalizes backend result maps into stable per-node view models for panels and exports. */
/**
 * Used by: TokenFrequencyFeature.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
 * Flow: normalize raw analysis values, apply filtering or mapping rules, then return the view model consumed by components or tests.
 */
export const normalizeNodeResults = (
  data: unknown,
  analysisNodeIds: string[],
  computeDisplayName: (nodeId: string, fallbackKey?: string) => string,
): NormalizedNodeResult[] => {
  if (!data || typeof data !== 'object') {
    return [];
  }

  const dataRecord = data as Record<string, unknown>;
  const entries = Object.entries(dataRecord);
  const usedKeys = new Set<string>();
  const nodeIds = analysisNodeIds.length > 0 ? analysisNodeIds : entries.map(([key]) => key);

  /** Finds an unmatched backend entry whose metadata identifies the requested node. */
  /**
   * Called by: normalizeNodeResults during this analysis workflow because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
   */
  const findUnusedEntryByNodeId = (nodeId: string) =>
    entries.find(([key, value]) => {
      if (usedKeys.has(key)) return false;
      const metadata = extractMetadata(value);
      return isNonEmptyString(metadata.node_id) && metadata.node_id === nodeId;
    });

  return nodeIds.map((nodeId, index) => {
    const fallbackKey = entries[index]?.[0];
    const displayName = computeDisplayName(nodeId, fallbackKey);
    const directKey = [nodeId, displayName].find(
      (key) => !!key && Object.prototype.hasOwnProperty.call(dataRecord, key) && !usedKeys.has(key),
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

/** Applies stop-word and display-limit projections to normalized node result rows. */
/**
 * Used by: useTokenFrequencyPreferences.ts, TokenFrequencyFeature.tsx, tokenFrequencyAdapters.test.ts because callers need the same normalization and view-model rules before rendering or testing analysis results.
 * Flow: normalize raw analysis values, apply filtering or mapping rules, then return the view model consumed by components or tests.
 */
export const deriveNodeDisplayResults = (
  normalizedNodeResults: NormalizedNodeResult[],
  appliedStopSet: Set<string>,
  effectiveTokenLimit: number | null,
): NodeResultView[] => {
  const normalizedLimit =
    typeof effectiveTokenLimit === 'number' && Number.isFinite(effectiveTokenLimit)
      ? Math.max(0, Math.floor(effectiveTokenLimit))
      : null;

  const hasStopFilter = appliedStopSet.size > 0;
  /** Decides whether a raw token should be hidden by the active stop-word set. */
  /**
   * Called by: deriveNodeDisplayResults during this analysis workflow because callers need the same normalization and view-model rules before rendering or testing analysis results.
   */
  const shouldFilterToken = (token: unknown) => {
    if (!hasStopFilter) return false;
    const normalizedToken = typeof token === 'string' ? token.toLowerCase() : '';
    return appliedStopSet.has(normalizedToken);
  };

  return normalizedNodeResults.map((result) => {
    const rawRows = Array.isArray(result.rows) ? result.rows : [];
    const filteredRows = hasStopFilter
      ? rawRows.filter((row) => !shouldFilterToken(row.token))
      : rawRows;

    let displayRows: TokenFrequencyRow[];
    if (normalizedLimit === null || normalizedLimit <= 0) {
      displayRows = filteredRows;
    } else {
      const limitedRows: TokenFrequencyRow[] = [];
      for (const row of rawRows) {
        if (shouldFilterToken(row.token)) continue;
        limitedRows.push(row);
        if (limitedRows.length >= normalizedLimit) break;
      }
      displayRows = limitedRows;
    }

    const maxFrequencyRaw = rawRows.length > 0 ? maxBy(rawRows, (r) => r.frequency || 0, 0) : 0;
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

/** Converts user wildcard syntax into a token filter regular expression for list views. */
/**
 * Used by: TokenFrequencySingleTokenSection.tsx, TokenFrequencyStatisticsTable.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
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
