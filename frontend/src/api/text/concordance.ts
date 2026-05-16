import { httpRequest, post } from '../http';

import type { LanguageHint, SourceRowPagination } from './shared';

/**
 * Concordance has two search modes (decision 6 / Phase 2.6):
 *
 * - ``regex`` — the historical default. Polars-text walks raw text;
 *   partial-word patterns like ``equ\w*`` survive. On CJK,
 *   ``num_left_tokens`` silently means "characters" because there's no
 *   whitespace.
 * - ``tokens`` — walks the derived tokens column added by Tokenise.
 *   N-actual-token left/right context, exact-token match. Only meaningful
 *   on nodes that have been tokenised.
 */
export type ConcordanceSearchMode = 'regex' | 'tokens';

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

export interface ConcordanceDetachRequest extends LanguageHint {
  node_id: string;
  column: string;
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  whole_word?: boolean;
  case_sensitive?: boolean;
  new_node_name?: string;
  selected_columns?: string[];
  materialized_path?: string | null;
}

/**
 * Detach a per-document aggregation of concordance hits from the dispersion
 * view. Output rows are one-per-source-document with hits collapsed into
 * `List<T>` columns and a multi-line `CONC_extraction` string.
 *
 * When `selected_bins` is provided, only hits whose position
 * (`start_idx / doc_length * total_bins`, floored) lands in one of the bins
 * are included — matches the "in-range hits only" semantic of the chart.
 */
export interface ConcordanceDispersionDetachRequest extends LanguageHint {
  column: string;
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  whole_word?: boolean;
  case_sensitive?: boolean;
  new_node_name?: string;
  selected_columns?: string[];
  /**
   * Parent concordance analysis task id. When set and the slow path runs,
   * the worker writes the materialised parquet too and publishes the same
   * `analysis_materialized` event that "Process All" emits — saving the
   * user from a redundant materialisation when they iterate on bin
   * selections after a no-selection detach.
   */
  parent_task_id?: string;
  materialized_path?: string | null;
  selected_bins?: number[];
  total_bins?: number;
  /**
   * Legend-filter projection: when set, only hits whose `CONC_matched_text`
   * is in this list contribute to the per-document aggregation. Omit (or set
   * to `undefined`) for "all matches". An empty array means "none" and the
   * backend returns a zero-row aggregate.
   */
  selected_matched_texts?: string[];
  /**
   * Mirrors the chart's `lowercaseMatches` toggle. When true, the backend
   * lowercases both `CONC_matched_text` and `selected_matched_texts` before
   * the `is_in` check so a single lowercase legend entry matches all original
   * case variants in the corpus.
   */
  match_case_insensitive?: boolean;
}

export interface ConcordanceMaterializeRequest extends LanguageHint {
  parent_task_id: string;
  column: string;
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  whole_word?: boolean;
  case_sensitive?: boolean;
  /** Mirror the live ``/concordance`` request so the materialised parquet
   * honours the engine the user actually searched with. */
  search_mode?: ConcordanceSearchMode;
  /** Tokens-mode model picker — same semantics as ConcordanceAnalysisRequest. */
  model?: string;
}

export interface ConcordanceDetachNodeOption {
  node_id: string;
  node_name: string;
  text_column?: string | null;
  available_columns: string[];
  disabled_columns: string[];
}

export interface ConcordanceDetachOptionsResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data?: { nodes: ConcordanceDetachNodeOption[] };
  metadata?: { task_id?: string; [key: string]: unknown };
}

export interface ConcordanceAnalysisRequest extends LanguageHint {
  node_ids: string[];
  node_columns: Record<string, string>;
  search_word: string;
  num_left_tokens?: number;
  num_right_tokens?: number;
  regex?: boolean;
  whole_word?: boolean;
  case_sensitive?: boolean;
  sort_by?: string;
  combined?: boolean;
  /**
   * Phase 2.6 / 4.7: pick concordance engine. Defaults to ``"regex"`` so
   * existing EN flows are unchanged; ``"tokens"`` walks the derived
   * tokens column for N-actual-token context on CJK nodes that have
   * been tokenised.
   */
  search_mode?: ConcordanceSearchMode;
  /**
   * Tokens-mode model picker. When the active node has >1 derived tokens
   * column for the selected source (e.g. ``jieba`` + ``bert-base-uncased``
   * coexisting), the frontend sets ``model`` so the backend looks up the
   * exact column. ``undefined`` falls back to first-match (the historical
   * behaviour for single-model nodes).
   */
  model?: string;
}

export interface ConcordanceResultQuery {
  node_id?: string;
  combined?: boolean;
  page?: number;
  page_number?: number;
  /** Accepts the literal ``'all'`` for the snapshot capture path —
   * server caps at 500 000 rows (see backend
   * ``SNAPSHOT_ALL_PAGE_SIZE_CAP`` in api/workspaces/analyses/concordance.py). */
  page_size?: number | 'all';
  sort_by?: string;
  descending?: boolean;
  show_metadata?: boolean;
  update_only?: boolean;
}

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
  concordance: (req: ConcordanceAnalysisRequest, headers: Record<string, string> = {}) =>
    post<ConcordanceAnalysisResponse>(`/workspaces/concordance`, req, headers),

  concordanceDetach: async (
    node: string,
    req: ConcordanceDetachRequest,
    headers: Record<string, string> = {},
  ): Promise<void> => {
    await post(`/workspaces/nodes/${node}/concordance/detach`, req, headers);
  },

  concordanceDispersionDetach: async (
    node: string,
    req: ConcordanceDispersionDetachRequest,
    headers: Record<string, string> = {},
  ): Promise<{ task_id?: string }> => {
    const resp = await post<{
      state: string;
      message: string;
      data: null;
      metadata?: { task_id?: string };
    }>(`/workspaces/nodes/${node}/concordance/dispersion-detach`, req, headers);
    return { task_id: resp?.metadata?.task_id };
  },

  concordanceMaterialize: (
    node: string,
    req: ConcordanceMaterializeRequest,
    headers: Record<string, string> = {},
  ) =>
    post<{ state: string; message: string; data: null; metadata?: { task_id?: string } }>(
      `/workspaces/nodes/${node}/concordance/materialize`,
      req,
      headers,
    ),

  getConcordanceDetachOptions: (
    node: string,
    column: string,
    headers: Record<string, string> = {},
  ) =>
    httpRequest<ConcordanceDetachOptionsResponse>(
      `/workspaces/nodes/${node}/concordance/detach-options`,
      { method: 'GET', headers, params: { column } },
    ),

  getConcordanceTaskRequest: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>(
      `/workspaces/concordance/tasks/${taskId}/request`,
      { method: 'GET', headers },
    ),

  getConcordanceTaskResult: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<ConcordanceAnalysisResponse>(
      `/workspaces/concordance/tasks/${taskId}/result`,
      { method: 'GET', headers },
    ),

  getConcordanceTaskDispersionBins: (
    taskId: string,
    nodeId: string,
    headers: Record<string, string> = {},
  ) =>
    httpRequest<ConcordanceDispersionBinsResponse>(
      `/workspaces/concordance/tasks/${taskId}/bins`,
      { method: 'GET', headers, params: { node_id: nodeId } },
    ),

  postConcordanceTaskResult: (
    taskId: string,
    body: ConcordanceResultQuery,
    headers: Record<string, string> = {},
  ) =>
    post<ConcordanceAnalysisResponse>(
      `/workspaces/concordance/tasks/${taskId}/result`,
      body,
      headers,
    ),
};
