import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTEXTUAL_HINT_IDS } from '@/features/guidance/registry';
import { useDataLoaderGuidance } from '../useDataLoaderGuidance';

const publish = vi.fn();

vi.mock('@/features/guidance/useProgressiveContextualHints', () => ({
  useProgressiveContextualHints: (ids: readonly string[]) => publish(ids),
}));

describe('useDataLoaderGuidance', () => {
  beforeEach(() => publish.mockClear());

  it('waits for stable workspace and file state', () => {
    renderHook(() =>
      useDataLoaderGuidance({
        currentWorkspaceId: null,
        loadingFiles: true,
        nodeCount: 0,
        totalFileCount: 0,
        workspaceBusy: true,
        workspaceCount: 0,
      }),
    );
    expect(publish).toHaveBeenLastCalledWith([]);
  });

  it('publishes the mutually exclusive create and load branches', () => {
    const { rerender } = renderHook(
      (workspaceCount) =>
        useDataLoaderGuidance({
          currentWorkspaceId: null,
          loadingFiles: false,
          nodeCount: 0,
          totalFileCount: 0,
          workspaceBusy: false,
          workspaceCount,
        }),
      { initialProps: 0 },
    );
    expect(publish).toHaveBeenLastCalledWith([CONTEXTUAL_HINT_IDS.dataLoader.workspace]);
    rerender(1);
    expect(publish).toHaveBeenLastCalledWith([CONTEXTUAL_HINT_IDS.dataLoader.workspaceLoad]);
  });

  it('catches up through every reached active-Workspace milestone', () => {
    const { rerender } = renderHook(
      ({ nodeCount, totalFileCount }) =>
        useDataLoaderGuidance({
          currentWorkspaceId: 'workspace-1',
          loadingFiles: false,
          nodeCount,
          totalFileCount,
          workspaceBusy: false,
          workspaceCount: 1,
        }),
      { initialProps: { nodeCount: 0, totalFileCount: 0 } },
    );
    expect(publish).toHaveBeenLastCalledWith([
      CONTEXTUAL_HINT_IDS.dataLoader.activeWorkspace,
      CONTEXTUAL_HINT_IDS.dataLoader.fileSources,
    ]);

    rerender({ nodeCount: 1, totalFileCount: 1 });
    expect(publish).toHaveBeenLastCalledWith([
      CONTEXTUAL_HINT_IDS.dataLoader.activeWorkspace,
      CONTEXTUAL_HINT_IDS.dataLoader.fileSources,
      CONTEXTUAL_HINT_IDS.dataLoader.addDataBlock,
      CONTEXTUAL_HINT_IDS.dataLoader.dataBlocks,
    ]);
  });
});
