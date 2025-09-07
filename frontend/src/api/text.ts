import { post, get, httpRequest } from './http';

// Concordance / Quotation / Token Frequency / Topic Modeling grouped

export interface ConcordanceMetadata {
  concordance_columns: string[];  // Core concordance columns (left_context, matched_text, right_context, etc.)
  metadata_columns: string[];     // Original document metadata columns  
  all_columns: string[];          // All available columns
}

export interface ConcordanceRequest { column: string; search_word: string; num_left_tokens?: number; num_right_tokens?: number; regex?: boolean; case_sensitive?: boolean; page?: number; page_size?: number; sort_by?: string; sort_order?: 'asc' | 'desc'; }
export interface ConcordanceDetachRequest { node_id: string; column: string; search_word: string; num_left_tokens?: number; num_right_tokens?: number; regex?: boolean; case_sensitive?: boolean; new_node_name?: string; }
export interface MultiNodeConcordanceRequest { node_ids: string[]; node_columns: Record<string,string>; search_word: string; num_left_tokens?: number; num_right_tokens?: number; regex?: boolean; case_sensitive?: boolean; page?: number; page_size?: number; sort_by?: string; sort_order?: 'asc' | 'desc'; combined?: boolean; }
export interface MultiNodeConcordanceResponse { success: boolean; message: string; data: Record<string, { data: any[]; columns: string[]; metadata: ConcordanceMetadata; total_matches: number; pagination: { page: number; page_size: number; total_pages: number; has_next: boolean; has_prev: boolean; }; sorting: { sort_by?: string; sort_order: string; }; }>; }
export interface QuotationRequest { column: string; page?: number; page_size?: number; sort_by?: string | null; sort_order?: 'asc' | 'desc'; }
export interface QuotationDetachRequest { node_id: string; column: string; new_node_name?: string; }
export interface FrequencyAnalysisRequest { time_column: string; group_by_columns?: string[] | null; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; sort_by_time: boolean; }

export interface TokenFrequencyRequest { node_ids: string[]; node_columns: Record<string,string>; stop_words?: string[] | null; limit?: number; }
export interface TokenFrequencyResponse { 
  success: boolean; 
  message: string; 
  data: Record<string, { token: string; frequency: number; total?: number }[]> | null; 
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

export const textApi = {
  concordance: (ws: string, node: string, req: ConcordanceRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/concordance`, req, headers),
  concordanceDetail: (ws: string, node: string, docIdx: number, textColumn: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/nodes/${node}/concordance/${docIdx}`, { method: 'GET', headers, params: { text_column: textColumn } }),
  concordanceDetach: (ws: string, node: string, req: ConcordanceDetachRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/concordance/detach`, req, headers),
  multiNodeConcordance: (ws: string, req: MultiNodeConcordanceRequest, headers: Record<string,string> = {}) => post<MultiNodeConcordanceResponse>(`/workspaces/${ws}/concordance/multi-node`, req, headers),
  quotation: (ws: string, node: string, req: QuotationRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/quotation`, req, headers),
  quotationDetach: (ws: string, node: string, req: QuotationDetachRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/quotation/detach`, req, headers),
  frequency: (ws: string, node: string, req: FrequencyAnalysisRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/frequency-analysis`, req, headers),
  tokenFrequencies: (ws: string, req: TokenFrequencyRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/token-frequencies`, req, headers),
  defaultStopWords: (headers: Record<string,string> = {}) => get<{ success: boolean; message: string; data: string[] }>('/text/default-stop-words', headers),
  topicModeling: (ws: string, req: TopicModelingRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/topic-modeling`, req, headers),
};
