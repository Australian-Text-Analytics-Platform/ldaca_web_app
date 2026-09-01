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
function formatErrorDetail(detail: unknown): string | null {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((entry) => {
      if (entry && typeof entry === 'object') {
        const error = entry as {
          loc?: unknown;
          location?: unknown;
          message?: unknown;
          msg?: unknown;
        };
        const canonicalMessage = typeof error.message === 'string' ? error.message : undefined;
        const rawLocation = canonicalMessage === undefined ? (error.location ?? error.loc) : null;
        const loc = Array.isArray(rawLocation)
          ? rawLocation.filter((value) => value !== 'body').join('.')
          : '';
        const rawMessage = canonicalMessage ?? error.msg;
        const msg = typeof rawMessage === 'string' ? rawMessage : '';
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

interface ParseApiErrorOptions {
  fallbackMessage?: string;
  includeRequestId?: boolean;
  includeResponseText?: boolean;
}

/** Parse one backend error envelope without discarding its diagnostic message. */
export async function parseApiErrorResponse(
  response: Response,
  options: ParseApiErrorOptions = {},
): Promise<ApiError> {
  let detail: unknown;
  let parsedJson = true;
  try {
    detail = await response.clone().json();
  } catch {
    parsedJson = false;
    try {
      detail = await response.clone().text();
    } catch {
      detail = null;
    }
  }

  const parsed = detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : null;
  const fallbackDetail = parsedJson || options.includeResponseText !== false ? detail : null;
  const nestedError =
    parsed?.error && typeof parsed.error === 'object'
      ? (parsed.error as Record<string, unknown>)
      : null;
  const backendMessage =
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- empty messages deliberately fall through */
    formatErrorDetail(parsed?.details) ||
    (typeof parsed?.message === 'string' && parsed.message) ||
    (typeof nestedError?.message === 'string' && nestedError.message) ||
    formatErrorDetail(parsed?.detail) ||
    formatErrorDetail(fallbackDetail) ||
    options.fallbackMessage ||
    `HTTP ${String(response.status)}`;
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  const code = typeof parsed?.code === 'string' ? parsed.code : undefined;
  const requestId =
    (typeof parsed?.request_id === 'string' && parsed.request_id) ||
    response.headers.get('X-Request-ID');
  const message =
    response.status >= 500 && requestId && options.includeRequestId !== false
      ? `${backendMessage} (Request ID: ${requestId})`
      : backendMessage;
  return new ApiError(message, { status: response.status, code, detail });
}
