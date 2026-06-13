import type { DocLinkKind, DocTarget } from './bundledRegistry';
import { useRegistryStore } from './registryStore';

/**
 * Unified accessor for the merged (bundled + remote) registry. Returns
 * `null` if the kind/key pair has no entry in either source.
 *
 * The three existing wrappers in `{tutorial,info,reference}Registry.ts`
 * route through this helper so callers (and existing test mocks) keep
 * the same import surface.
 */
/** Used by: src/tutorials/__tests__/registry.test.ts, src/tutorials/infoRegistry.ts, src/tutorials/referenceRegistry.ts and 1 other importers because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export const getDocTarget = (kind: DocLinkKind, key: string): DocTarget | null => {
  const section = useRegistryStore.getState().registry[kind];
  return section[key] ?? null;
};

export type { DocLinkKind, DocTarget };
