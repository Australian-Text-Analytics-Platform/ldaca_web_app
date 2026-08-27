import { client } from '@/api/generated/client.gen';
import { getApiBase } from '@/lib/backend/env';
import { getGeneratedApiBase } from '@/lib/backend/generatedClientConfig';
import { setRuntimeBackendUrl } from '@/lib/backend/runtimeBackend';
import { isTauri } from '@/lib/isTauri';

/** The URLs one application load uses for generated requests and bootstrap checks. */
export interface ResolvedBackendConnection {
  apiBaseUrl: string;
  clientBaseUrl: string;
  liveUrl: string;
  readyUrl: string;
  dataRootUrl: string;
}

const connectionFromApiBase = (apiBaseUrl: string): ResolvedBackendConnection => {
  const normalizedApiBase = apiBaseUrl.replace(/\/$/, '');
  const clientBaseUrl = getGeneratedApiBase(normalizedApiBase);
  const controlBase = normalizedApiBase.endsWith('/api')
    ? normalizedApiBase.slice(0, -4)
    : normalizedApiBase;
  return {
    apiBaseUrl: normalizedApiBase,
    clientBaseUrl,
    liveUrl: `${controlBase}/health/live`,
    readyUrl: `${controlBase}/health/ready`,
    dataRootUrl: `${normalizedApiBase}/data-root`,
  };
};

/**
 * Resolves and installs the backend connection before API-dependent UI mounts.
 *
 * Browser deployments retain their existing environment and same-origin rules.
 * Tauri always asks the native supervisor for its current random-port backend,
 * so reloads and backend restarts cannot reuse stale JavaScript configuration.
 */
export async function resolveBackendConnection(
  location?: Pick<Location, 'hostname' | 'protocol'>,
): Promise<ResolvedBackendConnection> {
  if (isTauri(location)) {
    const { invoke } = await import('@tauri-apps/api/core');
    const backendUrl = await invoke<string>('get_backend_url');
    if (!backendUrl.trim()) throw new Error('backend_unavailable');
    const normalizedBackendUrl = setRuntimeBackendUrl(backendUrl);
    return connectionFromApiBase(`${normalizedBackendUrl}/api`);
  }

  const connection = connectionFromApiBase(getApiBase());
  client.setConfig({ baseUrl: connection.clientBaseUrl });
  return connection;
}
