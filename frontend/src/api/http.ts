import { getApiBase } from './env';

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

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  body?: unknown;
  formData?: FormData;
  expectBlob?: boolean;
  timeoutMs?: number;
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      v.forEach(item => usp.append(k, String(item)));
    } else if (typeof v === 'object' && !(v instanceof Date)) {
      usp.append(k, JSON.stringify(v));
    } else {
      usp.append(k, String(v));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

function formatErrorDetail(detail: unknown): string | null {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((entry) => {
      if (entry && typeof entry === 'object') {
        const e = entry as { loc?: unknown; msg?: unknown; type?: unknown };
        const loc = Array.isArray(e.loc) ? e.loc.filter((v) => v !== 'body').join('.') : '';
        const msg = typeof e.msg === 'string' ? e.msg : '';
        if (loc && msg) return `${loc}: ${msg}`;
        if (msg) return msg;
      }
      try { return JSON.stringify(entry); } catch { return String(entry); }
    });
    const joined = parts.filter(Boolean).join('; ');
    return joined || null;
  }
  if (typeof detail === 'object') {
    const obj = detail as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    try { return JSON.stringify(obj); } catch { return null; }
  }
  return String(detail);
}

async function parseResponse(res: Response, expectBlob?: boolean) {
  if (!res.ok) {
    let detail: unknown = null;
    try { detail = await res.json(); } catch { /* ignore */ }
    const parsed = detail as Record<string, unknown> | null;
    const message =
      (typeof parsed?.message === 'string' && parsed.message)
      || formatErrorDetail(parsed?.detail)
      || formatErrorDetail(parsed)
      || `HTTP ${res.status}`;
    throw new ApiError(message, { status: res.status, detail });
  }
  if (expectBlob) return res.blob();
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const raw = await res.json();
    return raw;
  }
  return res.text();
}

export async function httpRequest<T=unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const base = getApiBase();
  const { method = 'GET', headers = {}, params, body, formData, expectBlob, timeoutMs = 30000 } = opts;
  const url = `${base}${path}${buildQuery(params)}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  let fetchBody: BodyInit | undefined;
  const fetchHeaders: Record<string,string> = { ...headers };

  if (formData) {
    fetchBody = formData;
  } else if (body !== undefined && body !== null) {
    fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'application/json';
    fetchBody = fetchHeaders['Content-Type'] === 'application/json' ? JSON.stringify(body) : body as BodyInit;
  }

  try {
    const res = await fetch(url, { method, headers: fetchHeaders, body: fetchBody, credentials: 'include', signal: controller.signal });
    return await parseResponse(res, expectBlob) as T;
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new ApiError('Request timeout', { code: 'TIMEOUT' });
    if (e instanceof TypeError) {
      // Browsers throw TypeError("Failed to fetch") when the network request
      // can't reach the server (offline, backend restarting, CORS preflight
      // refused). Tag it so callers can distinguish recoverable network
      // failures from real server errors.
      throw new ApiError(e.message || 'Network unreachable', { code: 'NETWORK', detail: e });
    }
    throw e;
  } finally {
    clearTimeout(id);
  }
}

/** True for ApiError instances that represent a transient network failure. */
export const isNetworkError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'NETWORK';

// Convenience helpers
export const get = <T=unknown>(path: string, headers?: Record<string,string>, params?: Record<string,unknown>) => httpRequest<T>(path, { method: 'GET', headers, params });
export const post = <T=unknown>(path: string, body?: unknown, headers?: Record<string,string>, params?: Record<string,unknown>) => httpRequest<T>(path, { method: 'POST', headers, body, params });
export const put = <T=unknown>(path: string, body?: unknown, headers?: Record<string,string>, params?: Record<string,unknown>) => httpRequest<T>(path, { method: 'PUT', headers, body, params });
export const del = <T=unknown>(path: string, headers?: Record<string,string>, params?: Record<string,unknown>) => httpRequest<T>(path, { method: 'DELETE', headers, params });
