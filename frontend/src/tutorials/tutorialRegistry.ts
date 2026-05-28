/**
 * Thin re-export shim. The runtime data has moved to `bundledRegistry.ts`
 * (which merges with any remote payload via `registryStore.ts`); this
 * file exists so existing import paths and the `TutorialTargetKey`
 * literal-union continue to compile.
 */

import { TUTORIAL_INDEX_TARGET, type BundledTutorialKey, type DocTarget } from './bundledRegistry';
import { getDocTarget } from './getDocTarget';

export type TutorialTarget = DocTarget;

/**
 * String-literal union of all bundled tutorial-target keys. Use this as
 * the `targetKey` prop type on `<HelpIcon>` so typos against bundled
 * keys become compile errors.
 *
 * Keys served only by the remote registry (none today — the bundle
 * still mirrors the full set) won't appear in this union. They still
 * resolve at runtime via `getTutorialTarget` because the registry store
 * merges remote over bundled.
 */
export type TutorialTargetKey = BundledTutorialKey;

/** Resolves tutorial help links for HelpIcon and modal callers. */
/** Used by: src/components/help/DocLinkIcon.tsx, src/features/hints/HintsController.tsx because docs consumers need one registry path for bundled, cached, and remote documentation targets. */
export const getTutorialTarget = (key: string): TutorialTarget | null =>
  getDocTarget('tutorial', key);

/** Tutorial index target used by global docs navigation. */
export const tutorialIndexTarget: TutorialTarget = TUTORIAL_INDEX_TARGET;
