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
import type { CanonicalAnalysisTaskType } from '@/features/analysis/common/tasks/types';

/** Tool key used in manifest and store slices. Mirrors the backend's
 * canonical task type strings so manifests speak the same language as
 * task records. */
export type SnapshotToolKey = CanonicalAnalysisTaskType;

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
export interface SnapshotCapabilities {
  /** Result-table pagination — always true on a loaded snapshot. */
  canPaginate: boolean;
  /** Sort / filter the result table client-side. Always true. */
  canSortAndFilterResult: boolean;
  /** Export the (snapshot's) result as CSV/parquet. Always true. */
  canExport: boolean;
  /** Browse / search source rows. Mode 2a only — false in v1 bundles. */
  canFilterSourceRows: boolean;
  /** Cross-tool jumps (e.g. token-freq → concordance). Reserved for
   * multi-tool snapshots; always false in v1. */
  canCrossJump: boolean;
}

/** Typed payload entry in the manifest's ``payloads`` array. New kinds
 * are added without bumping ``schema_version`` — loaders dispatch by
 * ``kind`` and ignore unknowns with a console warn. */
export type SnapshotPayloadEntry =
  | { kind: 'result'; path: string }
  | { kind: 'dispersion-bins'; path: string }
  | { kind: 'source-projection'; path: string; columns: string[] };

/** Manifest written into ``manifest.json`` inside the bundle zip. */
export interface SnapshotManifest {
  /** Bundle-format version. Bumped on layout changes, not on
   * additive payload kinds. */
  schema_version: 1;
  mode: SnapshotMode;
  tool: SnapshotToolKey;
  /** App version at capture time. For human reference. */
  tool_version: string;
  /** ISO-8601 UTC. */
  captured_at: string;
  /** User-chosen label shown in the snapshot's banner. */
  title: string;
  source: {
    /** UUID at capture time, never re-engaged. */
    workspace_id: string;
    workspace_name: string;
    node_ids: string[];
    node_labels: string[];
    /** Sum of rows across the source nodes at capture. Recorded so
     * loaders can cross-check against the mode's row cap. */
    total_source_rows: number;
  };
  capabilities: SnapshotCapabilities;
  payloads: SnapshotPayloadEntry[];
  /** Frozen node-id → colour map. Captured from ``useNodeColorsStore``
   * at snapshot time; the loader hydrates this into the snapshot's
   * own colour map, never writing back to the live store. */
  node_colors: Record<string, string>;
}

/** A snapshot loaded into the store. The payload shape is per-tool and
 * filled in by each tool's capture/load code in Phase 1+; for now it
 * defaults to ``unknown`` so the store types compile without forcing
 * concrete shapes. */
export interface LoadedSnapshot<Payload = unknown> {
  manifest: SnapshotManifest;
  capabilities: SnapshotCapabilities;
  payload: Payload;
  /** Share-mode only. ``null`` on Mode 1 (demo) bundles. The field is
   * wired in from day one so Mode 2a is "populate this", not "add a
   * new slice property to every tool". */
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
