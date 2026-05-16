import { describe, expect, it } from 'vitest';
import { SNAPSHOT_CAPS, checkSnapshotEligibility } from '../caps';

describe('SNAPSHOT_CAPS', () => {
  it('demo has a 2000 per-block source-row hard cap', () => {
    expect(SNAPSHOT_CAPS.demo.maxSourceRowsPerBlock).toBe(2_000);
  });

  it('share has no per-block source-row hard cap', () => {
    expect(SNAPSHOT_CAPS.share.maxSourceRowsPerBlock).toBeNull();
  });

  it('both modes share the 500k result-row cap', () => {
    expect(SNAPSHOT_CAPS.demo.maxResultRows).toBe(500_000);
    expect(SNAPSHOT_CAPS.share.maxResultRows).toBe(500_000);
  });
});

describe('checkSnapshotEligibility — demo (per-block rule)', () => {
  it('accepts a single small block', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      perBlockSourceRows: [500],
      resultRows: 1_000,
    });
    expect(result).toEqual({ ok: true, warnings: [] });
  });

  it('accepts MULTIPLE small blocks whose sum exceeds the cap (the new rule)', () => {
    // Two 1 100-row blocks (sum 2 200) would have failed the old
    // "total" rule; under the per-block rule each is under 2 000
    // so the capture is fine.
    const result = checkSnapshotEligibility({
      mode: 'demo',
      perBlockSourceRows: [1_100, 1_100],
      resultRows: 1_000,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when ANY block exceeds the cap, reporting the largest block', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      perBlockSourceRows: [500, 2_500, 1_000],
      resultRows: 1_000,
    });
    expect(result).toEqual({
      ok: false,
      reason: { kind: 'block-too-large-for-demo', rows: 2_500, cap: 2_000 },
    });
  });

  it('accepts exactly at the per-block cap', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      perBlockSourceRows: [2_000, 2_000],
      resultRows: 100,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an empty selection (no blocks)', () => {
    // Edge case: no blocks selected yet. Eligibility is technically
    // OK at this stage; downstream checks (no completed task) will
    // catch the actual save attempt.
    const result = checkSnapshotEligibility({
      mode: 'demo',
      perBlockSourceRows: [],
      resultRows: 0,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when result exceeds the hard cap', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      perBlockSourceRows: [100],
      resultRows: 600_000,
    });
    expect(result).toEqual({
      ok: false,
      reason: { kind: 'result-too-large', rows: 600_000, cap: 500_000 },
    });
  });

  it('warns on large result without rejecting', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      perBlockSourceRows: [500],
      resultRows: 75_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContainEqual({
        kind: 'large-result',
        rows: 75_000,
        threshold: 50_000,
      });
    }
  });

  it('per-block rejection takes precedence over result rejection', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      perBlockSourceRows: [3_000],
      resultRows: 600_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('block-too-large-for-demo');
    }
  });
});

describe('checkSnapshotEligibility — share', () => {
  it('accepts large per-block source rows that demo would reject', () => {
    const result = checkSnapshotEligibility({
      mode: 'share',
      perBlockSourceRows: [100_000, 50_000],
      resultRows: 1_000,
    });
    expect(result.ok).toBe(true);
  });

  it('emits a large-source-block warning over the soft threshold', () => {
    const result = checkSnapshotEligibility({
      mode: 'share',
      perBlockSourceRows: [60_000],
      resultRows: 1_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContainEqual({
        kind: 'large-source-block',
        rows: 60_000,
        threshold: 50_000,
      });
    }
  });

  it('still rejects when result exceeds the shared hard cap', () => {
    const result = checkSnapshotEligibility({
      mode: 'share',
      perBlockSourceRows: [100],
      resultRows: 600_000,
    });
    expect(result.ok).toBe(false);
  });
});
