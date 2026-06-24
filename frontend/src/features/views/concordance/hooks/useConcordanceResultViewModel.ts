import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { concordanceTaskDispersionBins } from '@/api';
import type { ConcordanceAnalysisResponse, ConcordanceDispersionBinRow } from '@/api';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import { VIZ_PALETTE } from '../../common';
import {
  buildConcordanceNodeColorMap,
  buildConcordanceSourceColorMap,
  buildMatchedTextColorMap,
  collectConcordanceMatchedTexts,
  getMaterializedBinsForConcordanceKey,
  isConcordanceBlockMaterialized,
  normalizeConcordanceLabelToNodeMap,
  resolveConcordanceNodeIdForKey,
  type TaggedBinRow,
} from '../concordanceViewModels';

interface Params {
  results: ConcordanceAnalysisResponse | null;
  concordanceTaskId: string;
  panelSelectedNodes: WorkspaceNodeLike[];
  showDispersion: boolean;
  proportionalDispersionBars: boolean;
  colourMatches: boolean;
  lowercaseMatches: boolean;
  nodeColorOverrides?: Record<string, string>;
  getAuthHeaders: () => Record<string, string>;
}

interface Result {
  materializedPaths: Record<string, string>;
  setMaterializedPaths: Dispatch<SetStateAction<Record<string, string>>>;
  materializedBins: Record<string, ConcordanceDispersionBinRow[]>;
  setMaterializedBins: Dispatch<SetStateAction<Record<string, ConcordanceDispersionBinRow[]>>>;
  labelToNodeId: Record<string, string> | null;
  defaultPalette: string[];
  nodeColors: Record<string, string>;
  sourceColorMap: Record<string, string>;
  allMatchedTexts: string[];
  matchedTextColorMap: Record<string, string>;
  resolveNodeIdForKey: (nodeKey: string) => string | null;
  isBlockMaterialised: (nodeKey: string) => boolean;
  getMaterializedBinsForKey: (nodeKey: string) => TaggedBinRow[] | undefined;
}

/**
 * Owns concordance result-display derivations and whole-corpus dispersion bin
 * cache state.
 *
 * Used by: ConcordanceFeature because the feature shell coordinates task
 * lifecycle, while this hook prepares the maps and cached rows that table,
 * metadata, and dispersion result blocks need to render consistently.
 *
 * Flow:
 * - Normalize backend label->node metadata and deterministic palette maps.
 * - Keep materialized paths/bins mutable for hydration and SSE lifecycle hooks.
 * - Fetch missing server dispersion bins only for materialized source nodes
 *   when the whole-corpus dispersion chart needs them.
 * - Expose tested lookup helpers and matched-text colour maps to result panels.
 */
export function useConcordanceResultViewModel({
  results,
  concordanceTaskId,
  panelSelectedNodes,
  showDispersion,
  proportionalDispersionBars,
  colourMatches,
  lowercaseMatches,
  nodeColorOverrides = {},
  getAuthHeaders,
}: Params): Result {
  const [materializedBins, setMaterializedBins] = useState<
    Record<string, ConcordanceDispersionBinRow[]>
  >({});
  const [materializedPaths, setMaterializedPaths] = useState<Record<string, string>>({});
  const concordanceTaskIdFallbackRef = useRef('');

  useEffect(() => {
    if (concordanceTaskId) concordanceTaskIdFallbackRef.current = concordanceTaskId;
  }, [concordanceTaskId]);

  const labelToNodeId = normalizeConcordanceLabelToNodeMap(results?.analysis_params);
  const defaultPalette = VIZ_PALETTE;
  const nodeColors = buildConcordanceNodeColorMap(
    panelSelectedNodes,
    defaultPalette,
    nodeColorOverrides,
  );
  const sourceColorMap = buildConcordanceSourceColorMap(
    panelSelectedNodes,
    nodeColors,
    defaultPalette,
  );

  const resolveNodeIdForKey = (nodeKey: string): string | null =>
    resolveConcordanceNodeIdForKey(nodeKey, panelSelectedNodes, labelToNodeId);

  const isBlockMaterialised = (nodeKey: string): boolean =>
    isConcordanceBlockMaterialized(nodeKey, {
      selectedNodes: panelSelectedNodes,
      labelToNodeId,
      materializedPaths,
    });

  const getMaterializedBinsForKey = (nodeKey: string): TaggedBinRow[] | undefined =>
    getMaterializedBinsForConcordanceKey(nodeKey, {
      selectedNodes: panelSelectedNodes,
      labelToNodeId,
      materializedPaths,
      materializedBins,
    });

  useEffect(() => {
    if (!showDispersion || proportionalDispersionBars) return;

    const effectiveTaskId = concordanceTaskId || concordanceTaskIdFallbackRef.current;
    if (!effectiveTaskId) return;

    const panelIds = new Set(
      panelSelectedNodes
        .map((node) => node.id)
        .filter((id: string | undefined): id is string => Boolean(id)),
    );
    const missing = Object.keys(materializedPaths).filter(
      (nodeId) => panelIds.has(nodeId) && !(nodeId in materializedBins),
    );
    if (missing.length === 0) return;

    let cancelled = false;
    const authHeaders = getAuthHeaders();

    void Promise.all(
      missing.map(async (nodeId) => {
        try {
          const { data: resp } = await concordanceTaskDispersionBins({
            headers: authHeaders,
            path: { task_id: effectiveTaskId },
            query: { node_id: nodeId },
            throwOnError: true,
          });
          return [nodeId, resp.rows] as const;
        } catch (err) {
          console.error('Failed to fetch concordance dispersion bins', nodeId, err);
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const successfulEntries = entries.filter(
        (entry): entry is readonly [string, ConcordanceDispersionBinRow[]] => entry !== null,
      );
      if (successfulEntries.length === 0) return;

      setMaterializedBins((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [nodeId, rows] of successfulEntries) {
          if (next[nodeId] !== rows) {
            next[nodeId] = rows;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    showDispersion,
    proportionalDispersionBars,
    concordanceTaskId,
    materializedPaths,
    materializedBins,
    panelSelectedNodes,
    getAuthHeaders,
  ]);

  const allMatchedTexts =
    showDispersion && colourMatches
      ? collectConcordanceMatchedTexts(results?.data, {
          getMaterializedBinsForKey,
          lowercaseMatches,
        })
      : [];
  const matchedTextColorMap = buildMatchedTextColorMap(allMatchedTexts, defaultPalette);

  return {
    materializedPaths,
    setMaterializedPaths,
    materializedBins,
    setMaterializedBins,
    labelToNodeId,
    defaultPalette,
    nodeColors,
    sourceColorMap,
    allMatchedTexts,
    matchedTextColorMap,
    resolveNodeIdForKey,
    isBlockMaterialised,
    getMaterializedBinsForKey,
  };
}
