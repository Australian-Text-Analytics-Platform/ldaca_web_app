import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('@sentry/react');
  vi.resetModules();
});

/** Installs a minimal dynamically imported Sentry SDK and returns its spies. */
function mockSentryModule() {
  const captureException = vi.fn();
  const init = vi.fn();
  vi.doMock('@sentry/react', () => ({
    init,
    captureException,
    browserTracingIntegration: () => 'tracing',
    replayIntegration: () => 'replay',
  }));
  return { captureException, init };
}

describe('optional Sentry adapter', () => {
  it('does not request the SDK when no DSN is configured', async () => {
    const moduleFactory = vi.fn(() => ({
      init: vi.fn(),
      captureException: vi.fn(),
      browserTracingIntegration: vi.fn(),
      replayIntegration: vi.fn(),
    }));
    vi.doMock('@sentry/react', moduleFactory);
    const { initSentry } = await import('../sentry');

    await initSentry({ dsn: '' });

    expect(moduleFactory).not.toHaveBeenCalled();
  });

  it('buffers pre-root browser errors until the configured SDK is ready', async () => {
    const { captureException, init } = mockSentryModule();
    const { initSentry } = await import('../sentry');

    const ready = initSentry({
      dsn: 'https://example.invalid/1',
      environment: 'test',
      release: '1.2.3',
      isProduction: true,
    });
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('before root') }));
    await ready;

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://example.invalid/1',
        environment: 'test',
        release: '1.2.3',
        tracesSampleRate: 0.1,
      }),
    );
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'before root' }),
      undefined,
    );
  });

  it('forwards caught render errors through the same initialized adapter', async () => {
    const { captureException } = mockSentryModule();
    const { captureException: captureThroughAdapter, initSentry } = await import('../sentry');
    await initSentry({ dsn: 'https://example.invalid/1' });
    const error = new Error('render failed');

    captureThroughAdapter(error, { tags: { boundary: 'workspace' } });

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { boundary: 'workspace' },
    });
  });
});
