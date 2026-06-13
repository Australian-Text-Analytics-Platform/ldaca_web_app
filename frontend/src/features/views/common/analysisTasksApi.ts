import {
  aiAnnotationTaskRequest,
  concordanceTaskRequest,
  quotationTaskRequest,
  sequentialAnalysisTaskRequest,
  tokenFrequenciesTaskRequest,
  topicModelingTaskRequest,
} from '@/api/generated/sdk.gen';

export type LastRunAnalysisType =
  | 'token_frequencies'
  | 'quotation_analysis'
  | 'concordance_analysis'
  | 'ai_annotation'
  | 'topic_modeling'
  | 'sequential_analysis';

/**
 * Fetches the original backend request for a task so feature panels can rebuild
 * input selections and parameter forms from a task-center or hydration entry.
 * Used by: useLastRunRequest and task restore flows because they need task ids resolved through the matching generated task-request endpoint.
 * Flow: normalize inputs, apply the analysis-specific branch, then return the derived value consumed by the caller.
 */
export async function getAnalysisTaskRequest(
  analysisType: LastRunAnalysisType,
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
