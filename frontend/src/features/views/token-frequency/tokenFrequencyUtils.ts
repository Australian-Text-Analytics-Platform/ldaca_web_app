import type { TokenFrequencyResponse } from '@/api';
import { isNonEmptyString } from '../common/utils';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

export interface NodeNameEntry {
  id: string;
  name?: string | null;
}

export interface TokenFrequencyStudyNodeOrder {
  effectiveStudyNodeId: string | null;
  orderedPanelNodeIds: string[];
}

/** Builds a node-id to display-name lookup from selection sources. */
/**
 * Used by: TokenFrequencyFeature.tsx, tokenFrequencyUtils.test.ts.
 */
export const buildSelectionNameById = (
  selectedNodes: (NodeNameEntry | null | undefined)[],
  panelSelectedNodes?: (NodeNameEntry | null | undefined)[] | null,
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
 * Used by: tokenFrequencyUtils.test.ts.
 */
export const buildSelectionNameKey = (
  selectedNodes: (NodeNameEntry | null | undefined)[],
  panelSelectedNodes?: (NodeNameEntry | null | undefined)[] | null,
): string => {
  const mapping = buildSelectionNameById(selectedNodes, panelSelectedNodes);
  return Object.keys(mapping)
    .sort()
    .map((nodeId) => `${nodeId}:${String(mapping[nodeId])}`)
    .join('|');
};

/** Resolves the selected token-frequency node ids used for ordering and submission. */
/**
 * Used by: TokenFrequencyFeature.tsx and tokenFrequencyUtils.test.ts because
 * analysis requests need the selected live workspace node ids in panel order.
 * Flow: cap the panel selection to two nodes and keep each generated
 * workspace-node `id`.
 */
export const derivePanelNodeIds = (
  panelSelectedNodes: Pick<WorkspaceNodeMetadata, 'id'>[],
): string[] =>
  panelSelectedNodes
    .slice(0, 2)
    .map((node) => node.id)
    .filter((id): id is string => Boolean(id));

/** Derives the study-corpus id and backend comparison order for token-frequency runs. */
/**
 * Used by: TokenFrequencyFeature.tsx and tokenFrequencyUtils.test.ts because pairwise keyness treats the study corpus as the final request node while the UI lets users choose either selected node.
 * Flow: keep a valid explicit study id, otherwise default to the first panel node, then move that study node to the end of the request order.
 */
export const deriveStudyNodeOrder = (
  panelNodeIds: string[],
  studyNodeId: string | null,
): TokenFrequencyStudyNodeOrder => {
  const effectiveStudyNodeId =
    studyNodeId && panelNodeIds.includes(studyNodeId) ? studyNodeId : (panelNodeIds[0] ?? null);
  if (!effectiveStudyNodeId) {
    return { effectiveStudyNodeId: null, orderedPanelNodeIds: panelNodeIds };
  }
  return {
    effectiveStudyNodeId,
    orderedPanelNodeIds: [
      ...panelNodeIds.filter((nodeId) => nodeId !== effectiveStudyNodeId),
      effectiveStudyNodeId,
    ],
  };
};

/** Builds the node-id display-name map used by token-click handoffs and result fallbacks. */
/**
 * Used by: TokenFrequencyFeature.tsx and tokenFrequencyUtils.test.ts because handoffs to concordance and result labels need the same canonical name/id fallback order.
 * Flow: scan selected nodes, keep entries with stable ids, and choose the projected name, then id as the display value.
 */
export const buildNodeIdDisplayNameMap = (
  panelSelectedNodes: Pick<WorkspaceNodeMetadata, 'id' | 'name'>[],
): Record<string, string> => {
  const map: Record<string, string> = {};
  panelSelectedNodes.forEach((node) => {
    const nodeId = typeof node.id === 'string' ? node.id : '';
    if (!nodeId) return;
    map[nodeId] = node.name.length > 0 ? node.name : nodeId;
  });
  return map;
};

/** Resolves the label shown for a token-frequency node in result panels and exports. */
/**
 * Used by: useTokenFrequencyResultModel and tokenFrequencyUtils.test.ts because
 * result rendering, downloads, and concordance handoffs need the same
 * response-name, selection-name, backend-key, and node-id fallback order.
 */
export const resolveTokenFrequencyDisplayName = ({
  nodeId,
  fallbackKey,
  responseOrSelectionNames,
  nodeIdToName,
}: {
  nodeId: string;
  fallbackKey?: string;
  responseOrSelectionNames: Record<string, string>;
  nodeIdToName: Record<string, string>;
}): string => {
  if (responseOrSelectionNames[nodeId]) return responseOrSelectionNames[nodeId];
  if (nodeIdToName[nodeId]) return nodeIdToName[nodeId];
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty fallbackKey/nodeId should fall back to the next display source, not render blank
  return fallbackKey || nodeId || 'Unknown node';
};

/** Reads the backend's persisted token display limit from all supported response locations. */
/**
 * Used by: TokenFrequencyFeature.tsx, tokenFrequencyUtils.test.ts.
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
 * Used by: tokenFrequencyUtils.test.ts.
 * Flow: check top-level, analysis_params, and metadata stop-word arrays in order, stringify entries, then return null when none exist.
 */
export const deriveBackendStopWords = (
  results?: TokenFrequencyResponse | null,
): string[] | null => {
  if (!results) return null;
  const candidate =
    (Array.isArray(results.stop_words) ? results.stop_words : null) ??
    (Array.isArray(results.analysis_params?.stop_words)
      ? results.analysis_params.stop_words
      : null) ??
    (Array.isArray(results.metadata?.stop_words) ? results.metadata.stop_words : null);
  return Array.isArray(candidate) ? candidate.map((item) => String(item)) : null;
};

/** Builds a stable stop-word key for effects that sync backend preferences into UI state. */
/**
 * Used by: tokenFrequencyUtils.test.ts, TokenFrequencyFeature.tsx.
 */
export const deriveBackendStopWordsKey = (results?: TokenFrequencyResponse | null): string => {
  const stopWords = deriveBackendStopWords(results);
  if (!Array.isArray(stopWords) || stopWords.length === 0) return '';
  return stopWords
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .join('|');
};
