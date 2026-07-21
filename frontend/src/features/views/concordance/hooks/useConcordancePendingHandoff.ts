import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceGraphNode } from '@/api';
import type { PendingConcordance } from '@/stores/analysisStore';
import type { HydrationState } from '../../common/useAnalysisHydration';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import type { ConcordanceHandoffSearchRequest } from './useConcordanceTaskFlow';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';

interface Params {
  tabId: string;
  pendingConcordance: PendingConcordance | null;
  clearPendingConcordance: () => void;
  hydrationState: HydrationState;
  selectedNodes: WorkspaceGraphNode[];
  setSearchWord: Dispatch<SetStateAction<string>>;
  setNodeColumnSelections: (
    selections: NodeColumnSelection[],
    options?: { replace?: boolean },
  ) => void;
  replaceSelectedNodes: (ids: string[], activeNodeId?: string | null) => void;
}

export interface UseConcordancePendingHandoffResult {
  autoSearchRequest: ConcordanceHandoffSearchRequest | null;
}

/**
 * Applies a `pendingConcordance` handoff from Token Frequency once the targeted
 * destination tab has mounted and hydration has settled.
 *
 * Token clicks always open a brand-new concordance tab (see
 * useTokenFrequencyTaskFlow.handleTokenClick), so the consuming feature instance
 * is always a fresh tab with no results — the seed is applied unconditionally
 * and never has to prompt about replacing existing output.
 *
 * The actual auto-search dispatch stays in the parent — it needs access to
 * `handleSearch`, which the parent already has wired up.
 */
/**
 * Used by: ConcordanceFeature.tsx.
 */
export function useConcordancePendingHandoff({
  tabId,
  pendingConcordance,
  clearPendingConcordance,
  hydrationState,
  selectedNodes,
  setSearchWord,
  setNodeColumnSelections,
  replaceSelectedNodes,
}: Params): UseConcordancePendingHandoffResult {
  const [autoSearchRequest, setAutoSearchRequest] =
    useState<ConcordanceHandoffSearchRequest | null>(null);
  const consumedPendingConcordanceRef = useRef<PendingConcordance | null>(null);

  useEffect(() => {
    if (
      pendingConcordance?.targetTabId !== tabId ||
      consumedPendingConcordanceRef.current === pendingConcordance
    ) {
      return;
    }

    const hydrationSettled =
      hydrationState.status === 'error' ||
      (hydrationState.status === 'idle' && typeof hydrationState.lastHydratedAt === 'number');
    if (!hydrationSettled) {
      return;
    }

    // Mark and clear the handoff before any downstream state writes. Parent
    // rerenders can now safely revisit this effect without applying it again.
    consumedPendingConcordanceRef.current = pendingConcordance;
    clearPendingConcordance();

    const word = pendingConcordance.searchWord;
    if (word) {
      setSearchWord(word);
    }

    if (
      Array.isArray(pendingConcordance.selectedNodes) &&
      pendingConcordance.selectedNodes.length > 0
    ) {
      const targetIds = pendingConcordance.selectedNodes
        .map((node) => (typeof node.id === 'string' ? node.id : ''))
        .filter((id): id is string => id.trim().length > 0);
      const effectiveTargetIds = takeMostRecent(targetIds, 2);
      if (effectiveTargetIds.length > 0) {
        const currentIds = selectedNodes.map((node) => node.id);
        const needsSync =
          effectiveTargetIds.length !== currentIds.length ||
          effectiveTargetIds.some((id, index) => id !== currentIds[index]);
        if (needsSync) {
          try {
            replaceSelectedNodes(effectiveTargetIds, effectiveTargetIds.at(-1));
          } catch (error) {
            console.warn('Failed to sync workspace selection from pending concordance:', error);
          }
        }
      }
    }

    if (pendingConcordance.nodeColumnSelections?.length) {
      setNodeColumnSelections(pendingConcordance.nodeColumnSelections, { replace: true });
    }

    const selectedNodeIds = takeMostRecent(
      (pendingConcordance.selectedNodes ?? [])
        .map((node) => (typeof node.id === 'string' ? node.id : ''))
        .filter((id): id is string => id.trim().length > 0),
      2,
    );
    const handoffSelections = (pendingConcordance.nodeColumnSelections ?? []).filter(
      (selection) => Boolean(selection.column),
    );
    const runnableNodeIds =
      selectedNodeIds.length > 0
        ? selectedNodeIds
        : takeMostRecent(
            handoffSelections.map((selection) => selection.nodeId),
            2,
          );
    const hasNodeTargets =
      runnableNodeIds.length > 0 &&
      runnableNodeIds.every((nodeId) =>
        handoffSelections.some((selection) => selection.nodeId === nodeId),
      );
    if (
      pendingConcordance.autoRun === true &&
      pendingConcordance.searchWord &&
      hasNodeTargets
    ) {
      const searchWord = pendingConcordance.searchWord;
      queueMicrotask(() => {
        setAutoSearchRequest({
          searchWord,
          nodeIds: runnableNodeIds,
          nodeColumnSelections: handoffSelections.map((selection) => ({ ...selection })),
        });
      });
    }
  }, [
    tabId,
    pendingConcordance,
    hydrationState.status,
    hydrationState.lastHydratedAt,
    selectedNodes,
    clearPendingConcordance,
    setNodeColumnSelections,
    replaceSelectedNodes,
    setSearchWord,
  ]);

  return {
    autoSearchRequest,
  };
}
