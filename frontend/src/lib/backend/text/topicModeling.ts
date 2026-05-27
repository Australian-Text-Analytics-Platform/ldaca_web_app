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
  TopicModelingDetachRequest,
  TopicModelingEmbeddingCacheClearResponse,
  TopicModelingEmbeddingCacheSizeResponse,
  TopicModelingRequestInput,
  TopicModelingRequestOutput,
} from '@/api/generated/types.gen';

export type {
  TopicMeaningOverrideItem,
  TopicModelingData as TopicModelingResultData,
  TopicModelingDetachNodeOption,
  TopicModelingDetachRequest,
  TopicModelingDetachResponse as TopicModelingDetachResult,
  TopicModelingDetachOptionsResponse as TopicModelingDetachOptionsResult,
  TopicModelingEmbeddingCacheClearResponse,
  TopicModelingEmbeddingCacheSizeResponse,
  TopicModelingRequestOutput,
  TopicModelingResponse as TopicModelingResultResponse,
  TopicModelingTopic,
} from '@/api/generated/types.gen';

export type TopicModelingRunRequest = TopicModelingRequestInput;

export type TopicModelingResultUpdate = {
  topic_size_value: number;
};

export const topicModelingApi = {
  topicModeling: async (req: TopicModelingRunRequest, headers: Record<string, string> = {}) => {
    const { data } = await runTopicModelingApiWorkspacesTopicModelingPost({
      body: req,
      headers,
      throwOnError: true,
    });
    return data;
  },

  getTopicModelingTaskRequest: async (taskId: string, headers: Record<string, string> = {}): Promise<TopicModelingRequestOutput> => {
    const { data } = await topicModelingTaskRequestApiWorkspacesTopicModelingTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
  },

  getTopicModelingTaskResult: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await topicModelingTaskResultApiWorkspacesTopicModelingTasksTaskIdResultGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
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
    return data;
  },

  getTopicModelingDetachOptions: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await topicModelingDetachOptionsApiWorkspacesTopicModelingTasksTaskIdDetachOptionsGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
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
    return data;
  },

  getTopicModelingEmbeddingCacheSize: async (headers: Record<string, string> = {}): Promise<TopicModelingEmbeddingCacheSizeResponse> => {
    const { data } = await getTopicModelingEmbeddingCacheSizeApiWorkspacesTopicModelingEmbeddingCacheSizeGet({
      headers,
      throwOnError: true,
    });
    return data;
  },

  clearTopicModelingEmbeddingCache: async (headers: Record<string, string> = {}): Promise<TopicModelingEmbeddingCacheClearResponse> => {
    const { data } = await clearTopicModelingEmbeddingCacheApiWorkspacesTopicModelingEmbeddingCacheDelete({
      headers,
      throwOnError: true,
    });
    return data;
  },
};
