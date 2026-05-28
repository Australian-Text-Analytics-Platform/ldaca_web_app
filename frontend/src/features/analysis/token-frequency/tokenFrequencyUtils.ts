import type { TokenFrequencyResponse } from '@/api/generated/types.gen';
import { isNonEmptyString } from '../common';

export interface NodeNameEntry {
  id: string;
  name?: string | null;
}

/** Builds a node-id to display-name lookup from selection sources. */
/**
 * Used by: TokenFrequencyFeature.tsx, tokenFrequencyUtils.test.ts because callers need the same normalization and view-model rules before rendering or testing analysis results.
   * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export const buildSelectionNameById = (
  selectedNodes: Array<NodeNameEntry | null | undefined>,
  panelSelectedNodes?: Array<NodeNameEntry | null | undefined> | null
): Record<string, string> => {
  const mapping: Record<string, string> = {};

  selectedNodes.forEach((node) => {
    if (node && isNonEmptyString(node.id) && isNonEmptyString(node.name)) {
      mapping[node.id] = node.name;
    }
  });

  if (Array.isArray(panelSelectedNodes)) {
    panelSelectedNodes.forEach((node) => {
      if (node && isNonEmptyString(node.id) && isNonEmptyString(node.name)) {
        mapping[node.id] = node.name;
      }
    });
  }

  return mapping;
};

/** Creates a stable cache key for selection display-name mappings. */
/**
 * Used by: tokenFrequencyUtils.test.ts because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
export const buildSelectionNameKey = (
  selectedNodes: Array<NodeNameEntry | null | undefined>,
  panelSelectedNodes?: Array<NodeNameEntry | null | undefined> | null
): string => {
  const mapping = buildSelectionNameById(selectedNodes, panelSelectedNodes);
  return Object.keys(mapping)
    .sort()
    .map((nodeId) => `${nodeId}:${mapping[nodeId]}`)
    .join('|');
};

/** Reads the backend's persisted token display limit from all supported response locations. */
/**
 * Used by: TokenFrequencyFeature.tsx, tokenFrequencyUtils.test.ts because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
export const deriveBackendTokenLimit = (results?: TokenFrequencyResponse | null): number | null => {
  if (!results) return null;
  const candidate =
    results.token_limit ??
    (results.analysis_params as Record<string, unknown> | undefined)?.token_limit ??
    (results.metadata as Record<string, unknown> | undefined)?.token_limit;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
};

/** Reads the backend's persisted stop-word list from all supported response locations. */
/**
 * Used by: tokenFrequencyUtils.test.ts because callers need the same normalization and view-model rules before rendering or testing analysis results.
   * Flow: check top-level, analysis_params, and metadata stop-word arrays in order, stringify entries, then return null when none exist.
 */
export const deriveBackendStopWords = (results?: TokenFrequencyResponse | null): string[] | null => {
  if (!results) return null;
  const candidate =
    (Array.isArray(results.stop_words) ? results.stop_words : null) ??
    (Array.isArray(results.analysis_params?.stop_words) ? results.analysis_params.stop_words : null) ??
    (Array.isArray(results.metadata?.stop_words) ? results.metadata.stop_words : null);
  return Array.isArray(candidate) ? candidate.map((item) => String(item)) : null;
};

/** Builds a stable stop-word key for effects that sync backend preferences into UI state. */
/**
 * Used by: tokenFrequencyUtils.test.ts, TokenFrequencyFeature.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
export const deriveBackendStopWordsKey = (results?: TokenFrequencyResponse | null): string => {
  const stopWords = deriveBackendStopWords(results);
  if (!Array.isArray(stopWords) || stopWords.length === 0) return '';
  return stopWords
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => item.length > 0)
    .join('|');
};