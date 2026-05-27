import {
  calculateTokenFrequenciesApiWorkspacesTokenFrequenciesPost,
  getDefaultStopWordsApiTextDefaultStopWordsGet,
  tokenFrequenciesTaskRequestApiWorkspacesTokenFrequenciesTasksTaskIdRequestGet,
  tokenFrequenciesTaskResultApiWorkspacesTokenFrequenciesTasksTaskIdResultGet,
  updateTokenFrequenciesTaskResultApiWorkspacesTokenFrequenciesTasksTaskIdResultPost,
} from '@/api/generated/sdk.gen';
import type {
  TokenFrequencyRequestInput,
  TokenFrequencyRequestOutput,
} from '@/api/generated/types.gen';

export type { DefaultStopWordsResponse, TokenFrequencyNodeResult, TokenFrequencyRequestOutput, TokenFrequencyResponse as TokenFrequencyResultResponse } from '@/api/generated/types.gen';
export type TokenFrequencyRequest = TokenFrequencyRequestInput;

export const tokenFrequencyApi = {
  tokenFrequencies: async (req: TokenFrequencyRequest, headers: Record<string, string> = {}) => {
    const { data } = await calculateTokenFrequenciesApiWorkspacesTokenFrequenciesPost({
      body: req,
      headers,
      throwOnError: true,
    });
    return data;
  },

  /**
   * Fetch the bundled default stop-word list for a language. ``strict``
   * controls fallback: when ``true``, unknown languages return ``[]``;
   * when ``false`` (default, used by token-frequency), unknown languages
   * silently substitute the English list — keeps the existing
   * "fill defaults" UX working when language metadata is missing.
   */
  defaultStopWords: (
    _headers: Record<string, string> = {},
    options?: { language?: string; strict?: boolean },
  ) => {
    return getDefaultStopWordsApiTextDefaultStopWordsGet({
      query: {
        language: options?.language,
        strict: options?.strict,
      },
      throwOnError: true,
    }).then(({ data }) => data);
  },

  getTokenFrequenciesTaskRequest: async (taskId: string, headers: Record<string, string> = {}): Promise<TokenFrequencyRequestOutput> => {
    const { data } = await tokenFrequenciesTaskRequestApiWorkspacesTokenFrequenciesTasksTaskIdRequestGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
  },

  getTokenFrequenciesTaskResult: async (taskId: string, headers: Record<string, string> = {}) => {
    const { data } = await tokenFrequenciesTaskResultApiWorkspacesTokenFrequenciesTasksTaskIdResultGet({
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
  },

  postTokenFrequenciesTaskResult: async (
    taskId: string,
    reqUpdate: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await updateTokenFrequenciesTaskResultApiWorkspacesTokenFrequenciesTasksTaskIdResultPost({
      body: reqUpdate,
      headers,
      path: { task_id: taskId },
      throwOnError: true,
    });
    return data;
  },
};
