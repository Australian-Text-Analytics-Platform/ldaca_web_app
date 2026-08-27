import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { client } from '@/api/generated/client.gen';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('@/config/env', () => ({
  BACKEND_API_BASE: '',
  BACKEND_PORT: '',
}));

import { resolveBackendConnection } from './backendConnection';

describe('resolveBackendConnection', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  afterEach(() => {
    delete window.__BACKEND_URL__;
    delete window.__WORDFLOW_CONFIG__;
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('uses hosted browser runtime configuration without calling Tauri', async () => {
    window.__WORDFLOW_CONFIG__ = { basePath: '/user/example/proxy/3000' };

    const connection = await resolveBackendConnection();

    expect(connection).toEqual({
      apiBaseUrl: `${window.location.origin}/user/example/proxy/3000/api`,
      clientBaseUrl: `${window.location.origin}/user/example/proxy/3000`,
      liveUrl: `${window.location.origin}/user/example/proxy/3000/health/live`,
      readyUrl: `${window.location.origin}/user/example/proxy/3000/health/ready`,
      dataRootUrl: `${window.location.origin}/user/example/proxy/3000/api/data-root`,
    });
    expect(client.getConfig().baseUrl).toBe(`${window.location.origin}/user/example/proxy/3000`);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('replaces stale desktop configuration with the Tauri-owned backend URL', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    window.__BACKEND_URL__ = 'http://127.0.0.1:8001';
    mocks.invoke.mockResolvedValue('http://127.0.0.1:49123');

    const connection = await resolveBackendConnection();

    expect(connection).toEqual({
      apiBaseUrl: 'http://127.0.0.1:49123/api',
      clientBaseUrl: 'http://127.0.0.1:49123',
      liveUrl: 'http://127.0.0.1:49123/health/live',
      readyUrl: 'http://127.0.0.1:49123/health/ready',
      dataRootUrl: 'http://127.0.0.1:49123/api/data-root',
    });
    expect(window.__BACKEND_URL__).toBe('http://127.0.0.1:49123');
    expect(client.getConfig().baseUrl).toBe('http://127.0.0.1:49123');
    expect(mocks.invoke).toHaveBeenCalledWith('get_backend_url');
  });

  it('uses IPC for a reloaded Tauri URL even before native globals are restored', async () => {
    mocks.invoke.mockResolvedValue('http://127.0.0.1:49124');

    const connection = await resolveBackendConnection(new URL('tauri://localhost'));

    expect(connection.liveUrl).toBe('http://127.0.0.1:49124/health/live');
    expect(mocks.invoke).toHaveBeenCalledWith('get_backend_url');
  });
});
