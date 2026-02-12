import { post, get, httpRequest } from './http';

// Concordance / Quotation / Token Frequency / Topic Modeling grouped

export interface ConcordanceMetadata {
  concordance_columns: string[];  // Core concordance columns (left_context, matched_text, right_context, etc.)
  metadata_columns: string[];     // Original document metadata columns  
  all_columns: string[];          // All available columns
}

export interface ConcordanceRequest { column: string; search_word: string; num_left_tokens?: number; num_right_tokens?: number; regex?: boolean; case_sensitive?: boolean; sort_by?: string; }
export interface ConcordanceDetachRequest { node_id: string; column: string; search_word: string; num_left_tokens?: number; num_right_tokens?: number; regex?: boolean; case_sensitive?: boolean; new_node_name?: string; }
export interface ConcordanceAnalysisRequest { node_ids: string[]; node_columns: Record<string,string>; search_word: string; num_left_tokens?: number; num_right_tokens?: number; regex?: boolean; case_sensitive?: boolean; sort_by?: string; combined?: boolean; }
export interface ConcordanceResultQuery { node_id?: string; combined?: boolean; page?: number; page_number?: number; page_size?: number; sort_by?: string; sort_order?: 'asc' | 'desc'; show_metadata?: boolean; update_only?: boolean; }
export interface ConcordanceResultEntry {
  data: any[];
  columns: string[];
  metadata?: ConcordanceMetadata;
  total_matches?: number;
  pagination: { page: number; page_size: number; total_pages?: number; has_next: boolean; has_prev: boolean; };
  sorting: { sort_by?: string; sort_order: 'asc' | 'desc'; };
}
export interface ConcordanceAnalysisResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data: Record<string, ConcordanceResultEntry>;
  analysis_params?: any;
  combinable?: boolean;
  preferences?: { page_size?: number; show_metadata?: boolean; [key: string]: unknown };
}
export type QuotationEngineType = 'local' | 'remote';
export interface QuotationEngineConfig { type: QuotationEngineType; url?: string | null; }
export interface QuotationRequest { column: string; page?: number; page_size?: number; sort_by?: string | null; sort_order?: 'asc' | 'desc'; engine?: QuotationEngineConfig; }
export interface QuotationDetachRequest { node_id: string; column: string; new_node_name?: string; engine?: QuotationEngineConfig; }
export interface QuotationResultQuery {
  page?: number;
  page_size?: number;
  sort_by?: string | null;
  sort_order?: 'asc' | 'desc';
  context_length?: number;
  update_only?: boolean;
}
export type SequentialFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export interface SequentialAnalysisRequest {
  time_column: string;
  group_by_columns?: string[] | null;
  frequency: SequentialFrequency;
  sort_by_time: boolean;
  column_type?: 'datetime' | 'numeric';
  numeric_origin?: number | null;
  numeric_interval?: number | null;
}

export interface TokenFrequencyRequest {
  node_ids: string[];
  node_columns: Record<string, string>;
  stop_words?: string[] | null;
  token_limit?: number | null;
}
export interface TokenFrequencyNodeResult {
  data: { token: string; frequency: number }[];
  columns: string[];
  metadata?: Record<string, any> | null;
}
export interface TokenFrequencyResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message?: string;
  data: Record<string, TokenFrequencyNodeResult> | null;
  analysis_params?: any;
  token_limit?: number;
  metadata?: Record<string, any> | null;
  stop_words?: string[] | null;
  statistics?: Array<{
    token: string;
    freq_corpus_0: number;
    percent_corpus_0: number;
    freq_corpus_1: number;
    percent_corpus_1: number;
    log_likelihood_llv: number;
    percent_diff: number;
    bayes_factor_bic?: number;
    effect_size_ell?: number;
    relative_risk?: number;
    log_ratio?: number;
    odds_ratio?: number;
    significance?: string;
  }>;
}
export interface TopicModelingRequest { node_ids: string[]; node_columns?: Record<string,string>; min_topic_size?: number; use_ctfidf?: boolean; }
// Topic Modeling now uses the canonical 'state' field (legacy 'status' removed)
export interface TopicModelingResponse { state: 'running' | 'successful' | 'failed' | 'cancelled'; message: string; data?: { topics: any[]; corpus_sizes?: number[] }; metadata?: { task_id?: string; [k: string]: any } }

export const textApi = {
  concordance: (ws: string, req: ConcordanceAnalysisRequest, headers: Record<string,string> = {}) => post<ConcordanceAnalysisResponse>(`/workspaces/${ws}/concordance`, req, headers),
  concordanceDetach: (ws: string, node: string, req: ConcordanceDetachRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/concordance/detach`, req, headers),
  getConcordanceTaskResult: (ws: string, taskId: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/concordance/tasks/${taskId}/result`, { method: 'GET', headers }),
  postConcordanceTaskResult: (ws: string, taskId: string, body: ConcordanceResultQuery, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/concordance/tasks/${taskId}/result`, body, headers),

  // Quotation
  quotation: (ws: string, node: string, req: QuotationRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/quotation`, req, headers),
  quotationDetach: (ws: string, node: string, req: QuotationDetachRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/quotation/detach`, req, headers),
  getQuotationTaskResult: (ws: string, taskId: string, headers: Record<string,string> = {}, params?: QuotationResultQuery) => httpRequest(`/workspaces/${ws}/quotation/tasks/${taskId}/result`, { method: 'GET', headers, params }),
  postQuotationTaskResult: (ws: string, taskId: string, body: QuotationResultQuery, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/quotation/tasks/${taskId}/result`, body, headers),

  // Sequential analysis
  sequentialAnalysis: (ws: string, node: string, req: SequentialAnalysisRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/sequential-analysis`, req, headers),
  postSequentialAnalysisTaskResult: (ws: string, taskId: string, body: Record<string,unknown>, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/sequential-analysis/tasks/${taskId}/result`, body, headers),

  // Token Frequency
  tokenFrequencies: (ws: string, req: TokenFrequencyRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/token-frequencies`, req, headers),
  defaultStopWords: (headers: Record<string,string> = {}) => get<{ stopwords?: string[]; error?: string }>('/text/default-stop-words', headers),
  getTokenFrequenciesTaskResult: (ws: string, taskId: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/token-frequencies/tasks/${taskId}/result`, { method: 'GET', headers }),
  postTokenFrequenciesTaskResult: (ws: string, taskId: string, reqUpdate: any, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/token-frequencies/tasks/${taskId}/result`, reqUpdate, headers),

  // Topic Modeling
  topicModeling: (ws: string, req: TopicModelingRequest, headers: Record<string, string> = {}) => post(`/workspaces/${ws}/topic-modeling`, req, headers),
  getTopicModelingTaskResult: (ws: string, taskId: string, headers: Record<string, string> = {}) => httpRequest<TopicModelingResponse>(`/workspaces/${ws}/topic-modeling/tasks/${taskId}/result`, { method: 'GET', headers }),

  getAnalysisCurrent: (ws: string, analysis: string, headers: Record<string, string> = {}) => httpRequest(`/workspaces/${ws}/${analysis}/current`, { method: 'GET', headers }),
  getTaskRequest: (ws: string, taskId: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/tasks/${taskId}/request`, { method: 'GET', headers }),
  getTaskResult: (ws: string, taskId: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/tasks/${taskId}/result`, { method: 'GET', headers }),
  clearTask: (ws: string, taskId: string, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/tasks/${taskId}/clear`, {}, headers),

};
