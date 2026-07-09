import { analysisTaskRequest, analysisTaskResult } from '@/api';
import type { AnalysisTaskResultData } from '@/api';
import type { LastRunAnalysisType } from './analysisIds';

export type { LastRunAnalysisType };

/**
 * Fetches the original backend request for a task so feature panels can rebuild
 * input selections and parameter forms from a task-center or hydration entry.
 * Used by: useLastRunRequest and task restore flows because every analysis task
 * now exposes the same shared request endpoint.
 * Flow: keep the analysis type in the call signature for cache/readability
 * context, call the shared task request endpoint, and return the opaque
 * analysis-specific request payload to the caller.
 */
export async function getAnalysisTaskRequest(
  _analysisType: LastRunAnalysisType,
  workspaceId: string,
  taskId: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const { data } = await analysisTaskRequest({
    headers,
    path: { workspace_id: workspaceId, task_id: taskId },
    throwOnError: true,
  });
  return data;
}

/**
 * Fetches a task result through the shared analysis-task result endpoint.
 *
 * Used by: task-backed analysis features because polling and hydration should
 * not depend on the original analysis namespace once a task id is known.
 */
export async function getAnalysisTaskResult<TResult>(
  workspaceId: string,
  taskId: string,
  headers: Record<string, string>,
  query?: AnalysisTaskResultData['query'],
): Promise<TResult | null> {
  const { data } = await analysisTaskResult({
    headers,
    path: { workspace_id: workspaceId, task_id: taskId },
    query,
    throwOnError: true,
  });
  return data as TResult | null;
}
