import type { StreamTasksData } from '@/api';
import { getGeneratedApiBase } from '@/lib/backend/generatedClientConfig';

const STREAM_TASKS_PATH: StreamTasksData['url'] = '/api/tasks/stream';

/**
 * Returns the bearer token value EventSource must carry in the query string.
 * Called by: buildTaskStreamUrl because EventSource cannot attach generated
 * SDK auth headers directly.
 */
const bearerTokenFromHeaders = (authHeaders: Record<string, string>) => {
  const authValue = authHeaders.Authorization ?? authHeaders.authorization;
  if (!authValue) return null;
  const token = authValue.startsWith('Bearer ') ? authValue.slice(7) : authValue;
  return token || null;
};

/**
 * Builds the native EventSource URL for the generated task-stream endpoint.
 * Used by: useWorkspaceTaskStreamClient because SSE uses a browser URL string
 * while still needing the generated endpoint path/query contract.
 * Flow: read the generated API base, attach the generated optional `token`
 * query parameter when a bearer auth header exists, and return the stream URL.
 */
export const buildTaskStreamUrl = (authHeaders: Record<string, string>): string => {
  const query: StreamTasksData['query'] = {};
  const token = bearerTokenFromHeaders(authHeaders);
  if (token) {
    query.token = token;
  }

  const params = new URLSearchParams();
  if (query.token) {
    params.set('token', query.token);
  }

  const suffix = params.toString();
  return `${getGeneratedApiBase()}${STREAM_TASKS_PATH}${suffix ? `?${suffix}` : ''}`;
};
