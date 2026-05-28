import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useAnalysisTaskStatus } from '@/hooks/useAnalysisTaskStatus';

type TerminalState = 'successful' | 'failed' | 'cancelled';

/** Terminal states that require clearing per-node materialization spinners. */
const TERMINAL_STATES: ReadonlySet<TerminalState> = new Set(['successful', 'failed', 'cancelled']);

/** Called by: useMaterializeLifecycle before dispatching materialize task callbacks because callers need shared hook state and handlers without duplicating analysis lifecycle wiring. */
const isTerminalState = (value: unknown): value is TerminalState =>
  typeof value === 'string' && TERMINAL_STATES.has(value as TerminalState);

export type UseMaterializeLifecycleParams = {
  /**
   * Task type to subscribe to via {@link useAnalysisTaskStatus}, e.g.
   * `'concordance_materialize'` or `'quotation_materialize'`.
   */
  taskType: string;
  /** Per-node tracker: `nodeId → materialize taskId`. */
  materializeTaskIds: Record<string, string>;
  setNodeMaterializing: Dispatch<SetStateAction<Record<string, boolean>>>;
  setMaterializeTaskIds: Dispatch<SetStateAction<Record<string, string>>>;
  /**
   * Called once the materialize task settles successfully. Receives the node
   * id whose task settled and the settled task id. Use it to refetch the
   * parent task request, update local materialized-path state, and reset
   * pagination — anything feature-specific.
   */
  onTerminalSuccess?: (nodeId: string, taskId: string) => void | Promise<void>;
  /**
   * Called when the materialize task settles in a non-success terminal
   * state (`failed` or `cancelled`). Use it to surface a toast.
   */
  onTerminalFailure?: (nodeId: string, state: 'failed' | 'cancelled') => void;
};

/**
 * Watches `<feature>_materialize` task status and, on terminal state, clears
 * the per-node loading flag + tracked task id. On success, dispatches
 * `onTerminalSuccess` so the caller can refresh feature-specific state
 * (materialized paths, summaries, page-size resets, refetches). On
 * `failed`/`cancelled`, dispatches `onTerminalFailure`.
 *
 * Each task id is processed at most once via a module-internal `Set` ref —
 * concurrent re-renders of `useAnalysisTaskStatus` are safe.
 *
 * Use cases:
 *   - Concordance (multi-node): pair with the SSE event consumer; the
 *     success callback merges per-node paths + summaries and resets the
 *     global page size to 20.
 *   - Quotation (single-node): the success callback writes the singular
 *     materialized_path / summary and calls handlePageSizeChange(20).
 * Used by: concordance and quotation materialization flows because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export function useMaterializeLifecycle({
  taskType,
  materializeTaskIds,
  setNodeMaterializing,
  setMaterializeTaskIds,
  onTerminalSuccess,
  onTerminalFailure,
}: UseMaterializeLifecycleParams): void {
  const status = useAnalysisTaskStatus([taskType]);
  const processedTaskIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const trackedEntries = Object.entries(materializeTaskIds);
    if (trackedEntries.length === 0) return;

    for (const task of status.tasks) {
      const taskId = task?.task_id;
      if (!taskId) continue;
      if (processedTaskIdsRef.current.has(taskId)) continue;
      const state = task?.state;
      if (!isTerminalState(state)) continue;

      const nodeEntry = trackedEntries.find(([, trackedId]) => trackedId === taskId);
      if (!nodeEntry) continue;
      const [nodeId] = nodeEntry;

      processedTaskIdsRef.current.add(taskId);
      setNodeMaterializing((prev) => {
        if (!prev[nodeId]) return prev;
        const { [nodeId]: _removed, ...next } = prev;
        void _removed;
        return next;
      });
      setMaterializeTaskIds((prev) => {
        if (!(nodeId in prev)) return prev;
        const { [nodeId]: _removed, ...next } = prev;
        void _removed;
        return next;
      });

      if (state === 'successful') {
        if (onTerminalSuccess) {
          void onTerminalSuccess(nodeId, taskId);
        }
      } else if (onTerminalFailure) {
        onTerminalFailure(nodeId, state);
      }
    }
  }, [
    status.tasks,
    materializeTaskIds,
    setNodeMaterializing,
    setMaterializeTaskIds,
    onTerminalSuccess,
    onTerminalFailure,
  ]);
}
