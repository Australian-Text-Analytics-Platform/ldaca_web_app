import { httpRequest, post } from '../http';

export type SequentialFrequency =
  | 'second'
  | 'minute'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'custom';

/** Frequencies the user can pick as the "finest time bin" when saving
 * a Trends snapshot. Excludes ``custom`` (snapshot capture always uses
 * a preset for predictable client-side re-aggregation in the viewer)
 * and excludes the secondary live-only frequencies — wait, that's not
 * quite right. The user explicitly chose to expose ``second`` /
 * ``minute`` only in the snapshot dialog, not in the live preset
 * dropdown. Live users who need second-level binning use ``custom``;
 * snapshot users get the simpler preset list. */
export const SNAPSHOT_FINEST_FREQUENCIES: readonly Exclude<SequentialFrequency, 'custom'>[] = [
  'second',
  'minute',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
];

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

  /** Preview-mode sequential analysis. Skips task registration and
   * the existing-task conflict check, so the Trends snapshot pipeline
   * can run a one-off aggregation without disturbing the live result.
   *
   * - ``includeData=false`` (default): returns just the row count.
   *   Used by the snapshot dialog's "Verify actual row count" button.
   * - ``includeData=true``: returns the full aggregated rows + the
   *   analysis_params block, matching the regular endpoint's payload
   *   shape. Used by the snapshot capture path to fetch the data the
   *   bundle ships. */
  sequentialAnalysisPreview: (
    node: string,
    req: SequentialAnalysisRequest,
    headers: Record<string, string> = {},
    includeData = false,
  ) => {
    const query = includeData ? '?include_data=true' : '';
    return post<{
      state: string;
      total_records: number;
      columns: string[];
      data?: Array<Record<string, unknown>>;
      analysis_params?: Record<string, unknown>;
    }>(
      `/workspaces/nodes/${node}/sequential-analysis/preview${query}`,
      req,
      headers,
    );
  },

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
