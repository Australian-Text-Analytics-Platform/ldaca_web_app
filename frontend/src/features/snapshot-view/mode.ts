/**
 * View-mode helpers. Centralising these keeps every guard site
 * consistent and makes adding a future mode arm a single-file change.
 */
import type { ViewMode } from './types';

/** Narrow types preserved so callers passing these constants into
 * APIs that require a specific arm (e.g. ``loadSnapshot``) don't have
 * to re-narrow. */
export const LIVE_MODE = { kind: 'live' } as const satisfies ViewMode;
export const DEMO_SNAPSHOT_MODE = { kind: 'demoSnapshot' } as const satisfies ViewMode;

/** True if the view is showing a snapshot (either demo or share).
 * Use this everywhere a component or handler needs to "disable
 * mutation paths" — never compare ``mode.kind`` to a string inline.  * Used by: useSnapshotBackedAnalysisState module, index module, ConcordanceFeature module (rg call sites/imports).
 */
export function isSnapshotMode(mode: ViewMode): boolean {
  return mode.kind === 'demoSnapshot' || mode.kind === 'shareSnapshot';
}

/** True if the view is showing a share-mode snapshot specifically.
 * Used by source-row inspector components that don't exist in demo
 * mode. Always false in v1 because no code constructs the
 * ``shareSnapshot`` arm yet — but UI gates check it anyway so when
 * Mode 2a lands no guard site needs editing.  * Used by: index module, store tests (rg call sites/imports).
 */
export function isShareSnapshotMode(mode: ViewMode): boolean {
  return mode.kind === 'shareSnapshot';
}
