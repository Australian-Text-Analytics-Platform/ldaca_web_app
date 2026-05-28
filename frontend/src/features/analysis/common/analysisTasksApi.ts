import {
  aiAnnotationCurrentTasks,
  aiAnnotationTaskRequest,
  concordanceCurrentTasks,
  concordanceTaskRequest,
  quotationCurrentTasks,
  quotationTaskRequest,
  sequentialAnalysisCurrentTasks,
  sequentialAnalysisTaskRequest,
  tokenFrequenciesCurrentTasks,
  tokenFrequenciesTaskRequest,
  topicModelingCurrentTasks,
  topicModelingTaskRequest,
} from '@/api/generated/sdk.gen';

export type ServerLockAnalysisType =
  | 'token_frequencies'
  | 'quotation_analysis'
  | 'concordance_analysis'
  | 'ai_annotation'
  | 'topic_modeling'
  | 'sequential_analysis';

/**
 * Routes lock/polling hooks to the generated "current tasks" endpoint that
 * matches each analysis tab, including legacy tab aliases still emitted by UI code.
 * Used by: useAnalysisServerRequestLock and hydration helpers because they need one switch that maps UI analysis aliases to generated current-task endpoints.
 * Flow: normalize inputs, apply the analysis-specific branch, then return the derived value consumed by the caller.
 */
export async function getCurrentAnalysisTask(
  analysisType: ServerLockAnalysisType | string,
  headers: Record<string, string>,
): Promise<unknown> {
  switch (analysisType) {
    case 'concordance':
    case 'concordance_analysis': {
      const { data } = await concordanceCurrentTasks({ headers, throwOnError: true });
      return data;
    }
    case 'quotation':
    case 'quotation_analysis': {
      const { data } = await quotationCurrentTasks({ headers, throwOnError: true });
      return data;
    }
    case 'ai_annotation': {
      const { data } = await aiAnnotationCurrentTasks({ headers, throwOnError: true });
      return data;
    }
    case 'token_frequencies': {
      const { data } = await tokenFrequenciesCurrentTasks({ headers, throwOnError: true });
      return data;
    }
    case 'topic_modeling': {
      const { data } = await topicModelingCurrentTasks({ headers, throwOnError: true });
      return data;
    }
    case 'sequential_analysis': {
      const { data } = await sequentialAnalysisCurrentTasks({ headers, throwOnError: true });
      return data;
    }
    default:
      throw new Error(`Unsupported analysis type: ${analysisType}`);
  }
}

/**
 * Fetches the original backend request for a task so feature panels can rebuild
 * locked selections and parameter forms from a task-center or hydration entry.
 * Used by: useAnalysisServerRequestLock and task restore flows because they need task-center ids resolved through the matching generated task-request endpoint.
 * Flow: normalize inputs, apply the analysis-specific branch, then return the derived value consumed by the caller.
 */
export async function getAnalysisTaskRequest(
  analysisType: ServerLockAnalysisType,
  taskId: string,
  headers: Record<string, string>,
): Promise<unknown> {
  switch (analysisType) {
    case 'token_frequencies': {
      const { data } = await tokenFrequenciesTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    }
    case 'quotation_analysis': {
      const { data } = await quotationTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    }
    case 'concordance_analysis': {
      const { data } = await concordanceTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    }
    case 'ai_annotation': {
      const { data } = await aiAnnotationTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    }
    case 'topic_modeling': {
      const { data } = await topicModelingTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    }
    case 'sequential_analysis': {
      const { data } = await sequentialAnalysisTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    }
  }
}