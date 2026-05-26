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
  AiAnnotationModelsRequest,
  AiAnnotationNodeResult as GeneratedAiAnnotationNodeResult,
  AiAnnotationRequest,
  AiAnnotationResponse as GeneratedAiAnnotationResponse,
  AiAnnotationResultQuery,
  AiAnnotationSaveRequest,
} from '@/api/generated/types.gen';

export type {
  AiAnnotationClassDef,
  AiAnnotationDetachRequest,
  AiAnnotationEdit,
  AiAnnotationExample,
  AiAnnotationModelsRequest,
  AiAnnotationRequest,
  AiAnnotationResultQuery,
  AiAnnotationSaveRequest,
} from '@/api/generated/types.gen';

export type AiAnnotationNodeResult = Omit<GeneratedAiAnnotationNodeResult, 'metadata' | 'pagination' | 'sorting'> & {
  metadata?: Record<string, unknown>;
  pagination?: {
    page: number;
    page_size: number;
    total_source_rows?: number;
    total_source_pages?: number;
    result_count?: number;
    has_next: boolean;
    has_prev: boolean;
  };
  sorting?: {
    sort_by?: string | null;
    descending: boolean;
  };
};

export type AiAnnotationResponse = Omit<GeneratedAiAnnotationResponse, 'data' | 'metadata' | 'state'> & {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  data?: Record<string, AiAnnotationNodeResult> | null;
  metadata?: { task_id?: string; [k: string]: unknown };
};

export interface AiAnnotationModelsResponse {
  state: 'successful' | 'failed';
  message: string;
  data?: {
    models?: Array<{ id: string; name: string }>;
  };
  metadata?: Record<string, unknown>;
}

export interface AiAnnotationProvidersResponse {
  state: 'successful' | 'failed';
  message: string;
  data?: {
    providers?: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface AiAnnotationCategoriesResponse {
  state: 'successful' | 'failed';
  message: string;
  data?: {
    categories?: string[];
  };
  metadata?: Record<string, unknown>;
}

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
    return data as AiAnnotationModelsResponse;
  },

  aiAnnotation: async (req: AiAnnotationRequest, headers: Record<string, string> = {}) => {
    const { data } = await runAiAnnotationApiWorkspacesAiAnnotationPost({
      body: req,
      headers,
      throwOnError: true,
    });
    return data as AiAnnotationResponse;
  },

  aiAnnotationDetach: async (
    node: string,
    req: AiAnnotationDetachRequest,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await detachAiAnnotationApiWorkspacesNodesNodeIdAiAnnotationDetachPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

  aiAnnotationSave: async (
    node: string,
    req: AiAnnotationSaveRequest,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await saveAiAnnotationApiWorkspacesNodesNodeIdAiAnnotationSavePost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
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
    return data as AiAnnotationProvidersResponse;
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
    return data as AiAnnotationCategoriesResponse;
  },

  clearAiAnnotation: async (headers: Record<string, string> = {}) => {
    const { data } = await clearAiAnnotationApiWorkspacesAiAnnotationDelete({
      headers,
      throwOnError: true,
    });
    return data as { state: string; message: string };
  },

  getAiAnnotationTaskRequest: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await aiAnnotationTaskRequestApiWorkspacesAiAnnotationTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

  getAiAnnotationTaskResult: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await aiAnnotationTaskResultApiWorkspacesAiAnnotationTasksTaskIdResultGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as AiAnnotationResponse;
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
    return data as AiAnnotationResponse;
  },
};
