/**
 * Thin re-export shim. See `tutorialRegistry.ts` for the design.
 */

import { type BundledReferenceKey, type DocTarget } from './bundledRegistry';
import { getDocTarget } from './getDocTarget';

export type ReferenceTarget = DocTarget;

export type ReferenceTargetKey = BundledReferenceKey;

/** Resolves reference-page links for HelpIcon and modal callers. */
/** Used by: src/components/help/DocLinkIcon.tsx because docs consumers need one registry path for bundled, cached, and remote documentation targets. */
export const getReferenceTarget = (key: string): ReferenceTarget | null =>
  getDocTarget('reference', key);
