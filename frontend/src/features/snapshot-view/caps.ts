/**
 * Size-discipline caps and eligibility helpers, keyed by snapshot mode.
 *
 * Adding a new mode means adding one entry to ``SNAPSHOT_CAPS`` — no
 * inline numbers scattered across capture/load code.
 */
import type { SnapshotMode } from './types';

export interface SnapshotCaps {
  /** Maximum sum of rows across selected/processed source nodes.
   * ``null`` = no source-row cap.
   *
   * Demo mode uses this as a *capture eligibility gate*: if the source
   * exceeds 2 000 rows, the "Save view" button refuses to capture and
   * suggests the (future) share mode instead. This is independent of
   * whether source rows are actually shipped in the bundle. */
  maxSourceRows: number | null;
  /** Hard cap on result rows in the bundle — refuse capture if
   * exceeded. ~80 MB parquet at 500k concordance rows, the practical
   * browser-handling upper bound. */
  maxResultRows: number;
  /** Soft warn threshold: prompt the user to confirm at capture if
   * the result exceeds this. */
  softWarnResultRows: number;
  /** Share-mode only soft warns; ignored in demo mode. */
  softWarnSourceRows?: number;
  softWarnBundleBytes?: number;
}

export const SNAPSHOT_CAPS: Record<SnapshotMode, SnapshotCaps> = {
  demo: {
    maxSourceRows: 2_000,
    maxResultRows: 500_000,
    softWarnResultRows: 50_000,
  },
  share: {
    maxSourceRows: null,
    maxResultRows: 500_000,
    softWarnResultRows: 50_000,
    softWarnSourceRows: 50_000,
    softWarnBundleBytes: 100_000_000,
  },
};

export interface EligibilityInput {
  mode: SnapshotMode;
  totalSourceRows: number;
  resultRows: number;
}

export type EligibilityResult =
  | { ok: true; warnings: SnapshotWarning[] }
  | { ok: false; reason: SnapshotIneligibilityReason };

export type SnapshotWarning =
  | { kind: 'large-result'; rows: number; threshold: number }
  | { kind: 'large-source'; rows: number; threshold: number };

export type SnapshotIneligibilityReason =
  | { kind: 'source-too-large-for-demo'; rows: number; cap: number }
  | { kind: 'result-too-large'; rows: number; cap: number };

/** Decide whether a capture is allowed for ``mode`` given the source
 * and result sizes. Returns ``ok: false`` for hard caps and ``warnings``
 * for soft thresholds (UI prompts the user to confirm). */
export function checkSnapshotEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const caps = SNAPSHOT_CAPS[input.mode];

  if (caps.maxSourceRows !== null && input.totalSourceRows > caps.maxSourceRows) {
    return {
      ok: false,
      reason: {
        kind: 'source-too-large-for-demo',
        rows: input.totalSourceRows,
        cap: caps.maxSourceRows,
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
    caps.softWarnSourceRows !== undefined &&
    input.totalSourceRows > caps.softWarnSourceRows
  ) {
    warnings.push({
      kind: 'large-source',
      rows: input.totalSourceRows,
      threshold: caps.softWarnSourceRows,
    });
  }
  return { ok: true, warnings };
}
