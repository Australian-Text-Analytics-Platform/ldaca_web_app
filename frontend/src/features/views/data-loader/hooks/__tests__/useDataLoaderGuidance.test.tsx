import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_LOADER_GUIDANCE_IDS } from '@/features/guidance/registry';
import { useDataLoaderGuidance } from '../useDataLoaderGuidance';

const mockRequestContextualHint = vi.fn();

vi.mock('@/features/guidance/GuidanceContext', () => ({
  useGuidance: () => ({
    requestContextualHint: mockRequestContextualHint,
    startGuidedTour: vi.fn(),
  }),
}));

describe('useDataLoaderGuidance', () => {
  beforeEach(() => {
    mockRequestContextualHint.mockClear();
  });

  it('waits for workspace and file state before requesting guidance', () => {
    const { rerender } = renderHook(
      (state) => {
        useDataLoaderGuidance(state);
      },
      {
        initialProps: {
          currentWorkspaceId: null,
          loadingFiles: true,
          nodeCount: 0,
          totalFileCount: 0,
          workspaceBusy: true,
          workspaceCount: 0,
        },
      },
    );

    expect(mockRequestContextualHint).not.toHaveBeenCalled();

    rerender({
      currentWorkspaceId: null,
      loadingFiles: false,
      nodeCount: 0,
      totalFileCount: 0,
      workspaceBusy: false,
      workspaceCount: 0,
    });

    expect(mockRequestContextualHint).toHaveBeenLastCalledWith(DATA_LOADER_GUIDANCE_IDS.workspace);

    rerender({
      currentWorkspaceId: null,
      loadingFiles: false,
      nodeCount: 0,
      totalFileCount: 0,
      workspaceBusy: false,
      workspaceCount: 1,
    });

    expect(mockRequestContextualHint).toHaveBeenLastCalledWith(
      DATA_LOADER_GUIDANCE_IDS.workspaceLoad,
    );
  });

  it('requests each explanation as the first-run workflow progresses', () => {
    const { rerender } = renderHook(
      (state) => {
        useDataLoaderGuidance(state);
      },
      {
        initialProps: {
          currentWorkspaceId: 'workspace-1',
          loadingFiles: false,
          nodeCount: 0,
          totalFileCount: 0,
          workspaceBusy: false,
          workspaceCount: 1,
        },
      },
    );

    expect(mockRequestContextualHint).toHaveBeenLastCalledWith(
      DATA_LOADER_GUIDANCE_IDS.fileSources,
    );

    rerender({
      currentWorkspaceId: 'workspace-1',
      loadingFiles: false,
      nodeCount: 0,
      totalFileCount: 1,
      workspaceBusy: false,
      workspaceCount: 1,
    });
    expect(mockRequestContextualHint).toHaveBeenLastCalledWith(
      DATA_LOADER_GUIDANCE_IDS.addDataBlock,
    );

    rerender({
      currentWorkspaceId: 'workspace-1',
      loadingFiles: false,
      nodeCount: 1,
      totalFileCount: 1,
      workspaceBusy: false,
      workspaceCount: 1,
    });
    expect(mockRequestContextualHint).toHaveBeenLastCalledWith(DATA_LOADER_GUIDANCE_IDS.dataBlocks);
  });
});
