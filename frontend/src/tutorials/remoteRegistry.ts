import {
  REGISTRY_SCHEMA_VERSION,
  useRegistryStore,
  type PartialRemoteRegistry,
} from './registryStore';

/**
 * Stale-while-revalidate loader for the remote `registry.json`.
 *
 * Flow on app start:
 *  1. Synchronously read any cached payload from `localStorage` and merge
 *     it into the store, so the first modal open never sees an empty
 *     remote.
 *  2. Kick off a background `fetch` of `${VITE_DOCS_BASE_URL}/registry.json`.
 *     On success, replace the merged registry + rewrite the cache. On
 *     failure, leave the cached payload in place and log to debug.
 *
 * Skips both steps if `VITE_DOCS_BASE_URL` is empty / unset — that's the
 * "bundled-only build" mode used in offline dev and on pre-3.10B
 * releases.
 */

const CACHE_KEY = 'ldaca.docs.registry.v1';

type CachedEnvelope = {
  schemaVersion: number;
  fetchedAt: number;
  payload: PartialRemoteRegistry;
};

/** Validates only the loose shape the frontend needs before merging remote docs data. */
/**
 * Called by: tutorial registry hydration and docs modal consumers because docs consumers need one registry path for bundled, cached, and remote documentation targets.
 * Flow: validate registry input, merge local and remote metadata, then expose the documentation entries to UI consumers.
 */
const isPartialRegistry = (value: unknown): value is PartialRemoteRegistry => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const sectionsOk = (['tutorial', 'info', 'reference'] as const).every(
    (k) => v[k] === undefined || (typeof v[k] === 'object' && v[k] !== null),
  );
  if (!sectionsOk) return false;
  if (v.meta !== undefined && (typeof v.meta !== 'object' || v.meta === null)) return false;
  return true;
};

/** Restores a cached registry payload so docs links work before the network refresh finishes. */
/** Called by: tutorial registry hydration and docs modal consumers because docs consumers need one registry path for bundled, cached, and remote documentation targets. */
const readCache = (): PartialRemoteRegistry | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedEnvelope>;
    if (parsed.schemaVersion !== REGISTRY_SCHEMA_VERSION) return null;
    if (!isPartialRegistry(parsed.payload)) return null;
    return parsed.payload;
  } catch {
    return null;
  }
};

/** Stores the last successful remote registry as a startup-latency optimization. */
/** Called by: tutorial registry hydration and docs modal consumers because docs consumers need one registry path for bundled, cached, and remote documentation targets. */
const writeCache = (payload: PartialRemoteRegistry): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    const envelope: CachedEnvelope = {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      fetchedAt: Date.now(),
      payload,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Quota / serialization issues are non-fatal — bundled fallback
    // covers correctness, the cache is purely a startup-latency win.
  }
};

/** Fetches the remote registry without throwing so bundled docs remain the correctness fallback. */
/**
 * Called by: tutorial registry hydration and docs modal consumers because docs consumers need one registry path for bundled, cached, and remote documentation targets.
 * Flow: resolve `registry.json` against the remote base URL, fetch without cache, validate the loose registry shape, and return null on any failure.
 */
const fetchRegistry = async (baseUrl: string): Promise<PartialRemoteRegistry | null> => {
  try {
    const url = new URL('registry.json', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) return null;
    const json = (await resp.json()) as unknown;
    return isPartialRegistry(json) ? json : null;
  } catch {
    return null;
  }
};

let loadPromise: Promise<void> | null = null;

/**
 * Hydrate the registry store from cache (synchronously, before this
 * function's async work begins) and kick off a background refresh.
 * Idempotent — safe to call from multiple useEffects; subsequent calls
 * return the same in-flight (or settled) promise.
 */
/**
 * Used by: src/App.tsx, src/tutorials/__tests__/registry.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: validate registry input, merge local and remote metadata, then expose the documentation entries to UI consumers.
 */
export const loadRemoteRegistry = (): Promise<void> => {
  if (loadPromise) return loadPromise;

  const baseUrl = import.meta.env.VITE_DOCS_BASE_URL?.trim() ?? '';

  // Synchronous cache hydration happens regardless of base URL: a
  // previously-deployed cache from a different build of this app should
  // still apply.
  const cached = readCache();
  if (cached) {
    useRegistryStore.getState().applyRemote(cached);
  }

  if (!baseUrl) {
    // No remote configured — flag remote-attempted so any "still
    // loading" UI gates resolve, and return.
    if (!cached) useRegistryStore.getState().applyRemote(null);
    loadPromise = Promise.resolve();
    return loadPromise;
  }

  loadPromise = (async () => {
    const fresh = await fetchRegistry(baseUrl);
    if (fresh) {
      useRegistryStore.getState().applyRemote(fresh);
      writeCache(fresh);
    } else if (!cached) {
      // Mark attempted so UI can settle even when fetch failed.
      useRegistryStore.getState().applyRemote(null);
    }
  })();

  return loadPromise;
};

/** Test-only hook to drop the cached load promise so a fresh test gets a
 *  fresh remote attempt. Not exported through any barrel. */
/** Used by: src/tutorials/__tests__/registry.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export const __resetLoadPromiseForTests = (): void => {
  loadPromise = null;
};

export const __CACHE_KEY_FOR_TESTS = CACHE_KEY;
