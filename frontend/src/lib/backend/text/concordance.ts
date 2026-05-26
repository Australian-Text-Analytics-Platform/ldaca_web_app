import {
  concordanceDetachOptionsApiWorkspacesNodesNodeIdConcordanceDetachOptionsGet,
  concordanceTaskDispersionBinsApiWorkspacesConcordanceTasksTaskIdBinsGet,
  concordanceTaskRequestApiWorkspacesConcordanceTasksTaskIdRequestGet,
  concordanceTaskResultApiWorkspacesConcordanceTasksTaskIdResultGet,
  concordanceTaskResultPostApiWorkspacesConcordanceTasksTaskIdResultPost,
  detachConcordanceApiWorkspacesNodesNodeIdConcordanceDetachPost,
  detachConcordanceDispersionApiWorkspacesNodesNodeIdConcordanceDispersionDetachPost,
  materializeConcordanceApiWorkspacesNodesNodeIdConcordanceMaterializePost,
  runConcordanceApiWorkspacesConcordancePost,
} from '@/api/generated/sdk.gen';

import type { LanguageHint, SourceRowPagination } from './shared';
import type {
  ConcordanceAnalysisRequest,
  ConcordanceDetachNodeOption,
  ConcordanceDetachOptionsResponse as GeneratedConcordanceDetachOptionsResponse,
  ConcordanceDetachRequest,
  ConcordanceDispersionDetachRequest,
  ConcordanceMaterializeRequest,
  ConcordanceResultQuery,
} from '@/api/generated/types.gen';

export type {
  ConcordanceAnalysisRequest,
  ConcordanceDetachNodeOption,
  ConcordanceDetachRequest,
  ConcordanceDispersionDetachRequest,
  ConcordanceMaterializeRequest,
  ConcordanceResultQuery,
} from '@/api/generated/types.gen';

/**
 * Concordance has two search modes (decision 6 / Phase 2.6):
 *
 * - ``regex`` — the historical default. Polars-text walks raw text;
 *   partial-word patterns like ``equ\w*`` survive. On CJK,
 *   ``num_left_tokens`` silently means "characters" because there's no
 *   whitespace.
 * - ``tokens`` — walks the tokenization column added by Tokenise.
 *   N-actual-token left/right context, exact-token match. Only meaningful
 *   on nodes that have been tokenised.
 */
export type ConcordanceSearchMode = NonNullable<ConcordanceAnalysisRequest['search_mode']>;

export interface ConcordanceMetadata {
  /** Core concordance columns (CONC_left_context, CONC_matched_text, CONC_right_context, etc.) */
  concordance_columns: string[];
  /** Original document metadata columns. */
  metadata_columns: string[];
  /** All available columns. */
  all_columns: string[];
}

export type ConcordanceHitRow = Record<string, unknown>;
export type ConcordanceGroupedRow = ConcordanceHitRow[];

export interface ConcordanceRequest extends LanguageHint {
  column: string;
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  whole_word?: boolean;
  case_sensitive?: boolean;
  sort_by?: string;
}

export type ConcordanceDetachOptionsResponse = Omit<GeneratedConcordanceDetachOptionsResponse, 'data' | 'metadata' | 'state'> & {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  data?: { nodes: ConcordanceDetachNodeOption[] };
  metadata?: { task_id?: string; [key: string]: unknown };
};

export type ConcordancePagination = SourceRowPagination;

export interface ConcordanceResultEntry {
  data: ConcordanceGroupedRow[];
  columns: string[];
  metadata: ConcordanceMetadata;
  pagination: ConcordancePagination;
  sorting: { sort_by?: string; descending: boolean };
  materialized?: boolean;
}

export interface ConcordanceDispersionBinRow {
  matched_text?: string;
  bin_idx?: number;
  count?: number;
}

export interface ConcordanceDispersionBinsResponse {
  node_id: string;
  total_hits: number;
  document_column: string | null;
  /** Number of source bins the hits were pre-aggregated into (server-side). */
  bin_count: number;
  rows: ConcordanceDispersionBinRow[];
}

export interface ConcordanceAnalysisResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data: Record<string, ConcordanceResultEntry>;
  analysis_params?: Record<string, unknown>;
  combinable?: boolean;
  preferences?: { page_size?: number; show_metadata?: boolean; [key: string]: unknown };
  metadata?: { task_id?: string; [key: string]: unknown };
}

export const concordanceApi = {
  concordance: async (req: ConcordanceAnalysisRequest, headers: Record<string, string> = {}) => {
    const { data } = await runConcordanceApiWorkspacesConcordancePost({
      body: req,
      headers,
      throwOnError: true,
    });
    return data as ConcordanceAnalysisResponse;
  },

  concordanceDetach: async (
    node: string,
    req: ConcordanceDetachRequest,
    headers: Record<string, string> = {},
  ): Promise<void> => {
    await detachConcordanceApiWorkspacesNodesNodeIdConcordanceDetachPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
  },

  concordanceDispersionDetach: async (
    node: string,
    req: ConcordanceDispersionDetachRequest,
    headers: Record<string, string> = {},
  ): Promise<{ task_id?: string }> => {
    const { data } = await detachConcordanceDispersionApiWorkspacesNodesNodeIdConcordanceDispersionDetachPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    const resp = data as {
      state: string;
      message: string;
      data: null;
      metadata?: { task_id?: string };
    };
    return { task_id: resp?.metadata?.task_id };
  },

  concordanceMaterialize: async (
    node: string,
    req: ConcordanceMaterializeRequest,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await materializeConcordanceApiWorkspacesNodesNodeIdConcordanceMaterializePost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as { state: string; message: string; data: null; metadata?: { task_id?: string } };
  },

  getConcordanceDetachOptions: (
    node: string,
    column: string,
    headers: Record<string, string> = {},
  ) => {
    return concordanceDetachOptionsApiWorkspacesNodesNodeIdConcordanceDetachOptionsGet({
      headers,
      path: { node_id: node },
      query: { column },
      throwOnError: true,
    }).then(({ data }) => data as ConcordanceDetachOptionsResponse);
  },

  getConcordanceTaskRequest: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await concordanceTaskRequestApiWorkspacesConcordanceTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

  getConcordanceTaskResult: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await concordanceTaskResultApiWorkspacesConcordanceTasksTaskIdResultGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as ConcordanceAnalysisResponse;
  },

  getConcordanceTaskDispersionBins: (
    taskId: string,
    nodeId: string,
    headers: Record<string, string> = {},
  ) => {
    return concordanceTaskDispersionBinsApiWorkspacesConcordanceTasksTaskIdBinsGet({
      headers,
      path: { task_id: taskId },
      query: { node_id: nodeId },
      throwOnError: true,
    }).then(({ data }) => data as ConcordanceDispersionBinsResponse);
  },

  postConcordanceTaskResult: async (
    taskId: string,
    body: ConcordanceResultQuery,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await concordanceTaskResultPostApiWorkspacesConcordanceTasksTaskIdResultPost({
      body,
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as ConcordanceAnalysisResponse;
  },
};
