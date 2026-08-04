import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUNDLED_REGISTRY } from '../bundledRegistry';
import { getDocumentTarget } from '../documentationRegistry';
import { useRegistryStore, REGISTRY_SCHEMA_VERSION } from '../registryStore';
import {
  __cacheKeyForTests,
  __resetLoadPromiseForTests,
  loadRemoteRegistry,
} from '../remoteRegistry';

/** Resets the merged docs registry so remote-cache tests do not leak entries across cases. */
/** Used by: tests in this file. */
const resetStore = () => {
  useRegistryStore.setState({
    registry: {
      tutorial: { ...BUNDLED_REGISTRY.tutorial },
      info: { ...BUNDLED_REGISTRY.info },
      reference: { ...BUNDLED_REGISTRY.reference },
    },
    meta: null,
  });
};

beforeEach(() => {
  localStorage.clear();
  __resetLoadPromiseForTests();
  resetStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getDocumentTarget', () => {
  it('returns the bundled entry for a known key', () => {
    const target = getDocumentTarget('tutorial', 'ui.tool-choice');
    expect(target).toMatchObject({
      file: 'tutorials/ui.md',
      anchor: 'help-ui-tool-choice',
    });
  });

  it('returns null for an unknown key', () => {
    expect(getDocumentTarget('tutorial', 'does.not.exist')).toBeNull();
    expect(getDocumentTarget('info', 'nope')).toBeNull();
    expect(getDocumentTarget('reference', 'nope')).toBeNull();
  });

  it('lets a remote entry shadow a bundled one', () => {
    useRegistryStore.getState().applyRemote({
      tutorial: {
        'ui.tool-choice': {
          file: 'tutorials/ui-v2.md',
          anchor: 'help-ui-tool-choice-v2',
          label: 'Tool Choice (v2)',
        },
      },
    });

    expect(getDocumentTarget('tutorial', 'ui.tool-choice')).toMatchObject({
      file: 'tutorials/ui-v2.md',
      anchor: 'help-ui-tool-choice-v2',
    });
  });

  it('lets a remote entry add a new key not present in the bundle', () => {
    expect(getDocumentTarget('tutorial', 'new.feature')).toBeNull();

    useRegistryStore.getState().applyRemote({
      tutorial: {
        'new.feature': {
          file: 'tutorials/new-feature.md',
          anchor: 'help-new-feature',
        },
      },
    });

    expect(getDocumentTarget('tutorial', 'new.feature')).toMatchObject({
      file: 'tutorials/new-feature.md',
    });
  });
});

describe('loadRemoteRegistry — cache only path', () => {
  it('is a no-op when VITE_DOCS_ORIGIN is empty and no cache exists', async () => {
    vi.stubEnv('VITE_DOCS_ORIGIN', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await loadRemoteRegistry();

    expect(fetchSpy).not.toHaveBeenCalled();
    // bundled entries still resolve
    expect(getDocumentTarget('tutorial', 'ui.tool-choice')).not.toBeNull();
  });

  it('does not hydrate a versioned cache when remote docs are disabled', async () => {
    const cached = {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      fetchedAt: Date.now(),
      payload: {
        tutorial: {
          'cached.only': {
            file: 'tutorials/cached.md',
            anchor: 'help-cached',
          },
        },
      },
    };
    localStorage.setItem(
      __cacheKeyForTests('https://docs.example.com/wordflow/v0.7'),
      JSON.stringify(cached),
    );
    vi.stubEnv('VITE_DOCS_ORIGIN', '');
    vi.stubGlobal('fetch', vi.fn());

    await loadRemoteRegistry();

    expect(getDocumentTarget('tutorial', 'cached.only')).toBeNull();
  });

  it('ignores cache with a stale schemaVersion', async () => {
    const stale = {
      schemaVersion: REGISTRY_SCHEMA_VERSION + 999,
      fetchedAt: Date.now(),
      payload: {
        tutorial: { 'stale.entry': { file: 'x.md', anchor: 'y' } },
      },
    };
    vi.stubEnv('VITE_DOCS_ORIGIN', 'https://docs.example.com/wordflow');
    localStorage.setItem(
      __cacheKeyForTests('https://docs.example.com/wordflow/v0.7'),
      JSON.stringify(stale),
    );
    vi.stubGlobal('fetch', vi.fn());

    await loadRemoteRegistry();

    expect(getDocumentTarget('tutorial', 'stale.entry')).toBeNull();
  });
});

describe('loadRemoteRegistry — network path', () => {
  it('fetches registry.json from the matching minor tag and merges + caches it', async () => {
    vi.stubEnv('VITE_DOCS_ORIGIN', 'https://docs.example.com/wordflow');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      /** Returns a remote registry payload so the loader can merge and cache it. */
      json: () =>
        Promise.resolve({
          tutorial: {
            'remote.only': { file: 'tutorials/remote.md', anchor: 'help-remote' },
          },
          meta: { version: '0.7.1' },
        }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await loadRemoteRegistry();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://docs.example.com/wordflow/v0.7/registry.json',
    );

    expect(getDocumentTarget('tutorial', 'remote.only')).toMatchObject({
      file: 'tutorials/remote.md',
    });
    expect(useRegistryStore.getState().meta).toMatchObject({ version: '0.7.1' });

    // cache rewritten with the fresh payload
    const cached = JSON.parse(
      localStorage.getItem(__cacheKeyForTests('https://docs.example.com/wordflow/v0.7')) ?? '{}',
    );
    expect(cached.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
    expect(cached.payload.tutorial['remote.only'].file).toBe('tutorials/remote.md');
  });

  it('keeps the cached payload when fetch fails', async () => {
    const cached = {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      fetchedAt: Date.now(),
      payload: {
        tutorial: {
          'cached.survives': { file: 'tutorials/cached.md', anchor: 'help-cached' },
        },
      },
    };
    localStorage.setItem(
      __cacheKeyForTests('https://docs.example.com/wordflow/v0.7'),
      JSON.stringify(cached),
    );

    vi.stubEnv('VITE_DOCS_ORIGIN', 'https://docs.example.com/wordflow');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await loadRemoteRegistry();

    expect(getDocumentTarget('tutorial', 'cached.survives')).toMatchObject({
      file: 'tutorials/cached.md',
    });
  });

  it('is idempotent — repeated calls reuse the in-flight promise', async () => {
    vi.stubEnv('VITE_DOCS_ORIGIN', 'https://docs.example.com/wordflow');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      /** Returns an empty remote registry so repeated loads can share one in-flight request. */
      json: () => Promise.resolve({ tutorial: {} }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await Promise.all([loadRemoteRegistry(), loadRemoteRegistry(), loadRemoteRegistry()]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a registry cached for a different minor tag', async () => {
    localStorage.setItem(
      __cacheKeyForTests('https://docs.example.com/wordflow/v0.5'),
      JSON.stringify({
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        fetchedAt: Date.now(),
        payload: {
          tutorial: {
            'old.minor': { file: 'tutorials/old.md', anchor: 'help-old' },
          },
        },
      }),
    );
    vi.stubEnv('VITE_DOCS_ORIGIN', 'https://docs.example.com/wordflow');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await loadRemoteRegistry();

    expect(getDocumentTarget('tutorial', 'old.minor')).toBeNull();
  });
});
