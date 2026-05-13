/**
 * Thin re-export shim. See `tutorialRegistry.ts` for the design.
 */

import {
  REFERENCE_INDEX_TARGET,
  type BundledReferenceKey,
  type DocTarget,
} from './bundledRegistry';
import { getDocTarget } from './getDocTarget';

export type ReferenceTarget = DocTarget;

export type ReferenceTargetKey = BundledReferenceKey;

export const getReferenceTarget = (key: string): ReferenceTarget | null =>
  getDocTarget('reference', key);

export const referenceIndexTarget: ReferenceTarget = REFERENCE_INDEX_TARGET;
