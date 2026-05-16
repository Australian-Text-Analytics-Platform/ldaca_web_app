import { describe, expect, it } from 'vitest';
import {
  DEMO_SNAPSHOT_MODE,
  LIVE_MODE,
  isShareSnapshotMode,
  isSnapshotMode,
} from '../mode';
import type { ViewMode } from '../types';

const SHARE_SNAPSHOT_MODE: ViewMode = { kind: 'shareSnapshot' };

describe('isSnapshotMode', () => {
  it('returns false for live', () => {
    expect(isSnapshotMode(LIVE_MODE)).toBe(false);
  });

  it('returns true for demo snapshot', () => {
    expect(isSnapshotMode(DEMO_SNAPSHOT_MODE)).toBe(true);
  });

  it('returns true for share snapshot (forward-compat)', () => {
    expect(isSnapshotMode(SHARE_SNAPSHOT_MODE)).toBe(true);
  });
});

describe('isShareSnapshotMode', () => {
  it('returns false for live', () => {
    expect(isShareSnapshotMode(LIVE_MODE)).toBe(false);
  });

  it('returns false for demo (only share counts)', () => {
    expect(isShareSnapshotMode(DEMO_SNAPSHOT_MODE)).toBe(false);
  });

  it('returns true for share', () => {
    expect(isShareSnapshotMode(SHARE_SNAPSHOT_MODE)).toBe(true);
  });
});
