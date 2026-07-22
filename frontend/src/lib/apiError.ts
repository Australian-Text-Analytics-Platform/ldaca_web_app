/**
 * Shared frontend error shape for HTTP, timeout, and network failures.
 * Generated-client wrappers and hooks throw this so UI surfaces can branch on
 * `status`/`code` without knowing which transport produced the failure.
 */
/** Used by: generated-client error shaping and workspace-management 404 handling. */
export class ApiError extends Error {
  status?: number;
  code?: string;
  detail?: unknown;

  /** Preserves backend response metadata alongside the user-facing message. */
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
 * Used by: src/lib/backend/generatedClientConfig.ts.
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
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- detail is a non-object primitive here (string/array/object handled above); String() is the safe fallback
  return String(detail);
}
