import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import {
  type ConcordanceDispersionBinRow,
  textApi,
} from '@/lib/backend/text';
import type { AnalysisMaterializedEvent } from '@/stores/analysisStore';
import { useMaterializeLifecycle } from '../../common/hooks/useMaterializeLifecycle';
import type { PaginationState } from './useConcordanceTaskFlow';

type MaterializeSummary = {
  recordCount: number;
  uniqueDocuments: number;
  totalDocuments: number;
};

type Params = {
  concordanceTaskId: string;
  materializeTaskIds: Record<string, string>;
  materializedEvents: AnalysisMaterializedEvent[];
  getAuthHeaders: () => Record<string, string>;
  resolveTaskId: () => Promise<string | null>;
  persistResultPreferences: (partial: { pageSize?: number }) => Promise<unknown>;
  setNodeMaterializing: Dispatch<SetStateAction<Record<string, boolean>>>;
  setMaterializeTaskIds: Dispatch<SetStateAction<Record<string, string>>>;
  setMaterializedPaths: Dispatch<SetStateAction<Record<string, string>>>;
  setMaterializeSummaries: Dispatch<SetStateAction<Record<string, MaterializeSummary>>>;
  setMaterializedBins: Dispatch<SetStateAction<Record<string, ConcordanceDispersionBinRow[]>>>;
  setGlobalPageSize: Dispatch<SetStateAction<number>>;
  setNodePagination: Dispatch<SetStateAction<PaginationState>>;
};

export type UseConcordanceMaterializedEventsResult = {
  /**
   * Live ref tracking the most-recent non-empty concordance task id. Used by
   * downstream effects (bin fetcher) that need to keep working through brief
   * windows where `results.metadata.task_id` is undefined while a refetch is
   * in flight.
   */
  concordanceTaskIdRef: MutableRefObject<string>;
  /**
   * Reset the dedup tracker for processed `analysis_materialized` events.
   * Call this from the hydration callback so a re-run can re-apply events
   * for the new task.
   */
  resetProcessedEvents: () => void;
};

/**
 * Owns the three effects that keep concordance state in sync with the task
 * pipeline:
 *
 *   1. Watch `concordance_materialize` task status and, on terminal state,
 *      clear the per-node loading flag, fetch the parent task request to pick
 *      up new materialized_paths, and (on success) reset page-size to the
 *      default before refetching.
 *   2. Reset cached materialised state when the parent concordance task id
 *      actually changes (skipping the empty → first-id transition, since
 *      that's the hydration path).
 *   3. Apply `analysis_materialized` SSE events for the current concordance
 *      task. The backend pushes these the moment the per-node parquet is
 *      persisted, so they don't race with the parent-task save the way the
 *      GET-based fallback can.
 */
