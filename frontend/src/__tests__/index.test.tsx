import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createRoot, installExternalFileDropGuard, render } = vi.hoisted(() => ({
  createRoot: vi.fn(),
  installExternalFileDropGuard: vi.fn(),
  render: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  createRoot,
}));
vi.mock('../lib/externalFileDropGuard', () => ({
  installExternalFileDropGuard,
}));
vi.mock('@tanstack/react-router', () => ({
  RouterProvider: () => null,
}));
vi.mock('../router', () => ({
  router: {},
}));
vi.mock('../lib/sentry', () => ({
  initSentry: vi.fn(),
}));

describe('application entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createRoot.mockReturnValue({ render });
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('installs the external file drop guard during bootstrap', async () => {
    await import('../index');

    expect(installExternalFileDropGuard).toHaveBeenCalledOnce();
    expect(installExternalFileDropGuard).toHaveBeenCalledWith(window);
  });
});
