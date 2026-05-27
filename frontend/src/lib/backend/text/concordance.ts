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
  AnalysisTaskActionResponse,
  ConcordanceAnalysisRequest,
  ConcordanceRequest as ConcordanceStoredRequest,
  ConcordanceDetachRequest,
  ConcordanceDispersionDetachRequest,
  ConcordanceMaterializeRequest,
  ConcordanceResultQuery,
} from '@/api/generated/types.gen';

export type {
  ConcordanceAnalysisRequest,
  ConcordanceAnalysisResponse,
  ConcordanceRequest as ConcordanceStoredRequest,
  ConcordanceDetachNodeOption,
  ConcordanceDetachOptionsResponse as ConcordanceDetachOptionsResult,
  ConcordanceDetachRequest,
  ConcordanceDispersionBinsResponse,
  ConcordanceDispersionBinRow,
  ConcordanceDispersionDetachRequest,
  ConcordanceMaterializeRequest,
  ConcordanceMetadata,
  ConcordanceNodeResult as ConcordanceResultEntry,
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

export type ConcordanceHitRow = Record<string, unknown>;
export type ConcordanceGroupedRow = ConcordanceHitRow[];

export type ConcordanceRequest = LanguageHint & {
  column: string;
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  whole_word?: boolean;
  case_sensitive?: boolean;
  sort_by?: string;
};

export type ConcordancePagination = SourceRowPagination;

export const concordanceApi = {
  concordance: async (req: ConcordanceAnalysisRequest, headers: Record<string, string> = {}) => {
    const { data } = await runConcordanceApiWorkspacesConcordancePost({
      body: req,
      headers,
      throwOnError: true,
    });
    return data;
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
    return { task_id: data.metadata?.task_id ?? undefined };
  },

  concordanceMaterialize: async (
    node: string,
    req: ConcordanceMaterializeRequest,
    headers: Record<string, string> = {},
  ): Promise<AnalysisTaskActionResponse> => {
    const { data } = await materializeConcordanceApiWorkspacesNodesNodeIdConcordanceMaterializePost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
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
    }).then(({ data }) => data);
  },

  getConcordanceTaskRequest: async (taskId: string, headers: Record<string, string> = {}): Promise<ConcordanceStoredRequest> => {
    const { data } = await concordanceTaskRequestApiWorkspacesConcordanceTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
  },

  getConcordanceTaskResult: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await concordanceTaskResultApiWorkspacesConcordanceTasksTaskIdResultGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
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
    }).then(({ data }) => data);
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
    return data;
  },
};
