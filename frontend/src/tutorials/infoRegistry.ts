/**
 * Thin re-export shim. See `tutorialRegistry.ts` for the design.
 */

import {
  type BundledInfoKey,
  type DocTarget,
} from './bundledRegistry';
import { getDocTarget } from './getDocTarget';

export type InfoTarget = DocTarget;

export type InfoTargetKey = BundledInfoKey;

/** Resolves information-page links for HelpIcon and modal callers. */
/** Used by: src/components/help/DocLinkIcon.tsx because docs consumers need one registry path for bundled, cached, and remote documentation targets. */
export const getInfoTarget = (key: string): InfoTarget | null =>
  getDocTarget('info', key);
