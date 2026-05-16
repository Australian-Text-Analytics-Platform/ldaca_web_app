/**
 * Snapshot View barrel. Consumers import from
 * ``@/features/snapshot-view`` rather than the individual files.
 */
export type {
  LoadedSnapshot,
  SnapshotCapabilities,
  SnapshotManifest,
  SnapshotMode,
  SnapshotPayloadEntry,
  SnapshotToolKey,
  SourceProjectionTable,
  ViewMode,
} from './types';

export { DEMO_SNAPSHOT_MODE, LIVE_MODE, isShareSnapshotMode, isSnapshotMode } from './mode';

export {
  SNAPSHOT_CAPS,
  checkSnapshotEligibility,
  type EligibilityInput,
  type EligibilityResult,
  type SnapshotCaps,
  type SnapshotIneligibilityReason,
  type SnapshotWarning,
} from './caps';

export { useSnapshotViewStore } from './store';
