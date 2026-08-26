import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/App', () => ({ default: () => null }));

describe('router runtime base path', () => {
  afterEach(() => {
    delete window.__WORDFLOW_CONFIG__;
    vi.resetModules();
  });

  it('mounts below the Jupyter proxy path published by runtime-config.js', async () => {
    window.__WORDFLOW_CONFIG__ = { basePath: '/user/example/proxy/3000' };

    const { router } = await import('@/router');

    expect(router.options.basepath).toBe('/user/example/proxy/3000');
  });
});
