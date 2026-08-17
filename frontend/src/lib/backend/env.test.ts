import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({
  BACKEND_API_BASE: '',
  BACKEND_PORT: '',
}));

import { getApiBase } from './env';

const locationFor = (url: string): Location => new URL(url) as unknown as Location;

describe('getApiBase', () => {
  afterEach(() => {
    delete window.__BACKEND_URL__;
    delete window.__WORDFLOW_CONFIG__;
  });

  it('connects a separately served browser frontend to the configured development port', () => {
    expect(getApiBase({ windowLocation: locationFor('http://localhost:3000/') })).toBe(
      'http://localhost:8001/api',
    );
  });

  it('uses the hosted runtime base path on the current origin', () => {
    window.__WORDFLOW_CONFIG__ = { basePath: '/wordflow' };

    expect(getApiBase()).toBe(`${window.location.origin}/wordflow/api`);
  });

  it('uses the current origin for a root-mounted packaged frontend', () => {
    window.__WORDFLOW_CONFIG__ = { basePath: '' };

    expect(getApiBase()).toBe(`${window.location.origin}/api`);
  });

  it('does not guess a fixed backend port for the packaged Tauri origin', () => {
    expect(getApiBase({ windowLocation: locationFor('https://tauri.localhost/') })).toBe(
      'https://tauri.localhost/api',
    );
    expect(getApiBase({ windowLocation: locationFor('tauri://localhost/') })).not.toContain(
      ':8001',
    );
  });
});
