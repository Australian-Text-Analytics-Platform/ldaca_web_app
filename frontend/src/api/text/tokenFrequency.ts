import { get, httpRequest, post } from '../http';

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
    freq_reference: number;
    percent_reference: StatisticsNumericValue;
    freq_study: number;
    percent_study: StatisticsNumericValue;
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

export const tokenFrequencyApi = {
  tokenFrequencies: (req: TokenFrequencyRequest, headers: Record<string, string> = {}) =>
    post<TokenFrequencyResponse>(`/workspaces/token-frequencies`, req, headers),

  /**
   * Fetch the bundled default stop-word list for a language. ``strict``
   * controls fallback: when ``true``, unknown languages return ``[]``;
   * when ``false`` (default, used by token-frequency), unknown languages
   * silently substitute the English list — keeps the existing
   * "fill defaults" UX working when language metadata is missing.
   */
  defaultStopWords: (
    headers: Record<string, string> = {},
    options?: { language?: string; strict?: boolean },
  ) => {
    const params = new URLSearchParams();
    if (options?.language) params.set('language', options.language);
    if (options?.strict) params.set('strict', 'true');
    const qs = params.toString();
    const path = qs ? `/text/default-stop-words?${qs}` : '/text/default-stop-words';
    return get<{ stopwords?: string[]; error?: string }>(path, headers);
  },

  getTokenFrequenciesTaskRequest: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>(
      `/workspaces/token-frequencies/tasks/${taskId}/request`,
      { method: 'GET', headers },
    ),

  getTokenFrequenciesTaskResult: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<TokenFrequencyResponse>(
      `/workspaces/token-frequencies/tasks/${taskId}/result`,
      { method: 'GET', headers },
    ),

  postTokenFrequenciesTaskResult: (
    taskId: string,
    reqUpdate: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    post<TokenFrequencyResponse>(
      `/workspaces/token-frequencies/tasks/${taskId}/result`,
      reqUpdate,
      headers,
    ),
};
