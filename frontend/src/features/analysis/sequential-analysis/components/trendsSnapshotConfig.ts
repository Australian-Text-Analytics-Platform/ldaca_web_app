/**
 * Runtime constants and types for the Trends snapshot-capture dialog.
 *
 * Lives in its own file (not inside TrendsSnapshotConfigDialog) so the
 * dialog itself can satisfy react-refresh/only-export-components — that
 * rule fires whenever a component file exports non-component values
 * alongside the component, which would otherwise break Fast Refresh.
 */
import type { SequentialFrequency } from '@/api/text';

export const SNAPSHOT_ROW_HARD_CAP = 200_000;
export const SNAPSHOT_ROW_SOFT_WARN = 100_000;

/** The frequencies the snapshot capture dialog exposes — all presets
 * except ``custom``. The viewer's coarsening pass uses this same
 * ordered list: a snapshot captured at ``daily`` can be re-aggregated
 * to ``weekly`` / ``monthly`` / etc., but not to ``hourly``. */
export type SnapshotFinestFrequency = Exclude<SequentialFrequency, 'custom'>;

export interface TrendsSnapshotConfig {
  /** Captured finest time bin (datetime path). Ignored when
   * ``columnType === 'numeric'``. */
  finestFrequency: SnapshotFinestFrequency;
  /** Captured columns the viewer can group by. 0-3 entries. */
  groupByColumns: string[];
  /** Captured numeric bin size (numeric path). Ignored when
   * ``columnType === 'datetime'``. Defaults to 1; user can override. */
  numericInterval: number;
  /** Captured numeric origin (numeric path, optional). ``null`` =
   * backend auto-detects from the data minimum. */
  numericOrigin: number | null;
}

export const DEFAULT_TRENDS_SNAPSHOT_CONFIG: TrendsSnapshotConfig = {
  finestFrequency: 'daily',
  groupByColumns: [],
  numericInterval: 1,
  numericOrigin: null,
};
