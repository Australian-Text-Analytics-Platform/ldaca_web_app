import { create } from 'zustand';

import { BUNDLED_REGISTRY, type DocTarget, type RegistryShape } from './bundledRegistry';

/**
 * Active doc-target registry: bundled fallback shadowed by any remote
 * payload that has been merged in. Components don't read this directly —
 * `getDocumentTarget(kind, key)` is the public read surface.
 *
 * Zustand gives the EOL banner a metadata subscription while lookup callers
 * read the merged registry synchronously at interaction time.
 */

const REGISTRY_SCHEMA_VERSION = 1 as const;

type RegistryMeta = NonNullable<RegistryShape['meta']>;

interface State {
  registry: RegistryShape;
  meta: RegistryMeta | null;
}

interface Actions {
  /**
   * Merge remote documentation over the bundled offline fallback. `null`
   * restores the bundled-only registry.
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

/** Overlays remote targets on the full bundled offline fallback. */
const mergeBundledWithRemote = (remote: PartialRemoteRegistry | null): RegistryShape => ({
  tutorial: { ...BUNDLED_REGISTRY.tutorial, ...(remote?.tutorial ?? {}) },
  info: { ...BUNDLED_REGISTRY.info, ...(remote?.info ?? {}) },
  reference: { ...BUNDLED_REGISTRY.reference, ...(remote?.reference ?? {}) },
  meta: remote?.meta,
});

export const useRegistryStore = create<State & Actions>((set) => ({
  registry: mergeBundledWithRemote(null),
  meta: null,
  /** Applies cache/network payloads for lookup and EOL metadata consumers. */
  applyRemote: (payload) => {
    set(() => ({
      registry: mergeBundledWithRemote(payload),
      meta: payload?.meta ?? null,
    }));
  },
}));

export { REGISTRY_SCHEMA_VERSION };
