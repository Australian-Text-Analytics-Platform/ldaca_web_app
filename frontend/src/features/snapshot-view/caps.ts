/**
 * Size-discipline caps and eligibility helpers, keyed by snapshot mode.
 *
 * Adding a new mode means adding one entry to ``SNAPSHOT_CAPS`` — no
 * inline numbers scattered across capture/load code.
 *
 * Demo mode's source-row cap is **per-block**, not summed: a snapshot
 * is eligible as long as no single selected source node exceeds the
 * cap. This lets users run a multi-block demo (e.g. comparing two
 * 1 100-row corpora) without losing the "this is teaching-sized data"
 * intent. See ``docs/snapshot-view/plan.md`` §4.
 */
import type { SnapshotMode } from './types';

export interface SnapshotCaps {
  /** Maximum rows in **any single** selected source node. ``null`` =
   * no source-row cap. Demo mode caps at 2 000 per block (multi-block
   * captures are OK as long as each block is teaching-sized).
   *
   * Demo mode uses this as a *capture eligibility gate*: if any
   * selected block exceeds the cap, the "Save view" button refuses
   * to capture and suggests the (future) share mode instead. This
   * is independent of whether source rows are actually shipped in
   * the bundle. */
  maxSourceRowsPerBlock: number | null;
  /** Hard cap on result rows in the bundle — refuse capture if
   * exceeded. ~80 MB parquet at 500k concordance rows, the practical
   * browser-handling upper bound. */
  maxResultRows: number;
  /** Soft warn threshold: prompt the user to confirm at capture if
   * the result exceeds this. */
  softWarnResultRows: number;
  /** Share-mode only soft warns; ignored in demo mode. */
  softWarnSourceRowsPerBlock?: number;
  softWarnBundleBytes?: number;
}

export const SNAPSHOT_CAPS: Record<SnapshotMode, SnapshotCaps> = {
  demo: {
    maxSourceRowsPerBlock: 2_000,
    maxResultRows: 500_000,
    softWarnResultRows: 50_000,
  },
  share: {
    maxSourceRowsPerBlock: null,
    maxResultRows: 500_000,
    softWarnResultRows: 50_000,
    softWarnSourceRowsPerBlock: 50_000,
    softWarnBundleBytes: 100_000_000,
  },
};

export interface EligibilityInput {
  mode: SnapshotMode;
  /** Row count for each selected source node. The eligibility check
   * rejects when *any* entry exceeds the per-block cap (demo mode)
   * or warns when any exceeds the soft threshold (share mode). */
  perBlockSourceRows: number[];
  resultRows: number;
}

export type EligibilityResult =
  | { ok: true; warnings: SnapshotWarning[] }
  | { ok: false; reason: SnapshotIneligibilityReason };

export type SnapshotWarning =
  | { kind: 'large-result'; rows: number; threshold: number }
  | { kind: 'large-source-block'; rows: number; threshold: number };

export type SnapshotIneligibilityReason =
  | {
      kind: 'block-too-large-for-demo';
      /** Row count of the offending block (the largest one). */
      rows: number;
      cap: number;
    }
  | { kind: 'result-too-large'; rows: number; cap: number };

/** Decide whether a capture is allowed for ``mode`` given the per-
 * block source sizes and the result-row count. Returns ``ok: false``
 * for hard caps and ``warnings`` for soft thresholds (UI prompts the
 * user to confirm). */
export function checkSnapshotEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const caps = SNAPSHOT_CAPS[input.mode];
  const largestBlock = input.perBlockSourceRows.reduce(
    (max, n) => (Number.isFinite(n) && n > max ? n : max),
    0,
  );

  if (
    caps.maxSourceRowsPerBlock !== null &&
    largestBlock > caps.maxSourceRowsPerBlock
  ) {
    return {
      ok: false,
      reason: {
        kind: 'block-too-large-for-demo',
        rows: largestBlock,
        cap: caps.maxSourceRowsPerBlock,
      },
    };
  }
  if (input.resultRows > caps.maxResultRows) {
    return {
      ok: false,
      reason: {
        kind: 'result-too-large',
        rows: input.resultRows,
        cap: caps.maxResultRows,
      },
    };
  }

  const warnings: SnapshotWarning[] = [];
  if (input.resultRows > caps.softWarnResultRows) {
    warnings.push({
      kind: 'large-result',
      rows: input.resultRows,
      threshold: caps.softWarnResultRows,
    });
  }
  if (
    caps.softWarnSourceRowsPerBlock !== undefined &&
    largestBlock > caps.softWarnSourceRowsPerBlock
  ) {
    warnings.push({
      kind: 'large-source-block',
      rows: largestBlock,
      threshold: caps.softWarnSourceRowsPerBlock,
    });
  }
  return { ok: true, warnings };
}
