import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from 'react';
import type { ConcordanceAnalysisResponse } from '@/lib/backend/text';
import type { PendingConcordance } from '@/stores/analysisStore';
import type { HydrationState } from '../../common/useAnalysisHydration';
import type { NodeColumnSelection } from '../../common';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';
import { takeMostRecent } from '@/utils/selectionUtils';

const hasSuccessfulConcordanceResults = (
  result: ConcordanceAnalysisResponse | null,
): boolean => Boolean(result && result.state === 'successful');

type Params = {
  pendingConcordance: PendingConcordance | null;
  clearPendingConcordance: () => void;
  hydrationState: HydrationState;
  results: ConcordanceAnalysisResponse | null;
  selectedNodes: WorkspaceNodeLike[];
  setSearchWord: Dispatch<SetStateAction<string>>;
  setNodeColumnSelections: (selections: NodeColumnSelection[], options?: { replace?: boolean }) => void;
  selectNodes: (ids: string[]) => void;
  handleColorChange: (nodeId: string, color: string) => void;
};

export type UseConcordancePendingHandoffResult = {
  queuedPendingConcordance: PendingConcordance | null;
  setQueuedPendingConcordance: Dispatch<SetStateAction<PendingConcordance | null>>;
  handoffConfirmOpen: boolean;
  setHandoffConfirmOpen: Dispatch<SetStateAction<boolean>>;
  handoffConfirmingRef: MutableRefObject<boolean>;
  shouldAutoSearch: boolean;
  setShouldAutoSearch: Dispatch<SetStateAction<boolean>>;
};

/**
 * Owns the queue + apply effects for `pendingConcordance` handoffs from
 * TokenFrequencyTab. Two effects:
 *
 *   1. Queue: copy `pendingConcordance` from the analysis store into local
 *      state (deferred via rAF) so hydration has a chance to finish first.
 *   2. Apply: once hydration settles, either prompt for confirmation (when
 *      results already exist) or fill the search box / sync the selection /
 *      sync per-node colours and column selections, optionally arming the
 *      auto-search flag.
 *
 * The actual auto-search dispatch + confirm/cancel handlers stay in the
 * parent — they need access to `handleSearch` and `clearResults`, which the
 * parent already has wired up.
 */
export function useConcordancePendingHandoff({
  pendingConcordance,
  clearPendingConcordance,
  hydrationState,
  results,
  selectedNodes,
  setSearchWord,
  setNodeColumnSelections,
  selectNodes,
  handleColorChange,
}: Params): UseConcordancePendingHandoffResult {
  const [queuedPendingConcordance, setQueuedPendingConcordance] =
    useState<PendingConcordance | null>(pendingConcordance);
  const [handoffConfirmOpen, setHandoffConfirmOpen] = useState(false);
  const [shouldAutoSearch, setShouldAutoSearch] = useState(false);
  const lastPendingConcordanceRef = useRef<number | null>(null);
  const handoffConfirmingRef = useRef(false);

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
    return () => cancelAnimationFrame(id);
  }, [pendingConcordance, clearPendingConcordance]);

  useEffect(() => {
    if (!queuedPendingConcordance) {
      if (handoffConfirmOpen) {
        const id = requestAnimationFrame(() => setHandoffConfirmOpen(false));
        return () => cancelAnimationFrame(id);
      }
      return;
    }

    const hydrationSettled =
      hydrationState.status === 'error' ||
      (hydrationState.status === 'idle' && typeof hydrationState.lastHydratedAt === 'number');
    if (!hydrationSettled) {
      return;
    }

    if (hasSuccessfulConcordanceResults(results)) {
      if (!handoffConfirmOpen) {
        const id = requestAnimationFrame(() => setHandoffConfirmOpen(true));
        return () => cancelAnimationFrame(id);
      }
      return;
    }

    const rafIds: number[] = [];
    const word = queuedPendingConcordance.searchWord;
    if (word) {
      rafIds.push(requestAnimationFrame(() => setSearchWord(word)));
    }

    if (
      Array.isArray(queuedPendingConcordance.selectedNodes)
      && queuedPendingConcordance.selectedNodes.length > 0
    ) {
      const targetIds = queuedPendingConcordance.selectedNodes
        .map((node) => (typeof node?.id === 'string' ? node.id : ''))
        .filter((id): id is string => id.trim().length > 0);
      const effectiveTargetIds = takeMostRecent(targetIds, 2);
      if (effectiveTargetIds.length > 0) {
        const currentIds = selectedNodes.map((node) => node.id);
        const needsSync =
          effectiveTargetIds.length !== currentIds.length
          || effectiveTargetIds.some((id, index) => id !== currentIds[index]);
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

    if (queuedPendingConcordance.nodeColors) {
      Object.entries(queuedPendingConcordance.nodeColors).forEach(([nodeId, color]) => {
        handleColorChange(nodeId, color as string);
      });
    }

    let timeoutId: number | null = null;
    const hasNodeTargets =
      selectedNodes.length > 0
      || (queuedPendingConcordance.selectedNodes?.length ?? 0) > 0
      || (queuedPendingConcordance.nodeColumnSelections?.length ?? 0) > 0;
    if (queuedPendingConcordance.autoRun === true && queuedPendingConcordance.searchWord && hasNodeTargets) {
      timeoutId = window.setTimeout(() => {
        setShouldAutoSearch(true);
      }, 50);
    }

    const resetId = requestAnimationFrame(() => {
      setQueuedPendingConcordance(null);
      setHandoffConfirmOpen(false);
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
    results,
    handoffConfirmOpen,
    selectedNodes,
    setNodeColumnSelections,
    selectNodes,
    handleColorChange,
    setSearchWord,
  ]);

  return {
    queuedPendingConcordance,
    setQueuedPendingConcordance,
    handoffConfirmOpen,
    setHandoffConfirmOpen,
    handoffConfirmingRef,
    shouldAutoSearch,
    setShouldAutoSearch,
  };
}
