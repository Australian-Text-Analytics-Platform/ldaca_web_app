import {
  detachSequentialAnalysisTaskApiWorkspacesSequentialAnalysisTasksTaskIdDetachPost,
  previewSequentialAnalysisApiWorkspacesNodesNodeIdSequentialAnalysisPreviewPost,
  runSequentialAnalysisApiWorkspacesNodesNodeIdSequentialAnalysisPost,
  sequentialAnalysisTaskRequestApiWorkspacesSequentialAnalysisTasksTaskIdRequestGet,
  sequentialAnalysisTaskResultApiWorkspacesSequentialAnalysisTasksTaskIdResultGet,
  updateSequentialAnalysisTaskResultApiWorkspacesSequentialAnalysisTasksTaskIdResultPost,
} from '@/api/generated/sdk.gen';

import type {
  SequentialAnalysisDetachRequest,
  SequentialAnalysisRequest,
} from '@/api/generated/types.gen';

export type {
  SelectedPeriod,
  SequentialAnalysisDetachRequest,
  SequentialAnalysisRequest,
} from '@/api/generated/types.gen';

export type SequentialFrequency = NonNullable<SequentialAnalysisRequest['frequency']>;

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

export type SequentialCustomIntervalUnit = NonNullable<SequentialAnalysisRequest['custom_interval_unit']>;

export type SequentialAnalysisDetachResponse = {
  new_node_id: string;
  new_node_name: string;
};

export const sequentialAnalysisApi = {
  sequentialAnalysis: async (
    node: string,
    req: SequentialAnalysisRequest,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await runSequentialAnalysisApiWorkspacesNodesNodeIdSequentialAnalysisPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

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
    return previewSequentialAnalysisApiWorkspacesNodesNodeIdSequentialAnalysisPreviewPost({
      body: req,
      headers,
      path: { node_id: node },
      query: { include_data: includeData },
      throwOnError: true,
    }).then(({ data }) => data as {
      state: string;
      total_records: number;
      columns: string[];
      data?: Array<Record<string, unknown>>;
      analysis_params?: Record<string, unknown>;
    });
  },

  getSequentialAnalysisTaskRequest: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await sequentialAnalysisTaskRequestApiWorkspacesSequentialAnalysisTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

  getSequentialAnalysisTaskResult: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await sequentialAnalysisTaskResultApiWorkspacesSequentialAnalysisTasksTaskIdResultGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

  postSequentialAnalysisTaskResult: async (
    taskId: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await updateSequentialAnalysisTaskResultApiWorkspacesSequentialAnalysisTasksTaskIdResultPost({
      body,
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

  sequentialAnalysisDetach: async (
    taskId: string,
    req: SequentialAnalysisDetachRequest,
    headers: Record<string, string> = {},
  ): Promise<SequentialAnalysisDetachResponse> =>
    detachSequentialAnalysisTaskApiWorkspacesSequentialAnalysisTasksTaskIdDetachPost({
      body: req,
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    }).then(({ data }) => data as SequentialAnalysisDetachResponse),
};
