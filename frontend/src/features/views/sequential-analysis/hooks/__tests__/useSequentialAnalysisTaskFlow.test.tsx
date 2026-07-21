import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const submitTabAnalysis = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTabAnalysis,
}));

import { useSequentialAnalysisTaskFlow } from '../useSequentialAnalysisTaskFlow';

describe('useSequentialAnalysisTaskFlow', () => {
  it('keeps computed results empty while the submitted Analysis is queued', async () => {
    submitTabAnalysis.mockResolvedValueOnce({
      data: {
        id: 'analysis-1',
        state: 'queued',
      },
    });
    const setIsAnalyzing = vi.fn();
    const setResults = vi.fn();
    const onTaskIdAssigned = vi.fn();

    const { result } = renderHook(() =>
      useSequentialAnalysisTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          activeNodeId: 'node-1',
          nodeColumnSelections: [{ nodeId: 'node-1', column: 'created_at' }],
          timeColumn: 'created_at',
          groupByColumns: [],
          frequency: 'daily',
          derivedColumnType: 'datetime',
          numericOriginValue: null,
          numericIntervalValue: null,
          numericOriginInput: '',
          customIntervalValue: null,
          customIntervalUnit: null,
          caseSensitive: false,
          results: null,
        },
        actions: {
          setIsAnalyzing,
          setResults,
          setChartType: vi.fn(),
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          lastFetchedRef: { current: { taskId: null, state: null } },
          setNodeColumnSelections: vi.fn(),
          setTimeColumn: vi.fn(),
          lockCurrentSchema: vi.fn(),
          clearResults: vi.fn(async () => true),
          onTaskIdAssigned,
        },
      }),
    );

    await act(async () => result.current.handleAnalyze());

    expect(onTaskIdAssigned).toHaveBeenCalledWith('analysis-1');
    expect(setResults).toHaveBeenCalledOnce();
    expect(setResults).toHaveBeenCalledWith(null);
    expect(setIsAnalyzing).toHaveBeenCalledTimes(1);
    expect(setIsAnalyzing).toHaveBeenCalledWith(true);
  });
});
