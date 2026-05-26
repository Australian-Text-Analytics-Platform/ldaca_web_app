export class ApiError extends Error {
  status?: number;
  code?: string;
  detail?: unknown;

  constructor(message: string, opts: { status?: number; code?: string; detail?: unknown } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

export function formatErrorDetail(detail: unknown): string | null {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((entry) => {
      if (entry && typeof entry === 'object') {
        const error = entry as { loc?: unknown; msg?: unknown };
        const loc = Array.isArray(error.loc) ? error.loc.filter((value) => value !== 'body').join('.') : '';
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

export const isNetworkError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'NETWORK';