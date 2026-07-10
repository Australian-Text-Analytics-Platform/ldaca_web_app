import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('stopword');
  vi.resetModules();
});

describe('loadMergedStopwords lazy module boundary', () => {
  it('keeps metadata and unsupported-language paths independent of the list chunk', async () => {
    const moduleFactory = vi.fn(() => ({ eng: ['about'] }));
    vi.doMock('stopword', moduleFactory);
    const { listSupportedStopwordLanguages, loadMergedStopwords } = await import(
      '../loadMergedStopwords'
    );

    expect(listSupportedStopwordLanguages()).toContainEqual({ iso6391: 'en', name: 'English' });
    await expect(loadMergedStopwords({ languages: ['xx'] })).resolves.toEqual({
      byLanguage: [],
      merged: [],
    });
    expect(moduleFactory).not.toHaveBeenCalled();
  });

  it('shares one module promise across first, concurrent, and repeated loads', async () => {
    let releaseModule: ((module: { eng: string[] }) => void) | undefined;
    const moduleFactory = vi.fn(
      () =>
        new Promise<{ eng: string[] }>((resolve) => {
          releaseModule = resolve;
        }),
    );
    vi.doMock('stopword', moduleFactory);
    const { loadMergedStopwords } = await import('../loadMergedStopwords');

    const first = loadMergedStopwords({ languages: ['en'] });
    const concurrent = loadMergedStopwords({ languages: ['eng'] });
    await vi.waitFor(() => {
      expect(moduleFactory).toHaveBeenCalledOnce();
    });
    releaseModule?.({ eng: ['about', 'after'] });

    await expect(first).resolves.toEqual({
      byLanguage: [{ language: 'en', words: ['about', 'after'] }],
      merged: ['about', 'after'],
    });
    await expect(concurrent).resolves.toEqual({
      byLanguage: [{ language: 'eng', words: ['about', 'after'] }],
      merged: ['about', 'after'],
    });
    await expect(loadMergedStopwords({ languages: ['en'] })).resolves.toBeDefined();
    expect(moduleFactory).toHaveBeenCalledOnce();
  });

  it('surfaces an offline chunk failure to the calling UI', async () => {
    const moduleFactory = vi.fn(() => Promise.reject(new Error('offline')));
    vi.doMock('stopword', moduleFactory);
    const { loadMergedStopwords } = await import('../loadMergedStopwords');

    await expect(loadMergedStopwords({ languages: ['en'] })).rejects.toThrow();
    expect(moduleFactory).toHaveBeenCalledOnce();
  });

  it('treats a missing package export as an empty selected-language list', async () => {
    vi.doMock('stopword', () => ({ eng: undefined }));
    const { loadMergedStopwords } = await import('../loadMergedStopwords');

    await expect(loadMergedStopwords({ languages: ['en'] })).resolves.toEqual({
      byLanguage: [{ language: 'en', words: [] }],
      merged: [],
    });
  });
});
