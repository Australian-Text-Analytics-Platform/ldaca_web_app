import { httpRequest, post } from '../http';

import type { LanguageHint } from './shared';

export interface TopicModelingRequest extends LanguageHint {
  node_ids: string[];
  node_columns?: Record<string, string>;
  min_topic_size?: number;
  random_seed?: number;
  representative_words_count?: number;
  sample_fractions?: (number | null)[] | null;
  // 'target' (legacy, "Aim Topic No.") is preserved here for back-compat
  // with historically persisted requests; the UI no longer emits it.
  topic_size_mode?: 'target' | 'min' | 'exact';
  topic_size_value?: number;
}

export interface TopicModelingTopic {
  id: number;
  label: string;
  representative_words?: string[];
  size: number[];
  total_size: number;
  x: number;
  y: number;
}

export interface TopicModelingData {
  topics: TopicModelingTopic[];
  corpus_sizes?: number[];
  per_corpus_topic_counts?: Array<Record<number, number>>;
  meta?: Record<string, unknown>;
}

export interface TopicModelingResultUpdate {
  topic_size_value: number;
}

export interface TopicModelingResponse {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  message: string;
  data?: TopicModelingData;
  metadata?: { task_id?: string; [k: string]: unknown };
}

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

export const topicModelingApi = {
  topicModeling: (req: TopicModelingRequest, headers: Record<string, string> = {}) =>
    post<TopicModelingResponse>(`/workspaces/topic-modeling`, req, headers),

  getTopicModelingTaskRequest: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<Record<string, unknown>>(
      `/workspaces/topic-modeling/tasks/${taskId}/request`,
      { method: 'GET', headers },
    ),

  getTopicModelingTaskResult: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<TopicModelingResponse>(
      `/workspaces/topic-modeling/tasks/${taskId}/result`,
      { method: 'GET', headers },
    ),

  postTopicModelingTaskResult: (
    taskId: string,
    body: TopicModelingResultUpdate,
    headers: Record<string, string> = {},
  ) =>
    post<TopicModelingResponse>(
      `/workspaces/topic-modeling/tasks/${taskId}/result`,
      body,
      headers,
    ),

  getTopicModelingDetachOptions: (taskId: string, headers: Record<string, string> = {}) =>
    httpRequest<TopicModelingDetachOptionsResponse>(
      `/workspaces/topic-modeling/tasks/${taskId}/detach-options`,
      { method: 'GET', headers },
    ),

  topicModelingDetach: (
    taskId: string,
    req: TopicModelingDetachRequest,
    headers: Record<string, string> = {},
  ) =>
    post<TopicModelingDetachResponse>(
      `/workspaces/topic-modeling/tasks/${taskId}/detach`,
      req,
      headers,
    ),

  getTopicModelingEmbeddingCacheSize: (headers: Record<string, string> = {}) =>
    httpRequest<{ state: string; data: { bytes: number; files: number } }>(
      `/workspaces/topic-modeling/embedding-cache/size`,
      { method: 'GET', headers },
    ),

  clearTopicModelingEmbeddingCache: (headers: Record<string, string> = {}) =>
    httpRequest<{
      state: string;
      message: string;
      data: {
        bytes_freed: number;
        files_removed: number;
        measured_before: { bytes: number; files: number };
      };
    }>(`/workspaces/topic-modeling/embedding-cache`, { method: 'DELETE', headers }),
};
