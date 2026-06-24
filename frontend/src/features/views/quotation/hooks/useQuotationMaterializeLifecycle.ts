import type { Dispatch, SetStateAction } from 'react';
import { quotationTaskRequest } from '@/api';
import { useMaterializeLifecycle } from '../../common/hooks/useMaterializeLifecycle';

interface UseQuotationMaterializeLifecycleParams {
  materializeTaskIds: Record<string, string>;
  setNodeMaterializing: Dispatch<SetStateAction<Record<string, boolean>>>;
  setMaterializeTaskIds: Dispatch<SetStateAction<Record<string, string>>>;
  getAuthHeaders: () => Record<string, string>;
  resolveTaskId: () => Promise<string | null>;
  handlePageSizeChange: (pageSize: number) => Promise<void>;
  applyMaterializedRequest: (
    nodeId: string,
    materializedPath: unknown,
    materializeSummary: Record<string, unknown> | undefined,
  ) => void;
}

/**
 * Watches Quotation materialization tasks and refreshes the parent task request
 * when a materialize task succeeds.
 * Used by: QuotationFeature because the feature owns the task ids/result
 * control setters, but the background task completion flow is independent from
 * parameter rendering.
 * Flow: delegate terminal-state tracking to useMaterializeLifecycle, refetch
 * the parent quotation request on success, merge materialized path/summary into
 * result controls, and reset page size to the default occurrence-row page.
 */
export function useQuotationMaterializeLifecycle({
  materializeTaskIds,
  setNodeMaterializing,
  setMaterializeTaskIds,
  getAuthHeaders,
  resolveTaskId,
  handlePageSizeChange,
  applyMaterializedRequest,
}: UseQuotationMaterializeLifecycleParams): void {
  const handleMaterializeSuccess = async (nodeId: string, _taskId: string) => {
    void _taskId;
    try {
      const headers = getAuthHeaders();
      const parentTaskId = await resolveTaskId();
      if (parentTaskId) {
        const { data: requestPayload } = await quotationTaskRequest({
          headers,
          path: { task_id: parentTaskId },
          throwOnError: true,
        });
        const requestObject = (requestPayload as Record<string, unknown> | null) ?? {};
        applyMaterializedRequest(
          nodeId,
          requestObject.materialized_path,
          requestObject.materialize_summary as Record<string, unknown> | undefined,
        );
      }
    } catch (error) {
      console.warn('Failed to refresh quotation task request after materialize', error);
    }

    try {
      await handlePageSizeChange(20);
    } catch (error) {
      console.warn('Failed to reset quotation page size after materialize', error);
    }
  };

  useMaterializeLifecycle({
    taskType: 'quotation_materialize',
    materializeTaskIds,
    setNodeMaterializing,
    setMaterializeTaskIds,
    onTerminalSuccess: handleMaterializeSuccess,
  });
}