export function useConcordanceMaterializedEvents({
  concordanceTaskId,
  materializeTaskIds,
  materializedEvents,
  getAuthHeaders,
  resolveTaskId,
  persistResultPreferences,
  setNodeMaterializing,
  setMaterializeTaskIds,
  setMaterializedPaths,
  setMaterializeSummaries,
  setMaterializedBins,
  setGlobalPageSize,
  setNodePagination,
}: Params): UseConcordanceMaterializedEventsResult {
  const concordanceTaskIdRef = useRef<string>('');
  const processedMaterializedEventSeqRef = useRef<Set<number>>(new Set());

  const handleMaterializeSuccess = useCallback(async (_nodeId: string, _taskId: string) => {
    void _nodeId;
    void _taskId;
    toast.success('Process All complete.');

    // Refetch parent concordance task request to learn the newly-persisted
    // materialized_paths map; then reset page_size to 20 and refetch results
    // so the table re-renders with occurrence-row semantics. Note: the
    // authoritative path arrives via the `analysis_materialized` SSE event
    // (handled separately) — this fetch is best-effort additional coverage.
    try {
      const headers = getAuthHeaders();
      const parentTaskId = await resolveTaskId();
      if (parentTaskId) {
        const req = await textApi.getConcordanceTaskRequest(parentTaskId, headers);
        const reqObj = (req as Record<string, unknown>) ?? {};
        const paths = (reqObj.materialized_paths as Record<string, string> | undefined) ?? undefined;
        if (paths && typeof paths === 'object') {
          setMaterializedPaths((prev) => ({ ...prev, ...paths }));
        }
        const summaries = reqObj.materialize_summaries as Record<string, Record<string, unknown>> | undefined;
        if (summaries && typeof summaries === 'object') {
          const parsed: Record<string, MaterializeSummary> = {};
          for (const [nid, s] of Object.entries(summaries)) {
            parsed[nid] = {
              recordCount: Number(s.record_count) || 0,
              uniqueDocuments: Number(s.unique_documents_with_hits) || 0,
              totalDocuments: Number(s.total_source_documents) || 0,
            };
          }
          setMaterializeSummaries((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch (error) {
      console.warn('Failed to refresh concordance task request after materialize', error);
    }

    setGlobalPageSize(20);
    setNodePagination((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((key) => {
        updated[key] = { ...updated[key]!, pageSize: 20, currentPage: 1 };
      });
      return updated;
    });

    try {
      await persistResultPreferences({ pageSize: 20 });
    } catch (error) {
      console.warn('Failed to refetch concordance after materialize', error);
    }
  }, [
    getAuthHeaders,
    resolveTaskId,
    persistResultPreferences,
    setMaterializedPaths,
    setMaterializeSummaries,
    setGlobalPageSize,
    setNodePagination,
  ]);

  const handleMaterializeFailure = useCallback((_nodeId: string, state: 'failed' | 'cancelled') => {
    void _nodeId;
    toast.error(`Process All ${state}`);
  }, []);

  useMaterializeLifecycle({
    taskType: 'concordance_materialize',
    materializeTaskIds,
    setNodeMaterializing,
    setMaterializeTaskIds,
    onTerminalSuccess: handleMaterializeSuccess,
    onTerminalFailure: handleMaterializeFailure,
  });

  // Real task switch — taskA → taskB with both non-empty — only happens when
  // the user clicks Run/Update and a new analysis task is created. The
  // empty → first-id transition is hydration; `onHydratedRequest` is the
  // authoritative source for that path, so we skip the reset there.
  useEffect(() => {
    if (!concordanceTaskId) return;
    const prev = concordanceTaskIdRef.current;
    if (prev && prev !== concordanceTaskId) {
      setMaterializedPaths({});
      setMaterializedBins({});
      setMaterializeSummaries({});
      processedMaterializedEventSeqRef.current = new Set();
    }
    concordanceTaskIdRef.current = concordanceTaskId;
  }, [concordanceTaskId, setMaterializedPaths, setMaterializedBins, setMaterializeSummaries]);

  useEffect(() => {
    if (materializedEvents.length === 0) return;
    const effectiveTaskId = concordanceTaskId || concordanceTaskIdRef.current;
    if (!effectiveTaskId) return;
    for (const event of materializedEvents) {
      if (processedMaterializedEventSeqRef.current.has(event.sequence)) continue;
      // Accept events from both standalone "Process All" and the
      // dispersion-detach side-effect: the latter writes the same flat
      // parquet, so the materialised-paths cache should pick it up either
      // way and the dispersion view's scope dropdown then flips to
      // "whole data block" automatically.
      if (
        event.taskType !== 'concordance_materialize'
        && event.taskType !== 'concordance_dispersion_detach'
      ) continue;
      if (event.parentTaskId !== effectiveTaskId) continue;
      processedMaterializedEventSeqRef.current.add(event.sequence);
      setMaterializedPaths((prev) => ({ ...prev, [event.parentNodeId]: event.materializedPath }));
    }
  }, [concordanceTaskId, materializedEvents, setMaterializedPaths]);

  return {
    concordanceTaskIdRef,
    resetProcessedEvents: () => {
      processedMaterializedEventSeqRef.current = new Set();
    },
  };
}
