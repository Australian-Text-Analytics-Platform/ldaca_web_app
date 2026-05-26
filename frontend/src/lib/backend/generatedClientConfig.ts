import { getApiBase } from '@/lib/backend/env';
import { ApiError, formatErrorDetail } from '@/lib/apiError';

import type { CreateClientConfig } from '@/api/generated/client.gen';

const DEFAULT_TIMEOUT_MS = 30_000;

const isRequest = (input: RequestInfo | URL): input is Request =>
  typeof Request !== 'undefined' && input instanceof Request;

const getRequestSignal = (input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined => {
  if (init?.signal) return init.signal;
  return isRequest(input) ? input.signal : undefined;
};

export const getGeneratedApiBase = (apiBase = getApiBase()): string => apiBase.replace(/\/api\/?$/, '');

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const { useAuthStore } = await import('@/stores/authStore');
  return useAuthStore.getState().getAuthHeaders();
};

const createTimeout = (sourceSignal?: AbortSignal) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const abortFromSource = () => controller.abort(sourceSignal?.reason);

  if (sourceSignal?.aborted) {
    abortFromSource();
  } else {
    sourceSignal?.addEventListener('abort', abortFromSource, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeOut: () => controller.signal.aborted && !sourceSignal?.aborted,
    cleanup: () => {
      clearTimeout(timeoutId);
      sourceSignal?.removeEventListener('abort', abortFromSource);
    },
  };
};

const createRequest = async (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal: AbortSignal,
): Promise<Request> => {
  const headers = new Headers(init?.headers ?? (isRequest(input) ? input.headers : undefined));
  for (const [name, value] of Object.entries(await getAuthHeaders())) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
  return new Request(input, { ...init, headers, signal });
};

const parseErrorResponse = async (response: Response): Promise<ApiError> => {
  let detail: unknown = null;
  try {
    detail = await response.clone().json();
  } catch {
    try {
      detail = await response.clone().text();
    } catch {
      detail = null;
    }
  }

  const parsed = detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : null;
  const message =
    (typeof parsed?.message === 'string' && parsed.message) ||
    formatErrorDetail(parsed?.detail) ||
    formatErrorDetail(detail) ||
    `HTTP ${response.status}`;

  return new ApiError(message, { status: response.status, detail });
};

export const createGeneratedApiFetch = (fetchImpl?: typeof fetch): typeof fetch => {
  return async (input, init) => {
    const timeout = createTimeout(getRequestSignal(input, init));
    try {
      const request = await createRequest(input, init, timeout.signal);
      const response = await (fetchImpl ?? globalThis.fetch)(request);
      if (!response.ok) {
        throw await parseErrorResponse(response);
      }
      return response;
    } catch (error) {
      if (timeout.didTimeOut()) {
        throw new ApiError('Request timeout', { code: 'TIMEOUT' });
      }
      if (error instanceof TypeError) {
        throw new ApiError(error.message || 'Network unreachable', { code: 'NETWORK', detail: error });
      }
      throw error;
    } finally {
      timeout.cleanup();
    }
  };
};

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: getGeneratedApiBase(config?.baseUrl),
  credentials: config?.credentials ?? 'include',
  fetch: createGeneratedApiFetch(config?.fetch),
});