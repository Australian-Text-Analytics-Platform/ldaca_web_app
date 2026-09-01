import type { CreateClientConfig } from '@/api';
import { ApiError, formatErrorDetail } from '@/lib/apiError';
import { getCsrfToken } from '@/lib/backend/csrfToken';
import { getApiBase } from '@/lib/backend/env';

const DEFAULT_TIMEOUT_MS = 30_000;

// Opt-in per-request timeout override (milliseconds). Callers set this header to
// extend or disable the default 30s client timeout for genuinely long-running
// endpoints — e.g. the Annotation tab's AI Preview, where one provider request
// can outlast 30s. A value of "0" (or negative) disables the client timeout
// entirely, deferring to the backend's own per-request bound. The header is
// stripped before the request leaves the browser so it never reaches the server.
const TIMEOUT_OVERRIDE_HEADER = 'x-client-timeout-ms';

/** Detects Request objects so generated SDK calls can preserve caller-provided headers and signals. */
/** Called by: request-signal, timeout-override, and request-construction helpers. */
const isRequest = (input: RequestInfo | URL): input is Request =>
  typeof Request !== 'undefined' && input instanceof Request;

/** Resolves the abort signal that should be chained into the generated-client timeout. */
/** Called by: `createGeneratedApiFetch` before it creates the chained timeout. */
const getRequestSignal = (
  input: RequestInfo | URL,
  init?: RequestInit,
): AbortSignal | undefined => {
  if (init?.signal) return init.signal;
  return isRequest(input) ? input.signal : undefined;
};

/** Adapts the app's `/api` base to hey-api's expectation of the server origin. */
/** Used by: generated-client setup plus auth, export, and task-stream URL builders. */
export const getGeneratedApiBase = (apiBase = getApiBase()): string =>
  apiBase.replace(/\/api\/?$/, '');

/** Creates the per-request timeout and propagates upstream caller aborts into one signal. */
/**
 * Called by: `createGeneratedApiFetch` for every generated request.
 * Flow: arm the configured timeout, mirror the caller's abort into the same
 * signal, and expose timeout classification plus deterministic cleanup.
 */
const createTimeout = (sourceSignal?: AbortSignal, timeoutMs: number = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  // timeoutMs <= 0 disables the client-side timeout (long-running calls); we then
  // only abort when the caller's own signal fires.
  const timeoutId =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : undefined;
  /** Preserves the caller's abort reason when we chain their signal. */
  /** Registered on the caller signal and also invoked for an already-aborted signal. */
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
    /** Read by: the generated fetch wrapper's error classifier. */
    didTimeOut: () =>
      timeoutId !== undefined && controller.signal.aborted && !sourceSignal?.aborted,
    /** Removes timeout/listener resources once fetch resolves or rejects. */
    /** Called by: the generated fetch wrapper's `finally` block. */
    cleanup: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      sourceSignal?.removeEventListener('abort', abortFromSource);
    },
  };
};

/**
 * Pull the opt-in `x-client-timeout-ms` override off the outgoing headers and
 * return the resolved timeout plus an init whose headers no longer carry the
 * sentinel. Called by createGeneratedApiFetch before it builds the timeout so
 * long-running callers such as AI Preview can extend or disable the default 30s
 * cap without the header ever reaching the server.
 */
const resolveTimeoutOverride = (
  input: RequestInfo | URL,
  init?: RequestInit,
): { timeoutMs: number; init?: RequestInit } => {
  const headers = new Headers(init?.headers ?? (isRequest(input) ? input.headers : undefined));
  const raw = headers.get(TIMEOUT_OVERRIDE_HEADER);
  if (raw == null) return { timeoutMs: DEFAULT_TIMEOUT_MS, init };
  headers.delete(TIMEOUT_OVERRIDE_HEADER);
  const parsed = Number(raw);
  const timeoutMs = Number.isFinite(parsed) ? parsed : DEFAULT_TIMEOUT_MS;
  return { timeoutMs, init: { ...init, headers } };
};

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Injects the session-bound CSRF header into unsafe requests. */
/**
 * Called by: `createGeneratedApiFetch` after timeout resolution.
 * Flow: start from caller or Request headers, add the current session's CSRF header for unsafe requests, then create a Request with the chained timeout signal.
 */
const createRequest = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  signal: AbortSignal,
): Request => {
  const headers = new Headers(init?.headers ?? (isRequest(input) ? input.headers : undefined));
  const method = (init?.method ?? (isRequest(input) ? input.method : 'GET')).toUpperCase();
  const token = getCsrfToken();
  if (UNSAFE_METHODS.has(method) && token && !headers.has('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', token);
  }
  return new Request(input, { ...init, headers, signal });
};

/** Converts non-2xx generated SDK responses into the shared `ApiError` shape. */
/**
 * Called by: `createGeneratedApiFetch` for non-success responses.
 * Flow: prefer structured JSON details, fall back to response text/status,
 * and preserve status plus raw detail on the shared error.
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
  const backendMessage =
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- fall through empty-string messages to the next candidate, not only null/undefined */
    (typeof parsed?.message === 'string' && parsed.message) ||
    formatErrorDetail(parsed?.detail) ||
    formatErrorDetail(detail) ||
    `HTTP ${String(response.status)}`;
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  const code = typeof parsed?.code === 'string' ? parsed.code : undefined;
  const requestId =
    (typeof parsed?.request_id === 'string' && parsed.request_id) ||
    response.headers.get('X-Request-ID');
  const message =
    response.status >= 500 && requestId
      ? `${backendMessage} (Request ID: ${requestId})`
      : backendMessage;
  return new ApiError(message, { status: response.status, code, detail });
};

/**
 * Builds the fetch implementation passed to hey-api so generated calls inherit
 * auth, timeouts, network error shaping, and MSW-test fetch substitution.
 * Called by: createClientConfig when wiring hey-api's runtime fetch option.
 * Flow: strip the client-only timeout override, chain abort signals, inject
 * current auth, normalize HTTP/network/timeout failures, and always clean up.
 */
const createGeneratedApiFetch = (fetchImpl?: typeof fetch): typeof fetch => {
  return async (input, init) => {
    const { timeoutMs, init: cleanedInit } = resolveTimeoutOverride(input, init);
    const timeout = createTimeout(getRequestSignal(input, cleanedInit), timeoutMs);
    try {
      const request = createRequest(input, cleanedInit, timeout.signal);
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
/** Used by: the generated `client.gen.ts` initializer; covered by config tests. */
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: getGeneratedApiBase(config?.baseUrl),
  credentials: config?.credentials ?? 'include',
  fetch: createGeneratedApiFetch(config?.fetch),
});
