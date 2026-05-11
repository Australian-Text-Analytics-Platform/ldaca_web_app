import { httpRequest, post } from '../http';

export type SequentialFrequency =
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'custom';

export type SequentialCustomIntervalUnit =
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'days'
  | 'weeks';

export interface SequentialAnalysisRequest {
  time_column: string;
  group_by_columns?: string[] | null;
  frequency: SequentialFrequency;
  sort_by_time: boolean;
  column_type?: 'datetime' | 'numeric';
  numeric_origin?: number | null;
  numeric_interval?: number | null;
  custom_interval_value?: number | null;
  custom_interval_unit?: SequentialCustomIntervalUnit | null;
  case_sensitive?: boolean;
}

export interface SequentialAnalysisDetachRequest {
  selected_periods: Array<{ period_start: unknown; period_end: unknown }>;
  visible_groups?: Array<{ values: Record<string, unknown> }>;
  new_node_name: string;
}

export interface SequentialAnalysisDetachResponse {
  new_node_id: string;
  new_node_name: string;
}

export const sequentialAnalysisApi = {
  sequentialAnalysis: (
    node: string,
    req: SequentialAnalysisRequest,
    headers: Record<string, string> = {},
  ) =>
    post<Record<string, unknown>>(`/workspaces/nodes/${node}/sequential-analysis`, req, headers),

  getSequentialAnalysisTaskRequest: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>(
      `/workspaces/sequential-analysis/tasks/${taskId}/request`,
      { method: 'GET', headers },
    ),

  getSequentialAnalysisTaskResult: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>(
      `/workspaces/sequential-analysis/tasks/${taskId}/result`,
      { method: 'GET', headers },
    ),

  postSequentialAnalysisTaskResult: (
    taskId: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    post<Record<string, unknown>>(
      `/workspaces/sequential-analysis/tasks/${taskId}/result`,
      body,
      headers,
    ),

  sequentialAnalysisDetach: async (
    taskId: string,
    req: SequentialAnalysisDetachRequest,
    headers: Record<string, string> = {},
  ): Promise<SequentialAnalysisDetachResponse> =>
    post(`/workspaces/sequential-analysis/tasks/${taskId}/detach`, req, headers),
};
