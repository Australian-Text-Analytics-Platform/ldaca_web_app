import {
  clearTopicModelingEmbeddingCacheApiWorkspacesTopicModelingEmbeddingCacheDelete,
  detachTopicModelingApiWorkspacesTopicModelingTasksTaskIdDetachPost,
  getTopicModelingEmbeddingCacheSizeApiWorkspacesTopicModelingEmbeddingCacheSizeGet,
  runTopicModelingApiWorkspacesTopicModelingPost,
  topicModelingDetachOptionsApiWorkspacesTopicModelingTasksTaskIdDetachOptionsGet,
  topicModelingTaskRequestApiWorkspacesTopicModelingTasksTaskIdRequestGet,
  topicModelingTaskResultApiWorkspacesTopicModelingTasksTaskIdResultGet,
  updateTopicModelingTaskResultApiWorkspacesTopicModelingTasksTaskIdResultPost,
} from '@/api/generated/sdk.gen';
import type {
  TopicModelingData as GeneratedTopicModelingData,
  TopicModelingDetachOptionsResponse as GeneratedTopicModelingDetachOptionsResponse,
  TopicModelingDetachRequest,
  TopicModelingDetachResponse as GeneratedTopicModelingDetachResponse,
  TopicModelingRequest as GeneratedTopicModelingRequest,
  TopicModelingResponse as GeneratedTopicModelingResponse,
  TopicModelingTopic as GeneratedTopicModelingTopic,
} from '@/api/generated/types.gen';

export type {
  TopicMeaningOverrideItem,
  TopicModelingDetachNodeOption,
  TopicModelingDetachRequest,
} from '@/api/generated/types.gen';

export type TopicModelingRequest = Omit<GeneratedTopicModelingRequest, 'topic_size_mode'> & {
  topic_size_mode?: 'min' | 'exact' | null;
};

export type TopicModelingTopic = GeneratedTopicModelingTopic;

export type TopicModelingData = Omit<GeneratedTopicModelingData, 'meta'> & {
  meta?: Record<string, unknown>;
};

export type TopicModelingResultUpdate = {
  topic_size_value: number;
};

export type TopicModelingResponse = Omit<GeneratedTopicModelingResponse, 'data' | 'metadata' | 'state'> & {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  data?: TopicModelingData;
  metadata?: { task_id?: string; [key: string]: unknown };
};

export type TopicModelingDetachOptionsResponse = Omit<GeneratedTopicModelingDetachOptionsResponse, 'metadata' | 'state'> & {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  metadata?: { task_id?: string; [key: string]: unknown };
};

export type TopicModelingDetachResponse = Omit<GeneratedTopicModelingDetachResponse, 'data' | 'metadata' | 'state'> & {
  state: 'running' | 'successful' | 'failed' | 'cancelled';
  data?: { detached_nodes?: Array<{ source_node_id: string; new_node_id: string }> };
  metadata?: { task_id?: string; [key: string]: unknown };
};

export const topicModelingApi = {
  topicModeling: async (req: TopicModelingRequest, headers: Record<string, string> = {}) => {
    const { data } = await runTopicModelingApiWorkspacesTopicModelingPost({
      body: req,
      headers,
      throwOnError: true,
    });
    return data as TopicModelingResponse;
  },

  getTopicModelingTaskRequest: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await topicModelingTaskRequestApiWorkspacesTopicModelingTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },

  getTopicModelingTaskResult: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await topicModelingTaskResultApiWorkspacesTopicModelingTasksTaskIdResultGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as TopicModelingResponse;
  },

  postTopicModelingTaskResult: async (
    taskId: string,
    body: TopicModelingResultUpdate,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await updateTopicModelingTaskResultApiWorkspacesTopicModelingTasksTaskIdResultPost({
      body,
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as TopicModelingResponse;
  },

  getTopicModelingDetachOptions: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await topicModelingDetachOptionsApiWorkspacesTopicModelingTasksTaskIdDetachOptionsGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as TopicModelingDetachOptionsResponse;
  },

  topicModelingDetach: async (
    taskId: string,
    req: TopicModelingDetachRequest,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await detachTopicModelingApiWorkspacesTopicModelingTasksTaskIdDetachPost({
      body: req,
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data as TopicModelingDetachResponse;
  },

  getTopicModelingEmbeddingCacheSize: async (headers: Record<string, string> = {}) => {
    const { data } = await getTopicModelingEmbeddingCacheSizeApiWorkspacesTopicModelingEmbeddingCacheSizeGet({
      headers,
      throwOnError: true,
    });
    return data as { state: string; data: { bytes: number; files: number } };
  },

  clearTopicModelingEmbeddingCache: async (headers: Record<string, string> = {}) => {
    const { data } = await clearTopicModelingEmbeddingCacheApiWorkspacesTopicModelingEmbeddingCacheDelete({
      headers,
      throwOnError: true,
    });
    return data as {
      state: string;
      message: string;
      data: {
        bytes_freed: number;
        files_removed: number;
        measured_before: { bytes: number; files: number };
      };
    };
  },
};
