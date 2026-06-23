import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PendingConcordance } from '@/stores/analysisStore';
import type { HydrationState } from '../../common/useAnalysisHydration';
import type { NodeColumnSelection } from '../../common';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';

interface Params {
  pendingConcordance: PendingConcordance | null;
  clearPendingConcordance: () => void;
  hydrationState: HydrationState;
  selectedNodes: WorkspaceNodeLike[];
  setSearchWord: Dispatch<SetStateAction<string>>;
  setNodeColumnSelections: (
    selections: NodeColumnSelection[],
    options?: { replace?: boolean },
  ) => void;
  selectNodes: (ids: string[]) => void;
}

export interface UseConcordancePendingHandoffResult {
  shouldAutoSearch: boolean;
  setShouldAutoSearch: Dispatch<SetStateAction<boolean>>;
}

/**
 * Owns the queue + apply effects for `pendingConcordance` handoffs from
 * TokenFrequencyTab. Two effects:
 *
 *   1. Queue: copy `pendingConcordance` from the analysis store into local
 *      state (deferred via rAF) so hydration has a chance to finish first.
 *   2. Apply: once hydration settles, fill the search box / sync the selection /
 *      sync column selections, optionally arming the
 *      auto-search flag.
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
 * Used by: ConcordanceFeature.tsx because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export function useConcordancePendingHandoff({
  pendingConcordance,
  clearPendingConcordance,
  hydrationState,
  selectedNodes,
  setSearchWord,
  setNodeColumnSelections,
  selectNodes,
}: Params): UseConcordancePendingHandoffResult {
  const [queuedPendingConcordance, setQueuedPendingConcordance] =
    useState<PendingConcordance | null>(pendingConcordance);
  const [shouldAutoSearch, setShouldAutoSearch] = useState(false);
  const lastPendingConcordanceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pendingConcordance) return;
    if (lastPendingConcordanceRef.current === pendingConcordance.timestamp) {
      return;
    }
    lastPendingConcordanceRef.current = pendingConcordance.timestamp ?? null;
    const id = requestAnimationFrame(() => {
      setQueuedPendingConcordance(pendingConcordance);
      clearPendingConcordance();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [pendingConcordance, clearPendingConcordance]);

  useEffect(() => {
    if (!queuedPendingConcordance) {
      return;
    }

    const hydrationSettled =
      hydrationState.status === 'error' ||
      (hydrationState.status === 'idle' && typeof hydrationState.lastHydratedAt === 'number');
    if (!hydrationSettled) {
      return;
    }

    const rafIds: number[] = [];
    const word = queuedPendingConcordance.searchWord;
    if (word) {
      rafIds.push(
        requestAnimationFrame(() => {
          setSearchWord(word);
        }),
      );
    }

    if (
      Array.isArray(queuedPendingConcordance.selectedNodes) &&
      queuedPendingConcordance.selectedNodes.length > 0
    ) {
      const targetIds = queuedPendingConcordance.selectedNodes
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
            selectNodes(effectiveTargetIds);
          } catch (error) {
            console.warn('Failed to sync workspace selection from pending concordance:', error);
          }
        }
      }
    }

    if (queuedPendingConcordance.nodeColumnSelections?.length) {
      setNodeColumnSelections(queuedPendingConcordance.nodeColumnSelections, { replace: true });
    }

    let timeoutId: number | null = null;
    const hasNodeTargets =
      selectedNodes.length > 0 ||
      (queuedPendingConcordance.selectedNodes?.length ?? 0) > 0 ||
      (queuedPendingConcordance.nodeColumnSelections?.length ?? 0) > 0;
    if (
      queuedPendingConcordance.autoRun === true &&
      queuedPendingConcordance.searchWord &&
      hasNodeTargets
    ) {
      timeoutId = window.setTimeout(() => {
        setShouldAutoSearch(true);
      }, 50);
    }

    const resetId = requestAnimationFrame(() => {
      setQueuedPendingConcordance(null);
    });

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      rafIds.forEach(cancelAnimationFrame);
      cancelAnimationFrame(resetId);
    };
  }, [
    queuedPendingConcordance,
    hydrationState.status,
    hydrationState.lastHydratedAt,
    selectedNodes,
    setNodeColumnSelections,
    selectNodes,
    setSearchWord,
  ]);

  return {
    shouldAutoSearch,
    setShouldAutoSearch,
  };
}
