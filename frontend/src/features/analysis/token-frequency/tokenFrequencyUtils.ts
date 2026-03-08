import type { TokenFrequencyResponse } from '@/api/text';
import { isNonEmptyString } from '../common';

export interface NodeNameEntry {
  id: string;
  name?: string | null;
}

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

export const deriveBackendTokenLimit = (results?: TokenFrequencyResponse | null): number | null => {
  if (!results) return null;
  const candidate =
    results.token_limit ??
    (results.analysis_params as Record<string, unknown> | undefined)?.token_limit ??
    (results.metadata as Record<string, unknown> | undefined)?.token_limit;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
};

export const deriveBackendStopWords = (results?: TokenFrequencyResponse | null): string[] | null => {
  if (!results) return null;
  const candidate =
    (Array.isArray(results.stop_words) ? results.stop_words : null) ??
    (Array.isArray(results.analysis_params?.stop_words) ? results.analysis_params.stop_words : null) ??
    (Array.isArray(results.metadata?.stop_words) ? results.metadata.stop_words : null);
  return Array.isArray(candidate) ? candidate.map((item) => String(item)) : null;
};

export const deriveBackendStopWordsKey = (results?: TokenFrequencyResponse | null): string => {
  const stopWords = deriveBackendStopWords(results);
  if (!Array.isArray(stopWords) || stopWords.length === 0) return '';
  return stopWords
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => item.length > 0)
    .join('|');
};