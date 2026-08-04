import {
  REGISTRY_SCHEMA_VERSION,
  useRegistryStore,
  type PartialRemoteRegistry,
} from './registryStore';
import { getDocsBaseUrl } from '@/config/env';

/**
 * Stale-while-revalidate loader for the remote `registry.json`.
 *
 * Flow on app start:
 *  1. Synchronously read any cached payload from `localStorage` and merge
 *     it into the store, so the first modal open never sees an empty
 *     remote.
 *  2. Kick off a background fetch of the matching minor-tag registry.
 *     On success, replace the merged registry + rewrite the cache. On
 *     failure, leave the cached payload in place and log to debug.
 *
 * Cache keys include the resolved origin and minor tag, so data from another
 * app version cannot shadow the complete bundled fallback.
 */

const CACHE_KEY_PREFIX = 'ldaca.docs.registry.v1';
const cacheKeyFor = (baseUrl: string): string => `${CACHE_KEY_PREFIX}:${baseUrl}`;

interface CachedEnvelope {
  schemaVersion: number;
  fetchedAt: number;
  payload: PartialRemoteRegistry;
}

/**
 * Validates only the loose shape the frontend needs before merging remote docs
 * data. Called by readCache and fetchRegistry before either payload reaches the
 * registry store.
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
/** Called by loadRemoteRegistry during its synchronous startup hydration. */
const readCache = (cacheKey: string): PartialRemoteRegistry | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey);
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
/** Called by loadRemoteRegistry after a validated network refresh succeeds. */
const writeCache = (cacheKey: string, payload: PartialRemoteRegistry): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    const envelope: CachedEnvelope = {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      fetchedAt: Date.now(),
      payload,
    };
    localStorage.setItem(cacheKey, JSON.stringify(envelope));
  } catch {
    // Quota / serialization issues are non-fatal — bundled fallback
    // covers correctness, the cache is purely a startup-latency win.
  }
};

/**
 * Fetches the remote registry without throwing so bundled docs remain the
 * correctness fallback. Called by loadRemoteRegistry's background refresh.
 * Flow: resolve `registry.json` against the remote base URL, fetch without cache, validate the loose registry shape, and return null on any failure.
 */
const fetchRegistry = async (baseUrl: string): Promise<PartialRemoteRegistry | null> => {
  try {
    const url = new URL(
      'registry.json',
      baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    ).toString();
    const resp = await fetch(url, { cache: 'no-store' });
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
 * Used by: src/App.tsx, src/tutorials/__tests__/registry.test.ts.
 * Flow: apply a valid cached payload synchronously, then fetch, validate,
 * apply, and cache the remote registry when a docs base URL is configured.
 */
export const loadRemoteRegistry = (): Promise<void> => {
  if (loadPromise) return loadPromise;

  const baseUrl = getDocsBaseUrl();

  if (!baseUrl) {
    loadPromise = Promise.resolve();
    return loadPromise;
  }

  const cacheKey = cacheKeyFor(baseUrl);
  const cached = readCache(cacheKey);
  if (cached) useRegistryStore.getState().applyRemote(cached);

  loadPromise = (async () => {
    const fresh = await fetchRegistry(baseUrl);
    if (fresh) {
      useRegistryStore.getState().applyRemote(fresh);
      writeCache(cacheKey, fresh);
    }
  })();

  return loadPromise;
};

/** Test-only hook to drop the cached load promise so a fresh test gets a
 *  fresh remote attempt. Not exported through any barrel. */
/** Used by: src/tutorials/__tests__/registry.test.ts. */
export const __resetLoadPromiseForTests = (): void => {
  loadPromise = null;
};

export const __cacheKeyForTests = cacheKeyFor;
