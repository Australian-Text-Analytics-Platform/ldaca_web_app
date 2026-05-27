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
  QuotationDetachRequest,
  QuotationMaterializeRequest,
  QuotationEngineConfigInput,
  QuotationRequestInput,
  QuotationRequestOutput,
  QuotationResultQuery,
} from '@/api/generated/types.gen';

export type {
  AnalysisTaskActionResponse,
  QuotationAnalysisResponse,
  QuotationDetachNodeOption,
  QuotationDetachOptionsResponse as QuotationDetachOptionsResult,
  QuotationDetachRequest,
  QuotationEngineType,
  QuotationMaterializeRequest,
  QuotationMetadata,
  QuotationRequestOutput,
  QuotationResultQuery,
} from '@/api/generated/types.gen';

export type QuotationEngineConfig = QuotationEngineConfigInput;
export type QuotationRequest = QuotationRequestInput;

export type QuotationHitRow = Record<string, unknown>;
export type QuotationGroupedRow = QuotationHitRow[];
export type QuotationPagination = SourceRowPagination;

export const quotationApi = {
  quotation: async (node: string, req: QuotationRequest, headers: Record<string, string> = {}) => {
    const { data } = await getQuotationApiWorkspacesNodesNodeIdQuotationPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
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
    }).then(({ data }) => data);
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
    return data;
  },

  getQuotationTaskRequest: async (taskId: string, headers: Record<string, string> = {}): Promise<QuotationRequestOutput> => {
    const { data } = await quotationTaskRequestApiWorkspacesQuotationTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
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
    return data;
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
    return data;
  },
};
