import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setConfig: vi.fn() }));

vi.mock('@/api/generated/client.gen', () => ({
  client: { setConfig: mocks.setConfig },
}));

import { setRuntimeBackendUrl } from './runtimeBackend';

describe('setRuntimeBackendUrl', () => {
  beforeEach(() => {
    mocks.setConfig.mockClear();
    delete window.__BACKEND_URL__;
  });

  it('updates both raw URL consumers and the generated client', () => {
    expect(setRuntimeBackendUrl('http://127.0.0.1:48123/')).toBe('http://127.0.0.1:48123');

    expect(window.__BACKEND_URL__).toBe('http://127.0.0.1:48123');
    expect(mocks.setConfig).toHaveBeenCalledWith({ baseUrl: 'http://127.0.0.1:48123' });
  });
});
