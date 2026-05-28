/**
 * Snapshot View — type definitions.
 *
 * See ``docs/snapshot-view/plan.md`` for the design. Two modes ship:
 * Mode 1 (demo) in v1, Mode 2a (share) as forward-compat hooks only.
 *
 * Naming: this feature uses ``snapshotView`` / ``viewMode`` to avoid
 * collision with ``useAnalysisLockMachine``'s pre-existing
 * ``lockedNodesSnapshot`` symbols, which freeze locked-node state at
 * Run time and are unrelated to view snapshots.
 */
import type {
  SnapshotManifest as GeneratedSnapshotManifest,
  SnapshotPayloadEntryResult,
  SnapshotPayloadEntryDispersionBins,
  SnapshotPayloadEntrySourceProjection,
  SnapshotPayloadEntrySettings,
} from '@/api/generated/types.gen';

export type SnapshotManifest = GeneratedSnapshotManifest;

/** Tool key used in manifest and store slices. Mirrors the backend's
 * canonical task type strings so manifests speak the same language as
 * task records. */
export type SnapshotToolKey = SnapshotManifest['tool'];

/** Snapshot bundle mode. ``demo`` is Mode 1 (v1). ``share`` is Mode 2a,
 * reserved here so manifests carry the field from day one; v1 never
 * emits a ``share`` bundle. */
export type SnapshotMode = 'demo' | 'share';

/** Active mode for one tool's view. Discriminated union so exhaustive
 * ``switch`` lights up every branch site when a new arm is added. */
export type ViewMode =
  | { kind: 'live' }
  | { kind: 'demoSnapshot' }
  | { kind: 'shareSnapshot' };

/** Capability flags carried on every loaded snapshot. Components must
 * read these instead of pattern-matching on the mode string. This is
 * the central hook that makes Mode 2a a flip-the-bits exercise rather
 * than a sweep across every ``if`` site. */
export type SnapshotCapabilities = SnapshotManifest['capabilities'];

/** Typed payload entry in the manifest's ``payloads`` array. New kinds
 * are added without bumping ``schema_version`` — loaders dispatch by
 * ``kind`` and ignore unknowns with a console warn. */
export type SnapshotPayloadEntry =
  | SnapshotPayloadEntryResult
  | SnapshotPayloadEntryDispersionBins
  | SnapshotPayloadEntrySourceProjection
  | SnapshotPayloadEntrySettings;

/** Per-tool preview block. Discriminated by ``tool``
 * so adding a new analytic tool means adding one arm here plus a
 * corresponding ``formatPreview()`` entry — the load dialog
 * inherits support automatically. */
export type SnapshotPreview = SnapshotManifest['preview'];

/** A snapshot loaded into the store. The payload shape is per-tool and
 * filled in by each tool's capture/load code; it defaults to ``unknown``
 * so the store type does not force concrete payload shapes. */
export interface LoadedSnapshot<Payload = unknown> {
  manifest: SnapshotManifest;
  capabilities: SnapshotCapabilities;
  payload: Payload;
  /** Share-mode only. ``null`` on demo bundles. */
  sourceProjection: SourceProjectionTable | null;
}

/** Share-mode column-projected source rows. Stubbed here — the
 * concrete decoded-parquet shape lands when Mode 2a is implemented.
 * Recipient-side code that touches this must gate on
 * ``capabilities.canFilterSourceRows``. */
export interface SourceProjectionTable {
  /** Column names included in the projection. Subset of the source
   * corpus's columns — only those the analysis touched. */
  columns: string[];
  /** Total row count across the merged per-node projections. */
  rowCount: number;
  /** Implementation-specific row accessor handle; opaque to
   * downstream code so we can swap the decoder later. */
  readonly handle: unknown;
}
