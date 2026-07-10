import {
  BUNDLED_FILES,
  TUTORIAL_INDEX_TARGET,
  type BundledInfoKey,
  type BundledReferenceKey,
  type BundledTutorialKey,
  type DocLinkKind,
  type DocTarget as RegistryTarget,
} from './bundledRegistry';
import { useRegistryStore } from './registryStore';

/** Bundled keys remain autocomplete-safe while remote registries may add keys. */
export type DocumentKey<Kind extends DocLinkKind> =
  | (Kind extends 'tutorial'
      ? BundledTutorialKey
      : Kind extends 'info'
        ? BundledInfoKey
        : BundledReferenceKey)
  | (string & {});

/**
 * Canonical target passed from registry lookup through UI intent to the
 * document viewer. Keeping kind and key with the resolved location removes
 * parallel modal/type contracts while preserving remote-only entries.
 */
export interface DocumentTarget<Kind extends DocLinkKind = DocLinkKind> {
  kind: Kind;
  key: string;
  file: string;
  anchor: string;
  label?: string;
}

/**
 * Resolves one bundled, cached, or remote document entry into the canonical
 * target consumed by icons, hints, the UI store, and `DocumentModalHost`.
 */
export function getDocumentTarget<Kind extends DocLinkKind>(
  kind: Kind,
  key: DocumentKey<Kind>,
): DocumentTarget<Kind> | null {
  const section: Partial<Record<string, RegistryTarget>> =
    useRegistryStore.getState().registry[kind];
  const target = section[key];
  return target ? { kind, key, ...target } : null;
}

/** Tutorial index target used by the sidebar's generic documentation button. */
export const tutorialIndexTarget: DocumentTarget<'tutorial'> = {
  kind: 'tutorial',
  key: 'index',
  ...TUTORIAL_INDEX_TARGET,
};

/** Local files that must never be redirected to the optional remote docs host. */
export const BUNDLED_DOCUMENT_FILES: ReadonlySet<string> = new Set([
  ...BUNDLED_FILES,
  tutorialIndexTarget.file,
]);

export type { DocLinkKind };
