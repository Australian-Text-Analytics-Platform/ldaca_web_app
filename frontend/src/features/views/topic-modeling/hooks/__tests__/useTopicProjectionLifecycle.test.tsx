import { renderHook } from '@testing-library/react';
import { type PropsWithChildren, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  nextTopicProjectionAttempt,
  useTopicProjectionLifecycle,
} from '../useTopicProjectionLifecycle';

const strictWrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;

describe('useTopicProjectionLifecycle', () => {
  it('creates one fresh attempt per changed drop, including revisited counts', () => {
    let attempt = nextTopicProjectionAttempt(null, 'analysis-1', 4, 4);
    expect(attempt).toBeNull();

    for (const [target, applied, requestKey] of [
      [3, 4, 1],
      [2, 3, 2],
      [4, 2, 3],
      [3, 4, 4],
    ] as const) {
      attempt = nextTopicProjectionAttempt(attempt, 'analysis-1', target, applied);
      expect(attempt).toEqual({
        analysisId: 'analysis-1',
        clusterCount: target,
        requestKey,
      });
    }
  });

  it('locks synchronously, handles a matching result once, and makes applied drops no-ops', () => {
    const onProjectionApplied = vi.fn();
    const persistSelection = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(
      ({
        applied,
        fetching,
        placeholder,
        ready,
      }: {
        applied: number;
        fetching: boolean;
        placeholder: boolean;
        ready: boolean;
      }) =>
        useTopicProjectionLifecycle({
          analysisId: 'analysis-1',
          attempt: { analysisId: 'analysis-1', clusterCount: 3, requestKey: 1 },
          clustering: {
            cluster_count: applied,
            min_cluster_count: 2,
            max_cluster_count: 4,
            default_cluster_count: 4,
            adjustable: true,
          },
          isFetching: fetching,
          isPlaceholderData: placeholder,
          isViewReady: ready,
          resultError: null,
          onProjectionApplied,
          persistSelection,
        }),
      {
        wrapper: strictWrapper,
        initialProps: { applied: 4, fetching: false, placeholder: false, ready: false },
      },
    );

    expect(view.result.current.projectionPending).toBe(true);

    view.rerender({ applied: 4, fetching: true, placeholder: true, ready: false });
    expect(view.result.current.projectionPending).toBe(true);
    view.rerender({ applied: 3, fetching: false, placeholder: false, ready: false });
    expect(view.result.current.projectionPending).toBe(true);
    expect(onProjectionApplied).not.toHaveBeenCalled();

    view.rerender({ applied: 3, fetching: false, placeholder: false, ready: true });

    expect(view.result.current.projectionPending).toBe(false);
    expect(onProjectionApplied).toHaveBeenCalledTimes(1);
    expect(persistSelection).toHaveBeenCalledTimes(1);
    expect(persistSelection).toHaveBeenCalledWith({
      analysis_id: 'analysis-1',
      cluster_count: 3,
    });

    view.rerender({ applied: 3, fetching: false, placeholder: false, ready: true });
    expect(onProjectionApplied).toHaveBeenCalledTimes(1);
    expect(persistSelection).toHaveBeenCalledTimes(1);
  });

  it('unlocks and resets the slider after failure, then locks for a fresh retry attempt', () => {
    const view = renderHook(
      ({ error, requestKey }: { error: string | null; requestKey: number }) =>
        useTopicProjectionLifecycle({
          analysisId: 'analysis-1',
          attempt: { analysisId: 'analysis-1', clusterCount: 2, requestKey },
          clustering: {
            cluster_count: 4,
            min_cluster_count: 2,
            max_cluster_count: 4,
            default_cluster_count: 4,
            adjustable: true,
          },
          isFetching: false,
          isPlaceholderData: false,
          isViewReady: false,
          resultError: error,
          onProjectionApplied: vi.fn(),
          persistSelection: vi.fn().mockResolvedValue(undefined),
        }),
      { initialProps: { error: null, requestKey: 1 } },
    );

    view.rerender({ error: 'Projection failed', requestKey: 1 });
    expect(view.result.current.projectionPending).toBe(false);
    expect(view.result.current.projectionError).toBe('Projection failed');
    expect(view.result.current.sliderResetKey).toBe(1);

    view.rerender({ error: null, requestKey: 2 });
    expect(view.result.current.projectionPending).toBe(true);
  });
});
