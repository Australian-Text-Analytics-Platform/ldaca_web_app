import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Analysis } from '@/api';
import type { RunAnalysisOptions } from '../../../common/hooks/useAnalysisFeature';

const submitTabAnalysis = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTabAnalysis,
}));

import { useSequentialAnalysisTaskFlow } from '../useSequentialAnalysisTaskFlow';

const executeAnalysis = async <TAnalysis extends Analysis>(
  options: RunAnalysisOptions<TAnalysis>,
) => {
  const response = await options.submit();
  options.onSuccess?.(response);
  return response;
};

describe('useSequentialAnalysisTaskFlow', () => {
  it('keeps computed results empty while the submitted Analysis is queued', async () => {
    submitTabAnalysis.mockResolvedValueOnce({
      data: {
        id: 'analysis-1',
        state: 'queued',
      },
    });
    const runAnalysis = vi.fn(executeAnalysis);

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
        },
        actions: {
          runAnalysis,
          setChartType: vi.fn(),
          setNodeColumnSelections: vi.fn(),
          setTimeColumn: vi.fn(),
          lockCurrentSchema: vi.fn(),
          clearResults: vi.fn(async () => true),
        },
      }),
    );

    await act(async () => result.current.handleAnalyze());

    expect(runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ action: 'run_all' }));
    expect(submitTabAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          request: expect.not.objectContaining({ case_sensitive: expect.anything() }),
        }),
      }),
    );
  });
});
