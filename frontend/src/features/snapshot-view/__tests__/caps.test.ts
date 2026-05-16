import { describe, expect, it } from 'vitest';
import { SNAPSHOT_CAPS, checkSnapshotEligibility } from '../caps';

describe('SNAPSHOT_CAPS', () => {
  it('demo has a 2000 source-row hard cap', () => {
    expect(SNAPSHOT_CAPS.demo.maxSourceRows).toBe(2_000);
  });

  it('share has no source-row hard cap', () => {
    expect(SNAPSHOT_CAPS.share.maxSourceRows).toBeNull();
  });

  it('both modes share the 500k result-row cap', () => {
    expect(SNAPSHOT_CAPS.demo.maxResultRows).toBe(500_000);
    expect(SNAPSHOT_CAPS.share.maxResultRows).toBe(500_000);
  });
});

describe('checkSnapshotEligibility — demo', () => {
  it('accepts a small capture with no warnings', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      totalSourceRows: 500,
      resultRows: 1_000,
    });
    expect(result).toEqual({ ok: true, warnings: [] });
  });

  it('rejects when source exceeds demo cap with a specific reason', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      totalSourceRows: 2_500,
      resultRows: 1_000,
    });
    expect(result).toEqual({
      ok: false,
      reason: {
        kind: 'source-too-large-for-demo',
        rows: 2_500,
        cap: 2_000,
      },
    });
  });

  it('accepts exactly at the demo source cap', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      totalSourceRows: 2_000,
      resultRows: 100,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when result exceeds the hard cap', () => {
    const result = checkSnapshotEligibility({
      mode: 'demo',
      totalSourceRows: 100,
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
      totalSourceRows: 500,
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

  it('source-cap rejection takes precedence over result rejection', () => {
    // Both would fail; source check is first.
    const result = checkSnapshotEligibility({
      mode: 'demo',
      totalSourceRows: 3_000,
      resultRows: 600_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('source-too-large-for-demo');
    }
  });
});

describe('checkSnapshotEligibility — share', () => {
  it('accepts large source rows that demo would reject', () => {
    const result = checkSnapshotEligibility({
      mode: 'share',
      totalSourceRows: 100_000,
      resultRows: 1_000,
    });
    expect(result.ok).toBe(true);
  });

  it('emits a large-source warning over the soft threshold', () => {
    const result = checkSnapshotEligibility({
      mode: 'share',
      totalSourceRows: 60_000,
      resultRows: 1_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContainEqual({
        kind: 'large-source',
        rows: 60_000,
        threshold: 50_000,
      });
    }
  });

  it('still rejects when result exceeds the shared hard cap', () => {
    const result = checkSnapshotEligibility({
      mode: 'share',
      totalSourceRows: 100,
      resultRows: 600_000,
    });
    expect(result.ok).toBe(false);
  });
});
