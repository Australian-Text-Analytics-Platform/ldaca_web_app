import { describe, expect, it, vi } from 'vitest';

const submitTabAnalysis = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTabAnalysis,
}));

import { useTopicModelingTaskFlow } from '../useTopicModelingTaskFlow';

describe('useTopicModelingTaskFlow', () => {
  it('submits one canonical root analysis owned by the tab', async () => {
    submitTabAnalysis.mockResolvedValueOnce({
      data: {
        id: 'analysis-1',
        state: 'queued',
        progress: { fraction: 0, message: 'Queued' },
      },
    });
    const setLocalTaskId = vi.fn();
    const flow = useTopicModelingTaskFlow({
      state: {
        currentWorkspaceId: 'workspace-1',
        tabId: 'tab-1',
        panelNodeIds: ['node-1'],
        panelHasMissingColumns: false,
        effectiveNodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
        randomSeed: 0,
        representativeWordsCount: 10,
        sampleFractions: null,
        minTopicSize: 5,
      },
      actions: {
        setIsRunning: vi.fn(),
        runningRef: { current: false },
        setError: vi.fn(),
        setLocalTaskId,
        onSubmitted: vi.fn(),
      },
    });

    await flow.handleRun();
    expect(submitTabAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
        body: expect.objectContaining({
          execution_scope: 'run_all',
          request: expect.objectContaining({ kind: 'topic_modeling', node_ids: ['node-1'] }),
        }),
      }),
    );
    expect(setLocalTaskId).toHaveBeenCalledWith('analysis-1');
  });
});
