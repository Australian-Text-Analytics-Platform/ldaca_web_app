import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceGraphNode } from '@/api';
import type { PendingConcordance } from '@/stores/analysisStore';
import type { HydrationState } from '../../common/useAnalysisHydration';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import type { ConcordanceHandoffSearchRequest } from './useConcordanceTaskFlow';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';

interface Params {
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
 * Owns the queue + apply effects for `pendingConcordance` handoffs from
 * TokenFrequencyTab. Two effects:
 *
 *   1. Queue: copy `pendingConcordance` from the analysis store into local
 *      state (deferred via rAF) so hydration has a chance to finish first.
 *   2. Apply: once hydration settles, fill the search box / sync the selection /
 *      sync column selections, and optionally publish one runnable request
 *      snapshot for automatic submission.
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
  pendingConcordance,
  clearPendingConcordance,
  hydrationState,
  selectedNodes,
  setSearchWord,
  setNodeColumnSelections,
  replaceSelectedNodes,
}: Params): UseConcordancePendingHandoffResult {
  const [queuedPendingConcordance, setQueuedPendingConcordance] =
    useState<PendingConcordance | null>(pendingConcordance);
  const [autoSearchRequest, setAutoSearchRequest] =
    useState<ConcordanceHandoffSearchRequest | null>(null);
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
            replaceSelectedNodes(effectiveTargetIds, effectiveTargetIds.at(-1));
          } catch (error) {
            console.warn('Failed to sync workspace selection from pending concordance:', error);
          }
        }
      }
    }

    if (queuedPendingConcordance.nodeColumnSelections?.length) {
      setNodeColumnSelections(queuedPendingConcordance.nodeColumnSelections, { replace: true });
    }

    const selectedNodeIds = takeMostRecent(
      (queuedPendingConcordance.selectedNodes ?? [])
        .map((node) => (typeof node.id === 'string' ? node.id : ''))
        .filter((id): id is string => id.trim().length > 0),
      2,
    );
    const handoffSelections = (queuedPendingConcordance.nodeColumnSelections ?? []).filter(
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
      queuedPendingConcordance.autoRun === true &&
      queuedPendingConcordance.searchWord &&
      hasNodeTargets
    ) {
      rafIds.push(
        requestAnimationFrame(() => {
          setAutoSearchRequest({
            searchWord: queuedPendingConcordance.searchWord ?? '',
            nodeIds: runnableNodeIds,
            nodeColumnSelections: handoffSelections.map((selection) => ({ ...selection })),
          });
        }),
      );
    }

    const resetId = requestAnimationFrame(() => {
      setQueuedPendingConcordance(null);
    });

    return () => {
      rafIds.forEach(cancelAnimationFrame);
      cancelAnimationFrame(resetId);
    };
  }, [
    queuedPendingConcordance,
    hydrationState.status,
    hydrationState.lastHydratedAt,
    selectedNodes,
    setNodeColumnSelections,
    replaceSelectedNodes,
    setSearchWord,
  ]);

  return {
    autoSearchRequest,
  };
}
