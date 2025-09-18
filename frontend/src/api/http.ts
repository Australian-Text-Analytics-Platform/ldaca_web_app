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
  params?: Record<string, any>;
  body?: any;
  formData?: FormData;
  expectBlob?: boolean;
  timeoutMs?: number;
}

function buildQuery(params?: Record<string, any>): string {
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

// normalizeEnvelope previously mapped legacy {status|success} → state; now backend emits canonical 'state'.
function normalizeEnvelope(obj: any) {
  return obj;
}

function deepUnwrap(data: any, depth = 0): any {
  if (!data || typeof data !== 'object' || depth > 3) return data;
  const hasNested = data && typeof data === 'object' && ('data' in data) && data.data && typeof data.data === 'object' && (('state' in data.data));
  if (hasNested) {
    return deepUnwrap(data.data, depth + 1);
  }
  return data;
}

async function parseResponse(res: Response, expectBlob?: boolean) {
  if (!res.ok) {
    let detail: any = null;
    try { detail = await res.json(); } catch { /* ignore */ }
    const message = detail?.message || detail?.detail || `HTTP ${res.status}`;
    throw new ApiError(message, { status: res.status, detail });
  }
  if (expectBlob) return res.blob();
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const raw = await res.json();
    // Normalize top-level envelope if it looks like one
    if (raw && typeof raw === 'object') {
      // If token frequency or analysis endpoints: they already produce { state, message?, data }
      normalizeEnvelope(raw);
      // If we detect nested envelope pattern, unwrap and keep outer state/message
      if (raw && typeof raw === 'object' && 'data' in raw && raw.data && typeof raw.data === 'object') {
        const inner = raw.data;
        if (inner && typeof inner === 'object' && (inner.state || inner.status || inner.success)) {
          // Preserve outer state if present; prefer most inner successful state if outer is running
          const unwrapped = deepUnwrap(raw);
          if (unwrapped !== raw) return normalizeEnvelope(unwrapped);
        }
      }
    }
    return raw;
  }
  return res.text();
}

export async function httpRequest<T=any>(path: string, opts: RequestOptions = {}): Promise<T> {
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
    fetchBody = fetchHeaders['Content-Type'] === 'application/json' ? JSON.stringify(body) : body;
  }

  try {
    const res = await fetch(url, { method, headers: fetchHeaders, body: fetchBody, credentials: 'include', signal: controller.signal });
    return await parseResponse(res, expectBlob) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new ApiError('Request timeout', { code: 'TIMEOUT' });
    throw e;
  } finally {
    clearTimeout(id);
  }
}

// Convenience helpers
export const get = <T=any>(path: string, headers?: Record<string,string>, params?: Record<string,any>) => httpRequest<T>(path, { method: 'GET', headers, params });
export const post = <T=any>(path: string, body?: any, headers?: Record<string,string>, params?: Record<string,any>) => httpRequest<T>(path, { method: 'POST', headers, body, params });
export const put = <T=any>(path: string, body?: any, headers?: Record<string,string>, params?: Record<string,any>) => httpRequest<T>(path, { method: 'PUT', headers, body, params });
export const del = <T=any>(path: string, headers?: Record<string,string>, params?: Record<string,any>) => httpRequest<T>(path, { method: 'DELETE', headers, params });
