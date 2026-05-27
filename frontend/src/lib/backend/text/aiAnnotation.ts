import {
  aiAnnotationTaskRequestApiWorkspacesAiAnnotationTasksTaskIdRequestGet,
  aiAnnotationTaskResultApiWorkspacesAiAnnotationTasksTaskIdResultGet,
  aiAnnotationTaskResultPostApiWorkspacesAiAnnotationTasksTaskIdResultPost,
  clearAiAnnotationApiWorkspacesAiAnnotationDelete,
  detachAiAnnotationApiWorkspacesNodesNodeIdAiAnnotationDetachPost,
  getAiAnnotationCategoriesApiWorkspacesNodesNodeIdAiAnnotationCategoriesGet,
  getAiAnnotationModelsApiWorkspacesAiAnnotationModelsPost,
  getAiAnnotationProvidersApiWorkspacesNodesNodeIdAiAnnotationProvidersGet,
  runAiAnnotationApiWorkspacesAiAnnotationPost,
  saveAiAnnotationApiWorkspacesNodesNodeIdAiAnnotationSavePost,
} from '@/api/generated/sdk.gen';
import type {
  AiAnnotationDetachRequest,
  AiAnnotationDetachResponse,
  AiAnnotationModelsRequest,
  AiAnnotationRequest,
  AiAnnotationResultQuery,
  AiAnnotationSaveResponse,
  AiAnnotationSaveRequest,
  AnalysisClearResponse,
} from '@/api/generated/types.gen';

export type {
  AiAnnotationClassDef,
  AiAnnotationDetachRequest,
  AiAnnotationDetachResponse,
  AiAnnotationEdit,
  AiAnnotationExample,
  AiAnnotationModelsResponse,
  AiAnnotationModelsRequest,
  AiAnnotationNodeResult as AiAnnotationNodeResultView,
  AiAnnotationProvidersResponse,
  AiAnnotationCategoriesResponse,
  AiAnnotationRequest,
  AiAnnotationResponse as AiAnnotationResultResponse,
  AiAnnotationResultQuery,
  AiAnnotationSaveResponse,
  AiAnnotationSaveRequest,
  AnalysisClearResponse,
} from '@/api/generated/types.gen';

export const aiAnnotationApi = {
  aiAnnotationModels: async (
    body: AiAnnotationModelsRequest,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await getAiAnnotationModelsApiWorkspacesAiAnnotationModelsPost({
      body,
      headers,
      throwOnError: true,
    });
    return data;
  },

  aiAnnotation: async (req: AiAnnotationRequest, headers: Record<string, string> = {}) => {
    const { data } = await runAiAnnotationApiWorkspacesAiAnnotationPost({
      body: req,
      headers,
      throwOnError: true,
    });
    return data;
  },

  aiAnnotationDetach: async (
    node: string,
    req: AiAnnotationDetachRequest,
    headers: Record<string, string> = {},
  ): Promise<AiAnnotationDetachResponse> => {
    const { data } = await detachAiAnnotationApiWorkspacesNodesNodeIdAiAnnotationDetachPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },

  aiAnnotationSave: async (
    node: string,
    req: AiAnnotationSaveRequest,
    headers: Record<string, string> = {},
  ): Promise<AiAnnotationSaveResponse> => {
    const { data } = await saveAiAnnotationApiWorkspacesNodesNodeIdAiAnnotationSavePost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },

  aiAnnotationProviders: async (
    node: string,
    annotationColumn: string,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await getAiAnnotationProvidersApiWorkspacesNodesNodeIdAiAnnotationProvidersGet({
      headers,
      path: { node_id: node },
      query: { annotation_column: annotationColumn },
      throwOnError: true,
    });
    return data;
  },

  aiAnnotationCategories: async (
    node: string,
    annotationColumn: string,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await getAiAnnotationCategoriesApiWorkspacesNodesNodeIdAiAnnotationCategoriesGet({
      headers,
      path: { node_id: node },
      query: { annotation_column: annotationColumn },
      throwOnError: true,
    });
    return data;
  },

  clearAiAnnotation: async (headers: Record<string, string> = {}): Promise<AnalysisClearResponse> => {
    const { data } = await clearAiAnnotationApiWorkspacesAiAnnotationDelete({
      headers,
      throwOnError: true,
    });
    return data;
  },

  getAiAnnotationTaskRequest: async (taskId: string, headers: Record<string, string> = {}): Promise<AiAnnotationRequest> => {
    const { data } = await aiAnnotationTaskRequestApiWorkspacesAiAnnotationTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
  },

  getAiAnnotationTaskResult: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await aiAnnotationTaskResultApiWorkspacesAiAnnotationTasksTaskIdResultGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
  },

  postAiAnnotationTaskResult: async (
    taskId: string,
    body: AiAnnotationResultQuery,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await aiAnnotationTaskResultPostApiWorkspacesAiAnnotationTasksTaskIdResultPost({
      body,
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
  },
};
