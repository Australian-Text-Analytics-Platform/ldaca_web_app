/**
 * Shared frontend error shape for HTTP, timeout, and network failures.
 * Generated-client wrappers and hooks throw this so UI surfaces can branch on
 * `status`/`code` without knowing which transport produced the failure.
 */
/** Used by: src/features/workspace/common/hooks/useWorkspaceNodeMutations.ts, src/lib/backend/__tests__/generatedClientConfig.test.ts, src/lib/backend/generatedClientConfig.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export class ApiError extends Error {
  status?: number;
  code?: string;
  detail?: unknown;

  /** Preserves backend response metadata alongside the user-facing message. */
  /** Called by: ApiError construction sites because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
  constructor(message: string, opts: { status?: number; code?: string; detail?: unknown } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

/**
 * Collapses FastAPI/HTTP validation detail payloads into compact text for
 * snackbars, banners, and thrown `ApiError` messages.
 */
/**
 * Used by: src/lib/backend/generatedClientConfig.ts because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export function formatErrorDetail(detail: unknown): string | null {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((entry) => {
      if (entry && typeof entry === 'object') {
        const error = entry as { loc?: unknown; msg?: unknown };
        const loc = Array.isArray(error.loc)
          ? error.loc.filter((value) => value !== 'body').join('.')
          : '';
        const msg = typeof error.msg === 'string' ? error.msg : '';
        if (loc && msg) return `${loc}: ${msg}`;
        if (msg) return msg;
      }
      try {
        return JSON.stringify(entry);
      } catch {
        return String(entry);
      }
    });
    const joined = parts.filter(Boolean).join('; ');
    return joined || null;
  }
  if (typeof detail === 'object') {
    const obj = detail as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    try {
      return JSON.stringify(obj);
    } catch {
      return null;
    }
  }
  return String(detail);
}

/** Lets callers identify fetch-level failures without coupling to TypeError text. */
/** Used by: src/features/analysis/common/useAnalysisHydration.ts because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
export const isNetworkError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'NETWORK';
