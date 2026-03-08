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
export interface ConcordanceResultQuery { node_id?: string; combined?: boolean; page?: number; page_number?: number; page_size?: number; sort_by?: string; descending?: boolean; show_metadata?: boolean; update_only?: boolean; }
export interface ConcordanceResultEntry {
  data: Record<string, unknown>[];
  columns: string[];
  metadata?: ConcordanceMetadata;
  total_matches?: number;
  pagination: { page: number; page_size: number; total_pages?: number; total_source_pages?: number; has_next: boolean; has_prev: boolean; };
  sorting: { sort_by?: string; descending: boolean; };
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
export type QuotationEngineType = 'local' | 'remote';
export interface QuotationEngineConfig { type: QuotationEngineType; url?: string | null; }
export interface QuotationRequest { column: string; page?: number; page_size?: number; sort_by?: string | null; descending?: boolean; engine?: QuotationEngineConfig; }
export interface QuotationDetachRequest { node_id: string; column: string; new_node_name?: string; engine?: QuotationEngineConfig; }
export interface QuotationResultQuery {
  page?: number;
  page_size?: number;
  sort_by?: string | null;
  descending?: boolean;
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
  metadata?: Record<string, unknown> | null;
}

type StatisticsNumericValue = number | '+Inf' | '-Inf' | null;

export interface TokenFrequencyResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message?: string;
  data: Record<string, TokenFrequencyNodeResult> | null;
  analysis_params?: Record<string, unknown>;
  token_limit?: number;
  metadata?: Record<string, unknown> | null;
  stop_words?: string[] | null;
  statistics?: Array<{
    token: string;
    freq_corpus_0: number;
    percent_corpus_0: StatisticsNumericValue;
    freq_corpus_1: number;
    percent_corpus_1: StatisticsNumericValue;
    log_likelihood_llv: StatisticsNumericValue;
    percent_diff: StatisticsNumericValue;
    bayes_factor_bic?: StatisticsNumericValue;
    effect_size_ell?: StatisticsNumericValue;
    relative_risk?: StatisticsNumericValue;
    log_ratio?: StatisticsNumericValue;
    odds_ratio?: StatisticsNumericValue;
    significance?: string;
  }>;
}
export interface TopicModelingRequest { node_ids: string[]; node_columns?: Record<string,string>; min_topic_size?: number; }
export interface TopicModelingResponse { state: 'running' | 'successful' | 'failed' | 'cancelled'; message: string; data?: { topics: Record<string, unknown>[]; corpus_sizes?: number[] }; metadata?: { task_id?: string; [k: string]: unknown } }
export interface TopicModelingDetachNodeOption {
  node_id: string;
  node_name: string;
  text_column?: string | null;
  available_columns: string[];
  disabled_columns: string[];
}
export interface TopicModelingDetachOptionsResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data?: { nodes: TopicModelingDetachNodeOption[] };
  metadata?: { task_id?: string; [k: string]: unknown };
}
export interface TopicModelingDetachRequest {
  node_ids?: string[];
  selected_columns: Record<string, string[]>;
  new_node_names?: Record<string, string>;
  topic_column_name?: string;
  topic_ids?: number[];
}
export interface TopicModelingDetachResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data?: { detached_nodes?: Array<{ source_node_id: string; new_node_id: string }> };
  metadata?: { task_id?: string; [k: string]: unknown };
}

export interface AiAnnotationClassDef {
  name: string;
  description: string;
}

export interface AiAnnotationExample {
  query: string;
  classification: string;
}

export interface AiAnnotationRequest {
  node_ids: string[];
  node_columns: Record<string, string>;
  annotation_column?: string | null;
  classes: AiAnnotationClassDef[];
  examples?: AiAnnotationExample[];
  model: string;
  api_key?: string | null;
  base_url?: string | null;
  temperature?: number;
  top_p?: number;
  seed?: number | null;
  batch_size?: number;
  page?: number;
  page_size?: number;
  sort_by?: string | null;
  descending?: boolean;
}

export interface AiAnnotationDetachRequest {
  column: string;
  new_node_name?: string | null;
  annotation_column?: string | null;
  classes: AiAnnotationClassDef[];
  examples?: AiAnnotationExample[];
  model: string;
  api_key?: string | null;
  base_url?: string | null;
  temperature?: number;
  top_p?: number;
  seed?: number | null;
  batch_size?: number;
}

