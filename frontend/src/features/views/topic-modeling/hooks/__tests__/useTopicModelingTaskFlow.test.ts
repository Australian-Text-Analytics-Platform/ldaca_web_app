import { describe, expect, it, vi } from 'vitest';

import type { Analysis } from '@/api';
import type { RunAnalysisOptions } from '@/features/views/common/hooks/useAnalysisFeature';

const submitTabAnalysis = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTabAnalysis,
}));

import { useTopicModelingTaskFlow } from '../useTopicModelingTaskFlow';

const executeAnalysis = async <TAnalysis extends Analysis>(
  options: RunAnalysisOptions<TAnalysis>,
) => {
  options.resetBeforeRun?.();
  const response = await options.submit();
  options.onSuccess?.(response);
  return response;
};

describe('useTopicModelingTaskFlow', () => {
  it('submits one canonical root analysis owned by the tab', async () => {
    submitTabAnalysis.mockResolvedValueOnce({
      data: {
        id: 'analysis-1',
        state: 'queued',
        progress: { fraction: 0, message: 'Queued' },
      },
    });
    const runAnalysis = vi.fn(executeAnalysis);
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
        minClusterSize: 5,
        segmentationMethod: 'paragraph',
        maxSegmentTokens: 64,
      },
      actions: {
        runAnalysis,
        setError: vi.fn(),
      },
    });

    await flow.handleRun();
    expect(submitTabAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
        body: expect.objectContaining({
          execution_scope: 'run_all',
          request: expect.objectContaining({
            kind: 'topic_modeling',
            node_ids: ['node-1'],
            min_cluster_size: 5,
            segmentation_method: 'paragraph',
            max_segment_tokens: 64,
          }),
        }),
      }),
    );
    expect(runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ action: 'run_all' }));
  });
});
