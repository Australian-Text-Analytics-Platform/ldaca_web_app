import {
  detachQuotationApiWorkspacesNodesNodeIdQuotationDetachPost,
  getQuotationApiWorkspacesNodesNodeIdQuotationPost,
  materializeQuotationApiWorkspacesNodesNodeIdQuotationMaterializePost,
  quotationDetachOptionsApiWorkspacesNodesNodeIdQuotationDetachOptionsGet,
  quotationTaskRequestApiWorkspacesQuotationTasksTaskIdRequestGet,
  quotationTaskResultApiWorkspacesQuotationTasksTaskIdResultGet,
  updateQuotationTaskResultApiWorkspacesQuotationTasksTaskIdResultPost,
} from '@/api/generated/sdk.gen';

import type { SourceRowPagination } from './shared';
import type {
  QuotationDetachNodeOption,
  QuotationDetachOptionsResponse as GeneratedQuotationDetachOptionsResponse,
  QuotationDetachRequest,
  QuotationMaterializeRequest,
  QuotationRequest,
  QuotationResultQuery,
} from '@/api/generated/types.gen';

export type {
  QuotationDetachNodeOption,
  QuotationDetachRequest,
  QuotationEngineConfig,
  QuotationEngineType,
  QuotationMaterializeRequest,
  QuotationRequest,
  QuotationResultQuery,
} from '@/api/generated/types.gen';

export interface QuotationMetadata {
  quotation_columns: string[];
  metadata_columns: string[];
  all_columns: string[];
}

export type QuotationHitRow = Record<string, unknown>;
export type QuotationGroupedRow = QuotationHitRow[];
export type QuotationPagination = SourceRowPagination;

export interface QuotationAnalysisResponse {
  data: QuotationGroupedRow[];
  columns: string[];
  metadata: QuotationMetadata;
  pagination: QuotationPagination;
  sorting: { sort_by?: string | null; descending: boolean };
  preferences?: { context_length?: number; [key: string]: unknown };
  task_id?: string;
}

export type QuotationDetachOptionsResponse = Omit<GeneratedQuotationDetachOptionsResponse, 'data' | 'metadata' | 'state'> & {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  data?: { nodes: QuotationDetachNodeOption[] };
  metadata?: { task_id?: string; [key: string]: unknown };
};

export const quotationApi = {
  quotation: async (node: string, req: QuotationRequest, headers: Record<string, string> = {}) => {
    const { data } = await getQuotationApiWorkspacesNodesNodeIdQuotationPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as QuotationAnalysisResponse;
  },

  getQuotationDetachOptions: (
    node: string,
    column: string,
    headers: Record<string, string> = {},
  ) => {
    return quotationDetachOptionsApiWorkspacesNodesNodeIdQuotationDetachOptionsGet({
      headers,
      path: { node_id: node },
      query: { column },
      throwOnError: true,
    }).then(({ data }) => data as QuotationDetachOptionsResponse);
  },

  quotationDetach: async (
    node: string,
    req: QuotationDetachRequest,
    headers: Record<string, string> = {},
  ): Promise<void> => {
    await detachQuotationApiWorkspacesNodesNodeIdQuotationDetachPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
  },

  quotationMaterialize: async (
    node: string,
    req: QuotationMaterializeRequest,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await materializeQuotationApiWorkspacesNodesNodeIdQuotationMaterializePost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as { state: string; message: string; data: null; metadata?: { task_id?: string } };
  },

  getQuotationTaskRequest: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await quotationTaskRequestApiWorkspacesQuotationTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

  getQuotationTaskResult: async (
    taskId: string,
    headers: Record<string, string> = {},
    params?: QuotationResultQuery,
  ) => {
    const { data } = await quotationTaskResultApiWorkspacesQuotationTasksTaskIdResultGet({
      headers,
      path: { task_id: taskId },
      ...(params ? { query: params as unknown as {
        page?: number | null;
        page_size?: number | null;
        sort_by?: string | null;
        descending?: boolean | null;
      } } : {}),
      throwOnError: true,
    });
    return data as QuotationAnalysisResponse;
  },

  postQuotationTaskResult: async (
    taskId: string,
    body: QuotationResultQuery,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await updateQuotationTaskResultApiWorkspacesQuotationTasksTaskIdResultPost({
      body,
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as QuotationAnalysisResponse;
  },
};
