import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUNDLED_REGISTRY } from '../bundledRegistry';
import { getDocTarget } from '../getDocTarget';
import { useRegistryStore, REGISTRY_SCHEMA_VERSION } from '../registryStore';
import {
  __CACHE_KEY_FOR_TESTS,
  __resetLoadPromiseForTests,
  loadRemoteRegistry,
} from '../remoteRegistry';

/** Resets the merged docs registry so remote-cache tests do not leak entries across cases. */
/** Used by: tests in this file because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
const resetStore = () => {
  useRegistryStore.setState({
    registry: {
      tutorial: { ...BUNDLED_REGISTRY.tutorial },
      info: { ...BUNDLED_REGISTRY.info },
      reference: { ...BUNDLED_REGISTRY.reference },
    },
    meta: null,
    lastFetchedAt: null,
    remoteAttempted: false,
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

describe('getDocTarget', () => {
  it('returns the bundled entry for a known key', () => {
    const target = getDocTarget('tutorial', 'ui.tool-choice');
    expect(target).toMatchObject({
      file: 'tutorials/ui.md',
      anchor: 'help-ui-tool-choice',
    });
  });

  it('returns null for an unknown key', () => {
    expect(getDocTarget('tutorial', 'does.not.exist')).toBeNull();
    expect(getDocTarget('info', 'nope')).toBeNull();
    expect(getDocTarget('reference', 'nope')).toBeNull();
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

    expect(getDocTarget('tutorial', 'ui.tool-choice')).toMatchObject({
      file: 'tutorials/ui-v2.md',
      anchor: 'help-ui-tool-choice-v2',
    });
  });

  it('lets a remote entry add a new key not present in the bundle', () => {
    expect(getDocTarget('tutorial', 'new.feature')).toBeNull();

    useRegistryStore.getState().applyRemote({
      tutorial: {
        'new.feature': {
          file: 'tutorials/new-feature.md',
          anchor: 'help-new-feature',
        },
      },
    });

    expect(getDocTarget('tutorial', 'new.feature')).toMatchObject({
      file: 'tutorials/new-feature.md',
    });
  });
});

describe('loadRemoteRegistry — cache only path', () => {
  it('is a no-op when VITE_DOCS_BASE_URL is empty and no cache exists', async () => {
    vi.stubEnv('VITE_DOCS_BASE_URL', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await loadRemoteRegistry();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useRegistryStore.getState().remoteAttempted).toBe(true);
    // bundled entries still resolve
    expect(getDocTarget('tutorial', 'ui.tool-choice')).not.toBeNull();
  });

  it('hydrates from cache synchronously when present', async () => {
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
    localStorage.setItem(__CACHE_KEY_FOR_TESTS, JSON.stringify(cached));
    vi.stubEnv('VITE_DOCS_BASE_URL', '');
    vi.stubGlobal('fetch', vi.fn());

    await loadRemoteRegistry();

    expect(getDocTarget('tutorial', 'cached.only')).toMatchObject({
      file: 'tutorials/cached.md',
    });
  });

  it('ignores cache with a stale schemaVersion', async () => {
    const stale = {
      schemaVersion: REGISTRY_SCHEMA_VERSION + 999,
      fetchedAt: Date.now(),
      payload: {
        tutorial: { 'stale.entry': { file: 'x.md', anchor: 'y' } },
      },
    };
    localStorage.setItem(__CACHE_KEY_FOR_TESTS, JSON.stringify(stale));
    vi.stubEnv('VITE_DOCS_BASE_URL', '');
    vi.stubGlobal('fetch', vi.fn());

    await loadRemoteRegistry();

    expect(getDocTarget('tutorial', 'stale.entry')).toBeNull();
  });
});

describe('loadRemoteRegistry — network path', () => {
  it('fetches registry.json from VITE_DOCS_BASE_URL and merges + caches it', async () => {
    vi.stubEnv('VITE_DOCS_BASE_URL', 'https://docs.example.com/v0.3');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      /** Returns a remote registry payload so the loader can merge and cache it. */
      /** Called by: mocked fetch responses in these tests because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
      json: () =>
        Promise.resolve({
          tutorial: {
            'remote.only': { file: 'tutorials/remote.md', anchor: 'help-remote' },
          },
          meta: { version: '0.3.0' },
        }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await loadRemoteRegistry();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('https://docs.example.com/v0.3/registry.json');

    expect(getDocTarget('tutorial', 'remote.only')).toMatchObject({
      file: 'tutorials/remote.md',
    });
    expect(useRegistryStore.getState().meta).toMatchObject({ version: '0.3.0' });

    // cache rewritten with the fresh payload
    const cached = JSON.parse(localStorage.getItem(__CACHE_KEY_FOR_TESTS) ?? '{}');
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
    localStorage.setItem(__CACHE_KEY_FOR_TESTS, JSON.stringify(cached));

    vi.stubEnv('VITE_DOCS_BASE_URL', 'https://docs.example.com/v0.3');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await loadRemoteRegistry();

    expect(getDocTarget('tutorial', 'cached.survives')).toMatchObject({
      file: 'tutorials/cached.md',
    });
    expect(useRegistryStore.getState().remoteAttempted).toBe(true);
  });

  it('is idempotent — repeated calls reuse the in-flight promise', async () => {
    vi.stubEnv('VITE_DOCS_BASE_URL', 'https://docs.example.com/v0.3');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      /** Returns an empty remote registry so repeated loads can share one in-flight request. */
      /** Called by: mocked fetch responses in these tests because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
      json: () => Promise.resolve({ tutorial: {} }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await Promise.all([loadRemoteRegistry(), loadRemoteRegistry(), loadRemoteRegistry()]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
