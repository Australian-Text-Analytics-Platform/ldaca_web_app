import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({
  BACKEND_API_BASE: 'http://localhost:9100/api/',
  BACKEND_PORT: '',
}));

import { getApiBase } from './env';

const locationFor = (url: string): Location => new URL(url) as unknown as Location;

describe('getApiBase development override', () => {
  afterEach(() => {
    delete window.__BACKEND_URL__;
    delete window.__WORDFLOW_CONFIG__;
  });

  it('honors the full backend URL override during split development', () => {
    expect(getApiBase({ windowLocation: locationFor('http://localhost:3000/') })).toBe(
      'http://localhost:9100/api',
    );
  });

  it('keeps served runtime configuration authoritative', () => {
    window.__WORDFLOW_CONFIG__ = { basePath: '/user/example/proxy/8001' };

    expect(getApiBase()).toBe(`${window.location.origin}/user/example/proxy/8001/api`);
  });
});
