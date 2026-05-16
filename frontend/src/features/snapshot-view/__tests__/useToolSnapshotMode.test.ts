import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_SNAPSHOT_MODE, LIVE_MODE } from '../mode';
import { useSnapshotViewStore, useToolSnapshotMode } from '../store';

describe('useToolSnapshotMode', () => {
  beforeEach(() => {
    useSnapshotViewStore.getState().reset();
  });

  it('defaults to LIVE_MODE when nothing has been set for the tool', () => {
    const { result } = renderHook(() => useToolSnapshotMode('concordance'));
    expect(result.current).toEqual(LIVE_MODE);
  });

  it('reflects setMode for the queried tool', () => {
    const { result } = renderHook(() => useToolSnapshotMode('concordance'));
    expect(result.current).toEqual(LIVE_MODE);

    act(() => {
      useSnapshotViewStore.getState().setMode('concordance', DEMO_SNAPSHOT_MODE);
    });
    expect(result.current).toEqual(DEMO_SNAPSHOT_MODE);
  });

  it('ignores mode changes for other tools', () => {
    const { result } = renderHook(() => useToolSnapshotMode('concordance'));
    act(() => {
      useSnapshotViewStore.getState().setMode('quotation', DEMO_SNAPSHOT_MODE);
    });
    expect(result.current).toEqual(LIVE_MODE);
  });

  it('returns to live after exitSnapshot', () => {
    useSnapshotViewStore.getState().setMode('concordance', DEMO_SNAPSHOT_MODE);
    const { result } = renderHook(() => useToolSnapshotMode('concordance'));
    expect(result.current).toEqual(DEMO_SNAPSHOT_MODE);

    act(() => {
      useSnapshotViewStore.getState().exitSnapshot('concordance');
    });
    expect(result.current).toEqual(LIVE_MODE);
  });
});
