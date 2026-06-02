import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAnalysisLockCore } from '@/features/views/common/useAnalysisLockMachine';

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  /** Called by: useAnalysisLockCore under test to derive active selections because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  useWorkspaceSelection: () => ({
    selectedNodes: [{ id: 'node-1', data: { columns: ['text'] } }],
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  /** Called by: useAnalysisLockCore under test for workspace-scoped selectors because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  useWorkspaceData: () => ({ currentWorkspaceId: 'workspace-1' }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  /** Called by: useAnalysisLockCore under test so unlockSelection can hand locked node ids back to the graph; stubbed because the test needs a deterministic mock before exercising the behavior under assertion. */
  useWorkspaceActions: () => ({ selectNodes: vi.fn() }),
}));

vi.mock('@/features/workspace/common/hooks/useNodeColumnInfos', () => ({
  /** Called by: useAnalysisLockCore under test to provide column metadata because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  useNodeColumnInfos: () => ({
    /** Called by: useAutoNodeColumns inside useAnalysisLockCore because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
    getColumnInfos: () => [{ name: 'text', dataType: 'string' }],
  }),
}));

describe('useAnalysisLockCore', () => {
  it('exposes recomputeAutoColumns function', () => {
    const { result } = renderHook(() => useAnalysisLockCore({ allowedDataTypes: ['string'] }));

    expect(typeof result.current.recomputeAutoColumns).toBe('function');
  });
});
