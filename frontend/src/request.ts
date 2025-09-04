export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  params?: Record<string, any>;
  body?: any;
  formData?: FormData; // exclusive with body
  expectBlob?: boolean;
}

function buildQuery(params?: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

async function parseResponse(res: Response, expectBlob?: boolean) {
  if (!res.ok) {
    let detail: any = null;
    try { detail = await res.json(); } catch { /* ignore */ }
    const error: any = new Error(`HTTP ${res.status}`);
    error.status = res.status;
    error.body = detail;
    throw error;
  }
  if (expectBlob) return res.blob();
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

export async function apiRequest(url: string, options: RequestOptions = {}) {
  const { method = 'GET', headers = {}, params, body, formData, expectBlob } = options;
  const finalUrl = `${url}${buildQuery(params)}`;
  let fetchBody: BodyInit | undefined;
  const fetchHeaders: Record<string, string> = { ...headers };

  if (formData) {
    fetchBody = formData; // browser sets boundary headers automatically
  } else if (body !== undefined && body !== null) {
    fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'application/json';
    fetchBody = fetchHeaders['Content-Type'] === 'application/json'
      ? JSON.stringify(body)
      : body;
  }

  return parseResponse(
    await fetch(finalUrl, {
      method,
      headers: fetchHeaders,
      body: fetchBody,
      credentials: 'include', // preserve cookies if backend uses them
    }),
    expectBlob,
  );
}

// Helper shortcuts
export const getJson = (url: string, headers?: Record<string,string>, params?: Record<string,any>) =>
  apiRequest(url, { method: 'GET', headers, params });
export const postJson = (url: string, body?: any, headers?: Record<string,string>, params?: Record<string,any>) =>
  apiRequest(url, { method: 'POST', headers, body, params });
export const putJson = (url: string, body?: any, headers?: Record<string,string>, params?: Record<string,any>) =>
  apiRequest(url, { method: 'PUT', headers, body, params });
export const deleteReq = (url: string, headers?: Record<string,string>, params?: Record<string,any>) =>
  apiRequest(url, { method: 'DELETE', headers, params });