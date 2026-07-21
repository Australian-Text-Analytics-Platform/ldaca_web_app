import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAnalysis } from '../clearAnalysis';

const { clearTabAnalysisMock } = vi.hoisted(() => ({
  clearTabAnalysisMock: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  clearTabAnalysis: clearTabAnalysisMock,
}));

describe('clearAnalysis', () => {
  const queryClient = {
    invalidateQueries: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    clearTabAnalysisMock.mockReset();
    queryClient.invalidateQueries.mockClear();
  });

  it('cleans up local state only after the backend clears the attached Analysis', async () => {
    const onCleanup = vi.fn();
    clearTabAnalysisMock.mockResolvedValue({ data: undefined, error: undefined });

    await clearAnalysis({
      analysisType: 'token_frequencies',
      workspaceId: 'workspace-1',
      tabId: 'tab-1',
      queryClient,
      taskIdSources: ['analysis-1'],
      onCleanup,
    });

    expect(clearTabAnalysisMock).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
    expect(onCleanup).toHaveBeenCalledWith(['analysis-1']);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('preserves local state when the backend clear fails', async () => {
    const onCleanup = vi.fn();
    clearTabAnalysisMock.mockRejectedValue(new Error('Workspace is closing'));

    await expect(
      clearAnalysis({
        analysisType: 'token_frequencies',
        workspaceId: 'workspace-1',
        tabId: 'tab-1',
        queryClient,
        taskIdSources: ['analysis-1'],
        onCleanup,
      }),
    ).rejects.toThrow('Workspace is closing');

    expect(onCleanup).not.toHaveBeenCalled();
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});
