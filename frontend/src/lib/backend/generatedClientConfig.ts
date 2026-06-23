import { getApiBase } from '@/lib/backend/env';
import { ApiError, formatErrorDetail } from '@/lib/apiError';

import type { CreateClientConfig } from '@/api';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Detects Request objects so generated SDK calls can preserve caller-provided headers and signals. */
/** Called by: getGeneratedApiBase and createClientConfig in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const isRequest = (input: RequestInfo | URL): input is Request =>
  typeof Request !== 'undefined' && input instanceof Request;

/** Resolves the abort signal that should be chained into the generated-client timeout. */
/** Called by: getGeneratedApiBase and createClientConfig in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const getRequestSignal = (
  input: RequestInfo | URL,
  init?: RequestInit,
): AbortSignal | undefined => {
  if (init?.signal) return init.signal;
  return isRequest(input) ? input.signal : undefined;
};

/** Adapts the app's `/api` base to hey-api's expectation of the server origin. */
/** Used by: src/lib/backend/__tests__/generatedClientConfig.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export const getGeneratedApiBase = (apiBase = getApiBase()): string =>
  apiBase.replace(/\/api\/?$/, '');

/** Lazy-loads auth headers to avoid an import cycle between generated SDK config and the auth store. */
/** Called by: getGeneratedApiBase and createClientConfig in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const { useAuthStore } = await import('@/stores/authStore');
  return useAuthStore.getState().getAuthHeaders();
};

/** Creates the per-request timeout and propagates upstream caller aborts into one signal. */
/**
 * Called by: getGeneratedApiBase and createClientConfig in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: read runtime configuration, normalize request or response details, then return the backend-facing value.
 */
const createTimeout = (sourceSignal?: AbortSignal) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, DEFAULT_TIMEOUT_MS);
  /** Preserves the caller's abort reason when we chain their signal. */
  /** Called by: getGeneratedApiBase and createClientConfig in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
  const abortFromSource = () => {
    controller.abort(sourceSignal?.reason);
  };

  if (sourceSignal?.aborted) {
    abortFromSource();
  } else {
    sourceSignal?.addEventListener('abort', abortFromSource, { once: true });
  }

  return {
    signal: controller.signal,
    /** Distinguishes our timeout abort from an abort requested by the original caller. */
    /** Called by: getGeneratedApiBase and createClientConfig in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
    didTimeOut: () => controller.signal.aborted && !sourceSignal?.aborted,
    /** Removes timeout/listener resources once fetch resolves or rejects. */
    /** Used by: src/test/setup.ts because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
    cleanup: () => {
      clearTimeout(timeoutId);
      sourceSignal?.removeEventListener('abort', abortFromSource);
    },
  };
};

/** Injects auth headers into a Request while leaving explicit caller headers untouched. */
/**
 * Called by: getGeneratedApiBase and createClientConfig in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: start from caller or Request headers, fill missing auth headers lazily, then create a Request with the chained timeout signal.
 */
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

/** Converts non-2xx generated SDK responses into the shared `ApiError` shape. */
/**
 * Called by: getGeneratedApiBase and createClientConfig in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: read runtime configuration, normalize request or response details, then return the backend-facing value.
 */
const parseErrorResponse = async (response: Response): Promise<ApiError> => {
  let detail: unknown;
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
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- fall through empty-string messages to the next candidate, not only null/undefined */
    (typeof parsed?.message === 'string' && parsed.message) ||
    formatErrorDetail(parsed?.detail) ||
    formatErrorDetail(detail) ||
    `HTTP ${String(response.status)}`;
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  return new ApiError(message, { status: response.status, detail });
};

/**
 * Builds the fetch implementation passed to hey-api so generated calls inherit
 * auth, timeouts, network error shaping, and MSW-test fetch substitution.
 * Called by: createClientConfig when wiring hey-api's runtime fetch option because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: read runtime configuration, normalize request or response details, then return the backend-facing value.
 */
const createGeneratedApiFetch = (fetchImpl?: typeof fetch): typeof fetch => {
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
        throw new ApiError(error.message || 'Network unreachable', {
          code: 'NETWORK',
          detail: error,
        });
      }
      throw error;
    } finally {
      timeout.cleanup();
    }
  };
};

/** Supplies hey-api's runtime config for every generated SDK call site. */
/** Used by: src/lib/backend/__tests__/generatedClientConfig.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: getGeneratedApiBase(config?.baseUrl),
  credentials: config?.credentials ?? 'include',
  fetch: createGeneratedApiFetch(config?.fetch),
});
