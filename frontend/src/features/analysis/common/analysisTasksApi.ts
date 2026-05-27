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