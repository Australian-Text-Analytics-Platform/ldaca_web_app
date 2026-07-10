import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalysisTaskStatus } from '../../useAnalysisTaskStatus';
import { useAnalysisTaskFlow } from '../useAnalysisTaskFlow';

const mocks = vi.hoisted(() => ({
  useAnalysisTaskStatus: vi.fn(),
}));

vi.mock('../../useAnalysisTaskStatus', () => ({
  useAnalysisTaskStatus: mocks.useAnalysisTaskStatus,
}));

const terminalStatus = (): AnalysisTaskStatus => {
  const task = {
    task_id: 'task-1',
    task_type: 'token_frequencies',
    workspace_id: 'workspace-1',
    state: 'successful' as const,
  };
  return {
    tasks: [task],
    runningTask: null,
    queuedTask: null,
    successfulTask: task,
    failedTask: null,
    cancelledTask: null,
    terminalTask: task,
    activeTaskId: null,
    bannerStatus: null,
    bannerTaskId: null,
    bannerMessage: undefined,
  };
};

describe('useAnalysisTaskFlow', () => {
  beforeEach(() => {
    mocks.useAnalysisTaskStatus.mockReset();
  });

  it('automatically refreshes a matching terminal task once and exposes only live outputs', async () => {
    const refreshResults = vi.fn(() => Promise.resolve());
    mocks.useAnalysisTaskStatus.mockReturnValue(terminalStatus());

    const { result, rerender } = renderHook(() =>
      useAnalysisTaskFlow({
        taskType: 'token_frequencies',
        workspaceId: 'workspace-1',
        taskIds: ['task-1'],
        refreshResults,
      }),
    );

    await waitFor(() => {
      expect(refreshResults).toHaveBeenCalledWith({
        reason: 'terminal',
        task: terminalStatus().terminalTask,
        taskId: 'task-1',
        taskState: 'successful',
      });
    });

    rerender();
    expect(refreshResults).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.current).sort()).toEqual(['banner', 'status']);
  });
});
