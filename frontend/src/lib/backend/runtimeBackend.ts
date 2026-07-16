import { client } from '@/api/generated/client.gen';

/** Rebind every frontend API boundary after Tauri starts a backend on a new port. */
export function setRuntimeBackendUrl(url: string): string {
  const normalized = url.replace(/\/$/, '');
  window.__BACKEND_URL__ = normalized;
  client.setConfig({ baseUrl: normalized });
  return normalized;
}
