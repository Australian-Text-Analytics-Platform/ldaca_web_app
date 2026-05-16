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

export { useSnapshotViewStore, useToolSnapshotMode } from './store';

export {
  V1_BUILD_SUPPORT,
  applyBuildCapabilityGating,
  emitManifestJson,
  parseManifest,
  parseManifestJson,
  type BuildSupport,
  type ParseDegradation,
  type ParseError,
  type ParseResult,
} from './manifest';

export {
  MANIFEST_FILE_NAME,
  decodeResultParquet,
  findResultPayload,
  readBundle,
  writeBundle,
  type BundleReadError,
  type BundleReadResult,
  type BundleWriteInput,
  type LoadedBundle,
} from './bundle';

export {
  resolvePagination,
  type PaginationSource,
  type PaginationState,
  type PaginationView,
} from './pagination';

export { useResolvedNodeColor } from './useResolvedNodeColor';

export {
  TOOL_COMPATIBILITY,
  getCurrentAppVersion,
  isCompatibleSnapshot,
  parseMajorMinor,
} from './compat';
