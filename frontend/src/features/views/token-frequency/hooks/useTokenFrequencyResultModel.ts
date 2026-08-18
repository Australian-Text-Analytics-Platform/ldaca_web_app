import { useCallback, useMemo } from 'react';
import type { TokenFrequencyResponse } from '@/api';
import {
  buildResponseDisplayNameHints,
  deriveNodeDisplayResults,
  deriveResultDisplayNodeIds,
  normalizeNodeResults,
} from '../tokenFrequencyAdapters';
import { resolveTokenFrequencyDisplayName } from '../tokenFrequencyUtils';
import { useTokenFrequencyDownloads } from './useTokenFrequencyDownloads';

interface UseTokenFrequencyResultModelParams {
  results: TokenFrequencyResponse | null;
  lastCompareNodeIds: string[];
  nodeColumnSelections: { nodeId: string }[];
  lockedNodeNameMap: Record<string, string>;
  nodeIdToName: Record<string, string>;
  appliedStopSet: Set<string>;
  effectiveTokenLimit: number | null;
  stopWords: string;
}

/**
 * Owns token-frequency result display derivation and download refs.
 * Used by: TokenFrequencyFeature because the feature shell should wire task
 * lifecycle and panels while this hook keeps expensive result adapters,
 * display-name fallbacks, and export state in one place.
 * Flow: combine response/selection display names, project completed-result ids
 * into tab-input order, normalize backend rows, apply stop-word/limit filters, and expose
 * download-dialog handlers for the rendered result sections.
 */
export const useTokenFrequencyResultModel = ({
  results,
  lastCompareNodeIds,
  nodeColumnSelections,
  lockedNodeNameMap,
  nodeIdToName,
  appliedStopSet,
  effectiveTokenLimit,
  stopWords,
}: UseTokenFrequencyResultModelParams) => {
  const responseDisplayNameHints = useMemo(() => buildResponseDisplayNameHints(results), [results]);

  const displayNameMap = useMemo(
    () => ({
      ...lockedNodeNameMap,
      ...responseDisplayNameHints,
    }),
    [responseDisplayNameHints, lockedNodeNameMap],
  );

  // ``useCallback`` keeps this referentially stable across keystrokes so the
  // ``normalizeNodeResults`` memo below doesn't bust on every render of the
  // parent (e.g. typing in the stop-words textarea). Without it, the heavy
  // ``normalizeNodeResults`` + ``deriveNodeDisplayResults`` adapters re-run
  // on every character because both walk every row in every node.
  const computeDisplayName = useCallback(
    (nodeId: string, fallbackKey?: string) =>
      resolveTokenFrequencyDisplayName({
        nodeId,
        fallbackKey,
        responseOrSelectionNames: displayNameMap,
        nodeIdToName,
      }),
    [displayNameMap, nodeIdToName],
  );

  const displayNodeIds = useMemo(
    () => deriveResultDisplayNodeIds(lastCompareNodeIds, nodeColumnSelections),
    [lastCompareNodeIds, nodeColumnSelections],
  );

  const downloads = useTokenFrequencyDownloads({
    stopWords,
    // Downloads encode Reference/Study semantics, so they consume the
    // immutable comparison order rather than the card presentation order.
    analysisNodeIds: lastCompareNodeIds,
    computeDisplayName,
  });

  const normalizedNodeResults = useMemo(
    () => normalizeNodeResults(results?.data, displayNodeIds, computeDisplayName),
    [results, displayNodeIds, computeDisplayName],
  );

  const nodeDisplayResults = useMemo(
    () => deriveNodeDisplayResults(normalizedNodeResults, appliedStopSet, effectiveTokenLimit),
    [normalizedNodeResults, appliedStopSet, effectiveTokenLimit],
  );

  return {
    computeDisplayName,
    displayNodeIds,
    normalizedNodeResults,
    nodeDisplayResults,
    ...downloads,
  };
};
