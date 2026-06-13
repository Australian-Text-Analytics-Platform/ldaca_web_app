import { create } from 'zustand';

import { BUNDLED_REGISTRY, type DocTarget, type RegistryShape } from './bundledRegistry';

/**
 * Active doc-target registry: bundled fallback shadowed by any remote
 * payload that has been merged in. Components don't read this directly —
 * the `getDocTarget(kind, key)` helper is the public surface.
 *
 * Why a Zustand store: a static module-level variable would also work,
 * but the store gives modal hosts a subscription path so they can repaint
 * if the remote registry arrives *while* the modal is open (rare but
 * cheap to support).
 */

const REGISTRY_SCHEMA_VERSION = 1 as const;

type RegistryMeta = NonNullable<RegistryShape['meta']>;

interface State {
  registry: RegistryShape;
  meta: RegistryMeta | null;
  /** ms-since-epoch of last successful remote fetch. null = never. */
  lastFetchedAt: number | null;
  /** Set to true once the first remote refresh attempt has completed
   *  (success OR failure). Used to gate "stale registry" UI. */
  remoteAttempted: boolean;
}

interface Actions {
  /**
   * Merge a freshly-fetched remote registry over the bundled fallback.
   * Pass `null` to mark remote-attempted without changing the merged
   * registry (e.g. on fetch failure when no cached payload exists).
   */
  applyRemote: (payload: PartialRemoteRegistry | null) => void;
}

/** Shape we accept from the wire. Every section is optional so newer apps
 *  can read older docs JSON without breaking. */
export interface PartialRemoteRegistry {
  tutorial?: Record<string, DocTarget>;
  info?: Record<string, DocTarget>;
  reference?: Record<string, DocTarget>;
  meta?: RegistryMeta;
}

/** Overlays remote doc targets on top of the bundled fallback while preserving offline entries. */
/** Used by: useRegistryStore in the tutorials module because docs consumers need one registry path for bundled, cached, and remote documentation targets. */
const mergeBundledWithRemote = (remote: PartialRemoteRegistry | null): RegistryShape => ({
  tutorial: { ...BUNDLED_REGISTRY.tutorial, ...(remote?.tutorial ?? {}) },
  info: { ...BUNDLED_REGISTRY.info, ...(remote?.info ?? {}) },
  reference: { ...BUNDLED_REGISTRY.reference, ...(remote?.reference ?? {}) },
  meta: remote?.meta,
});

export const useRegistryStore = create<State & Actions>((set) => ({
  registry: mergeBundledWithRemote(null),
  meta: null,
  lastFetchedAt: null,
  remoteAttempted: false,
  /**
   * Applies remote docs data once per load attempt so modal consumers can repaint if needed.
   * Why: documentation consumers need one registry path for bundled, cached, and remote content.
   */
  applyRemote: (payload) =>
    { set(() => ({
      registry: mergeBundledWithRemote(payload),
      meta: payload?.meta ?? null,
      lastFetchedAt: payload ? Date.now() : null,
      remoteAttempted: true,
    })); },
}));

export { REGISTRY_SCHEMA_VERSION };
