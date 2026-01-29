import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAnalysisLockCore } from '@/features/analysis/common/useAnalysisLockMachine';

vi.mock('@/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: () => ({
    selectedNodes: [{ id: 'node-1', data: { columns: ['text'] } }],
  }),
}));

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({ currentWorkspaceId: 'workspace-1' }),
}));

vi.mock('@/hooks/useNodeColumnInfos', () => ({
  useNodeColumnInfos: () => ({
    getColumnInfos: () => [{ name: 'text', dataType: 'string' }],
  }),
}));

describe('useAnalysisLockCore', () => {
  it('exposes recomputeAutoColumns function', () => {
    const { result } = renderHook(() =>
      useAnalysisLockCore({ allowedDataTypes: ['string'] })
    );

    expect(typeof result.current.recomputeAutoColumns).toBe('function');
  });
});