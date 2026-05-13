/**
 * Thin re-export shim. See `tutorialRegistry.ts` for the design.
 */

import {
  INFO_INDEX_TARGET,
  type BundledInfoKey,
  type DocTarget,
} from './bundledRegistry';
import { getDocTarget } from './getDocTarget';

export type InfoTarget = DocTarget;

export type InfoTargetKey = BundledInfoKey;

export const getInfoTarget = (key: string): InfoTarget | null =>
  getDocTarget('info', key);

export const infoIndexTarget: InfoTarget = INFO_INDEX_TARGET;
