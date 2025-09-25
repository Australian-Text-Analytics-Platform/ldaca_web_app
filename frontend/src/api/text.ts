import { post, get, httpRequest } from './http';

// Concordance / Quotation / Token Frequency / Topic Modeling grouped

export interface ConcordanceMetadata {
  concordance_columns: string[];  // Core concordance columns (left_context, matched_text, right_context, etc.)
  metadata_columns: string[];     // Original document metadata columns  
  all_columns: string[];          // All available columns
}

export interface ConcordanceRequest { column: string; search_word: string; num_left_tokens?: number; num_right_tokens?: number; regex?: boolean; case_sensitive?: boolean; page?: number; page_size?: number; sort_by?: string; sort_order?: 'asc' | 'desc'; }
export interface ConcordanceDetachRequest { node_id: string; column: string; search_word: string; num_left_tokens?: number; num_right_tokens?: number; regex?: boolean; case_sensitive?: boolean; new_node_name?: string; }
export interface ConcordanceAnalysisRequest { node_ids: string[]; node_columns: Record<string,string>; search_word: string; num_left_tokens?: number; num_right_tokens?: number; regex?: boolean; case_sensitive?: boolean; page?: number; page_size?: number; sort_by?: string; sort_order?: 'asc' | 'desc'; combined?: boolean; }
export interface ConcordanceResultQuery { node_id?: string; combined?: boolean; page?: number; page_number?: number; page_size?: number; sort_by?: string; sort_order?: 'asc' | 'desc'; }
export interface ConcordanceResultEntry {
  data: any[];
  columns: string[];
  metadata?: ConcordanceMetadata;
  total_matches: number;
  pagination: { page: number; page_size: number; total_pages: number; has_next: boolean; has_prev: boolean; };
  sorting: { sort_by?: string; sort_order: 'asc' | 'desc'; };
}
export interface ConcordanceAnalysisResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data: Record<string, ConcordanceResultEntry>;
  analysis_params?: any;
  combinable?: boolean;
}
export interface QuotationRequest { column: string; page?: number; page_size?: number; sort_by?: string | null; sort_order?: 'asc' | 'desc'; }
export interface QuotationDetachRequest { node_id: string; column: string; new_node_name?: string; }
export interface FrequencyAnalysisRequest { time_column: string; group_by_columns?: string[] | null; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; sort_by_time: boolean; }

export interface TokenFrequencyRequest { node_ids: string[]; node_columns: Record<string,string>; stop_words?: string[] | null; limit: number; }
export interface TokenFrequencyNodeResult { data: { token: string; frequency: number }[]; columns: string[]; }
export interface TokenFrequencyResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message?: string;
  data: Record<string, TokenFrequencyNodeResult> | null;
  analysis_params?: any;
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
  concordanceDetail: (ws: string, node: string, docIdx: number, textColumn: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/nodes/${node}/concordance/${docIdx}`, { method: 'GET', headers, params: { text_column: textColumn } }),
  concordanceDetach: (ws: string, node: string, req: ConcordanceDetachRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/concordance/detach`, req, headers),
  getConcordanceCurrentRequest: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/concordance/current-request`, { method: 'GET', headers }),
  getConcordanceCurrentResult: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/concordance/current-result`, { method: 'GET', headers }),
  postConcordanceCurrentResult: (ws: string, body: ConcordanceResultQuery, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/concordance/current-result`, body, headers),
  clearConcordance: (ws: string, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/concordance/clear`, {}, headers),
  clearConcordanceCache: (ws: string, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/concordance/cache/clear`, {}, headers),

  // Quotation
  quotation: (ws: string, node: string, req: QuotationRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/quotation`, req, headers),
  quotationDetach: (ws: string, node: string, req: QuotationDetachRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/quotation/detach`, req, headers),
  getQuotationCurrentRequest: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/quotation/current-request`, { method: 'GET', headers }),
  getQuotationCurrentResult: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/quotation/current-result`, { method: 'GET', headers }),

  // Timeline / Frequency analysis
  frequency: (ws: string, node: string, req: FrequencyAnalysisRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/frequency-analysis`, req, headers),
  getFrequencyCurrentRequest: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/frequency-analysis/current-request`, { method: 'GET', headers }),
  getFrequencyCurrentResult: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/frequency-analysis/current-result`, { method: 'GET', headers }),
  clearFrequencyAnalysis: (ws: string, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/frequency-analysis/clear`, {}, headers),

  // Token Frequency
  tokenFrequencies: (ws: string, req: TokenFrequencyRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/token-frequencies`, req, headers),
  defaultStopWords: (headers: Record<string,string> = {}) => get<{ state: 'successful'; message: string; data: string[] }>('/text/default-stop-words', headers),
  getTokenFrequenciesCurrentRequest: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/token-frequencies/current-request`, { method: 'GET', headers }),
  postTokenFrequenciesCurrentRequest: (ws: string, reqUpdate: any, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/token-frequencies/current-request`, reqUpdate, headers),
  getTokenFrequenciesCurrentResult: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/token-frequencies/current-result`, { method: 'GET', headers }),
  clearTokenFrequencies: (ws: string, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/token-frequencies/clear`, {}, headers),

  // Topic Modeling
  topicModeling: (ws: string, req: TopicModelingRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/topic-modeling`, req, headers),
  getTopicModelingCurrentRequest: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/topic-modeling/current-request`, { method: 'GET', headers }),
  getTopicModelingCurrentResult: (ws: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/topic-modeling/current-result`, { method: 'GET', headers }),

  // Legacy compatibility shims (no-ops retained for import stability)
};
