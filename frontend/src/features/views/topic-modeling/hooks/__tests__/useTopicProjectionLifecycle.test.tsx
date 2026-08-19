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
    let attempt = nextTopicProjectionAttempt(null, 'analysis-1', 4, 2, 4, 2);
    expect(attempt).toBeNull();

    for (const [targetK, targetN, appliedK, appliedN, requestKey, layoutChanged] of [
      [3, 2, 4, 2, 1, true],
      [3, 1, 3, 2, 2, false],
      [2, 1, 3, 1, 3, true],
      [3, 2, 2, 1, 4, true],
    ] as const) {
      attempt = nextTopicProjectionAttempt(
        attempt,
        'analysis-1',
        targetK,
        targetN,
        appliedK,
        appliedN,
      );
      expect(attempt).toEqual({
        analysisId: 'analysis-1',
        clusterCount: targetK,
        topNTopics: targetN,
        requestKey,
        layoutChanged,
      });
    }
  });

  it('deduplicates a repeated commit before its result is applied', () => {
    const attempt = nextTopicProjectionAttempt(null, 'analysis-1', 4, 3, 4, 2);
    expect(nextTopicProjectionAttempt(attempt, 'analysis-1', 4, 3, 4, 2)).toBe(attempt);
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
          attempt: {
            analysisId: 'analysis-1',
            clusterCount: 3,
            topNTopics: 2,
            requestKey: 1,
            layoutChanged: true,
          },
          clustering: {
            cluster_count: applied,
            min_cluster_count: 2,
            max_cluster_count: 4,
            default_cluster_count: 4,
            adjustable: true,
          },
          topicInclusion: {
            top_n_topics: 2,
            min_top_n_topics: 1,
            max_top_n_topics: applied,
            default_top_n_topics: 2,
            adjustable: applied > 1,
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
      top_n_topics: 2,
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
          attempt: {
            analysisId: 'analysis-1',
            clusterCount: 2,
            topNTopics: 2,
            requestKey,
            layoutChanged: true,
          },
          clustering: {
            cluster_count: 4,
            min_cluster_count: 2,
            max_cluster_count: 4,
            default_cluster_count: 4,
            adjustable: true,
          },
          topicInclusion: {
            top_n_topics: 2,
            min_top_n_topics: 1,
            max_top_n_topics: 4,
            default_top_n_topics: 2,
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
    expect(view.result.current.controlResetKey).toBe(1);

    view.rerender({ error: null, requestKey: 2 });
    expect(view.result.current.projectionPending).toBe(true);
  });

  it('applies an N-only response without waiting for graph layout and persists the pair', () => {
    const onProjectionApplied = vi.fn();
    const persistSelection = vi.fn().mockResolvedValue(undefined);

    const view = renderHook(() =>
      useTopicProjectionLifecycle({
        analysisId: 'analysis-1',
        attempt: {
          analysisId: 'analysis-1',
          clusterCount: 4,
          topNTopics: 3,
          requestKey: 1,
          layoutChanged: false,
        },
        clustering: {
          cluster_count: 4,
          min_cluster_count: 2,
          max_cluster_count: 4,
          default_cluster_count: 4,
          adjustable: true,
        },
        topicInclusion: {
          top_n_topics: 3,
          min_top_n_topics: 1,
          max_top_n_topics: 4,
          default_top_n_topics: 2,
          adjustable: true,
        },
        isFetching: false,
        isPlaceholderData: false,
        isViewReady: true,
        resultError: null,
        onProjectionApplied,
        persistSelection,
      }),
    );

    expect(view.result.current.projectionPending).toBe(false);
    expect(onProjectionApplied).toHaveBeenCalledWith(false);
    expect(persistSelection).toHaveBeenCalledWith({
      analysis_id: 'analysis-1',
      cluster_count: 4,
      top_n_topics: 3,
    });
  });
});
