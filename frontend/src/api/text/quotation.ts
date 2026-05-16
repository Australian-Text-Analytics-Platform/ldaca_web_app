import { httpRequest, post } from '../http';

import type { LanguageHint, SourceRowPagination } from './shared';

export type QuotationEngineType = 'local' | 'remote';

export interface QuotationEngineConfig {
  type: QuotationEngineType;
  url?: string | null;
}

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

export interface QuotationRequest extends LanguageHint {
  column: string;
  page?: number;
  page_size?: number;
  sort_by?: string | null;
  descending?: boolean;
  engine?: QuotationEngineConfig;
}

export interface QuotationDetachRequest extends LanguageHint {
  node_id: string;
  column: string;
  new_node_name?: string;
  engine?: QuotationEngineConfig;
  selected_columns?: string[];
  materialized_path?: string | null;
}

export interface QuotationMaterializeRequest extends LanguageHint {
  parent_task_id: string;
  column: string;
  engine?: QuotationEngineConfig;
}

export interface QuotationDetachNodeOption {
  node_id: string;
  node_name: string;
  text_column?: string | null;
  available_columns: string[];
  disabled_columns: string[];
}

export interface QuotationDetachOptionsResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data?: { nodes: QuotationDetachNodeOption[] };
  metadata?: { task_id?: string; [key: string]: unknown };
}

export interface QuotationResultQuery {
  page?: number;
  /** Accepts the literal ``'all'`` for the snapshot capture path —
   * server caps at 500 000 rows (see backend
   * ``SNAPSHOT_ALL_PAGE_SIZE_CAP`` in api/workspaces/analyses/quotation.py). */
  page_size?: number | 'all';
  sort_by?: string | null;
  descending?: boolean;
  context_length?: number;
  update_only?: boolean;
}

export const quotationApi = {
  quotation: (node: string, req: QuotationRequest, headers: Record<string, string> = {}) =>
    post<QuotationAnalysisResponse>(`/workspaces/nodes/${node}/quotation`, req, headers),

  getQuotationDetachOptions: (
    node: string,
    column: string,
    headers: Record<string, string> = {},
  ) =>
    httpRequest<QuotationDetachOptionsResponse>(
      `/workspaces/nodes/${node}/quotation/detach-options`,
      { method: 'GET', headers, params: { column } },
    ),

  quotationDetach: async (
    node: string,
    req: QuotationDetachRequest,
    headers: Record<string, string> = {},
  ): Promise<void> => {
    await post(`/workspaces/nodes/${node}/quotation/detach`, req, headers);
  },

  quotationMaterialize: (
    node: string,
    req: QuotationMaterializeRequest,
    headers: Record<string, string> = {},
  ) =>
    post<{ state: string; message: string; data: null; metadata?: { task_id?: string } }>(
      `/workspaces/nodes/${node}/quotation/materialize`,
      req,
      headers,
    ),

  getQuotationTaskRequest: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>(
      `/workspaces/quotation/tasks/${taskId}/request`,
      { method: 'GET', headers },
    ),

  getQuotationTaskResult: (
    taskId: string,
    headers: Record<string, string> = {},
    params?: QuotationResultQuery,
  ) =>
    httpRequest<QuotationAnalysisResponse>(
      `/workspaces/quotation/tasks/${taskId}/result`,
      { method: 'GET', headers, params: params as Record<string, unknown> },
    ),

  postQuotationTaskResult: (
    taskId: string,
    body: QuotationResultQuery,
    headers: Record<string, string> = {},
  ) =>
    post<QuotationAnalysisResponse>(
      `/workspaces/quotation/tasks/${taskId}/result`,
      body,
      headers,
    ),
};