export interface AiAnnotationEdit {
  row_index: number;
  provider: string;
  annotation: string;
}

export interface AiAnnotationSaveRequest {
  annotation_column?: string | null;
  edits: AiAnnotationEdit[];
}

export interface AiAnnotationNodeResult {
  data: Array<Record<string, unknown>>;
  columns: string[];
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
}

export interface AiAnnotationResultQuery {
  page?: number;
  page_size?: number;
  sort_by?: string | null;
  descending?: boolean;
}

export interface AiAnnotationResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data?: Record<string, AiAnnotationNodeResult> | null;
  analysis_params?: Record<string, unknown>;
  combinable?: boolean;
  metadata?: { task_id?: string; [k: string]: unknown };
}

export interface AiAnnotationModelsRequest {
  base_url?: string | null;
  api_key?: string | null;
}

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

export const textApi = {
  concordance: (req: ConcordanceAnalysisRequest, headers: Record<string,string> = {}) => post<ConcordanceAnalysisResponse>(`/workspaces/concordance`, req, headers),
  concordanceDetach: async (node: string, req: ConcordanceDetachRequest, headers: Record<string,string> = {}): Promise<void> => { await post(`/workspaces/nodes/${node}/concordance/detach`, req, headers); },
  getConcordanceTaskRequest: (taskId: string, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/concordance/tasks/${taskId}/request`, { method: 'GET', headers }),
  getConcordanceTaskResult: (taskId: string, headers: Record<string,string> = {}) => httpRequest<ConcordanceAnalysisResponse>(`/workspaces/concordance/tasks/${taskId}/result`, { method: 'GET', headers }),
  postConcordanceTaskResult: (taskId: string, body: ConcordanceResultQuery, headers: Record<string,string> = {}) => post<ConcordanceAnalysisResponse>(`/workspaces/concordance/tasks/${taskId}/result`, body, headers),

  // Quotation
  quotation: (node: string, req: QuotationRequest, headers: Record<string,string> = {}) => post<Record<string, unknown>>(`/workspaces/nodes/${node}/quotation`, req, headers),
  quotationDetach: async (node: string, req: QuotationDetachRequest, headers: Record<string,string> = {}): Promise<void> => { await post(`/workspaces/nodes/${node}/quotation/detach`, req, headers); },
  getQuotationTaskRequest: (taskId: string, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/quotation/tasks/${taskId}/request`, { method: 'GET', headers }),
  getQuotationTaskResult: (taskId: string, headers: Record<string,string> = {}, params?: QuotationResultQuery) => httpRequest<Record<string, unknown>>(`/workspaces/quotation/tasks/${taskId}/result`, { method: 'GET', headers, params: params as Record<string, unknown> }),
  postQuotationTaskResult: (taskId: string, body: QuotationResultQuery, headers: Record<string,string> = {}) => post<Record<string, unknown>>(`/workspaces/quotation/tasks/${taskId}/result`, body, headers),

  // Sequential analysis
  sequentialAnalysis: (node: string, req: SequentialAnalysisRequest, headers: Record<string,string> = {}) => post<Record<string, unknown>>(`/workspaces/nodes/${node}/sequential-analysis`, req, headers),
  getSequentialAnalysisTaskRequest: (taskId: string, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/sequential-analysis/tasks/${taskId}/request`, { method: 'GET', headers }),
  getSequentialAnalysisTaskResult: (taskId: string, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/sequential-analysis/tasks/${taskId}/result`, { method: 'GET', headers }),
  postSequentialAnalysisTaskResult: (taskId: string, body: Record<string,unknown>, headers: Record<string,string> = {}) => post<Record<string, unknown>>(`/workspaces/sequential-analysis/tasks/${taskId}/result`, body, headers),

  // Token Frequency
  tokenFrequencies: (req: TokenFrequencyRequest, headers: Record<string,string> = {}) => post<TokenFrequencyResponse>(`/workspaces/token-frequencies`, req, headers),
  defaultStopWords: (headers: Record<string,string> = {}) => get<{ stopwords?: string[]; error?: string }>('/text/default-stop-words', headers),
  getTokenFrequenciesTaskRequest: (taskId: string, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/token-frequencies/tasks/${taskId}/request`, { method: 'GET', headers }),
  getTokenFrequenciesTaskResult: (taskId: string, headers: Record<string,string> = {}) => httpRequest<TokenFrequencyResponse>(`/workspaces/token-frequencies/tasks/${taskId}/result`, { method: 'GET', headers }),
  postTokenFrequenciesTaskResult: (taskId: string, reqUpdate: Record<string, unknown>, headers: Record<string,string> = {}) => post<TokenFrequencyResponse>(`/workspaces/token-frequencies/tasks/${taskId}/result`, reqUpdate, headers),

  // Topic Modeling
  topicModeling: (req: TopicModelingRequest, headers: Record<string, string> = {}) => post<TopicModelingResponse>(`/workspaces/topic-modeling`, req, headers),
  getTopicModelingTaskRequest: (taskId: string, headers: Record<string, string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/topic-modeling/tasks/${taskId}/request`, { method: 'GET', headers }),
  getTopicModelingTaskResult: (taskId: string, headers: Record<string, string> = {}) => httpRequest<TopicModelingResponse>(`/workspaces/topic-modeling/tasks/${taskId}/result`, { method: 'GET', headers }),
  getTopicModelingDetachOptions: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<TopicModelingDetachOptionsResponse>(`/workspaces/topic-modeling/tasks/${taskId}/detach-options`, { method: 'GET', headers }),
  topicModelingDetach: (taskId: string, req: TopicModelingDetachRequest, headers: Record<string, string> = {}) =>
    post<TopicModelingDetachResponse>(`/workspaces/topic-modeling/tasks/${taskId}/detach`, req, headers),

  // AI Annotation
  aiAnnotationModels: (body: AiAnnotationModelsRequest, headers: Record<string, string> = {}) =>
    post<AiAnnotationModelsResponse>(`/workspaces/ai-annotation/models`, body, headers),
  aiAnnotation: (req: AiAnnotationRequest, headers: Record<string, string> = {}) =>
    post<AiAnnotationResponse>(`/workspaces/ai-annotation`, req, headers),
  aiAnnotationDetach: (node: string, req: AiAnnotationDetachRequest, headers: Record<string, string> = {}) =>
    post<Record<string, unknown>>(`/workspaces/nodes/${node}/ai-annotation/detach`, req, headers),
  aiAnnotationSave: (node: string, req: AiAnnotationSaveRequest, headers: Record<string, string> = {}) =>
    post<Record<string, unknown>>(`/workspaces/nodes/${node}/ai-annotation/save`, req, headers),
  aiAnnotationProviders: (node: string, annotationColumn: string, headers: Record<string, string> = {}) =>
    httpRequest<AiAnnotationProvidersResponse>(`/workspaces/nodes/${node}/ai-annotation/providers`, {
      method: 'GET',
      headers,
      params: { annotation_column: annotationColumn },
    }),
  aiAnnotationCategories: (node: string, annotationColumn: string, headers: Record<string, string> = {}) =>
    httpRequest<AiAnnotationCategoriesResponse>(`/workspaces/nodes/${node}/ai-annotation/categories`, {
      method: 'GET',
      headers,
      params: { annotation_column: annotationColumn },
    }),
  clearAiAnnotation: (headers: Record<string, string> = {}) =>
    httpRequest<{ state: string; message: string }>(`/workspaces/ai-annotation`, { method: 'DELETE', headers }),
  getAiAnnotationTaskRequest: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>(`/workspaces/ai-annotation/tasks/${taskId}/request`, { method: 'GET', headers }),
  getAiAnnotationTaskResult: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<AiAnnotationResponse>(`/workspaces/ai-annotation/tasks/${taskId}/result`, { method: 'GET', headers }),
  postAiAnnotationTaskResult: (taskId: string, body: AiAnnotationResultQuery, headers: Record<string, string> = {}) =>
    post<AiAnnotationResponse>(`/workspaces/ai-annotation/tasks/${taskId}/result`, body, headers),

  getAnalysisCurrent: (analysis: string, headers: Record<string, string> = {}) => {
    const ANALYSIS_URL_SLUG: Record<string, string> = {
      concordance: 'concordance',
      concordance_analysis: 'concordance',
      ai_annotation: 'ai-annotation',
      quotation: 'quotation',
      quotation_analysis: 'quotation',
      token_frequencies: 'token-frequencies',
      topic_modeling: 'topic-modeling',
      sequential_analysis: 'sequential-analysis',
    };
    const slug = ANALYSIS_URL_SLUG[analysis] ?? analysis.replace(/_/g, '-');
    return httpRequest<Record<string, unknown>>(`/workspaces/${slug}/tasks/current`, { method: 'GET', headers });
  },

};
