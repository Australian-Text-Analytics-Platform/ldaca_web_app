import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useWorkspaceCoreMock = vi.hoisted(() => vi.fn());
const useWorkspaceQueriesMock = vi.hoisted(() => vi.fn());
const useWorkspaceNodeMutationsMock = vi.hoisted(() => vi.fn());
const useIsMutatingMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsMutating: useIsMutatingMock,
}));

vi.mock('../useWorkspaceCore', () => ({ useWorkspaceCore: useWorkspaceCoreMock }));
vi.mock('../useWorkspaceQueries', () => ({ useWorkspaceQueries: useWorkspaceQueriesMock }));
vi.mock('../useWorkspaceNodeMutations', () => ({
  useWorkspaceNodeMutations: useWorkspaceNodeMutationsMock,
}));

import { useWorkspaceInternal } from '../useWorkspaceInternal';

const coreDefaults = {
  isAuthenticated: true,
  userId: 'user-1',
  activeNodeId: null,
  selectedNodeIds: [],
  activateNode: vi.fn(),
  reorderSelectedNodes: vi.fn(),
  removeNode: vi.fn(),
  replaceSelectedNodes: vi.fn(),
  toggleNode: vi.fn(),
  clearSelection: vi.fn(),
};

const queryDefaults = {
  workspaces: [],
  currentWorkspace: null,
  workspaceGraph: null,
  nodes: [],
  selectedNode: null,
  selectedNodes: [],
  queryLoadingState: {},
  currentWorkspaceId: null,
  workspacesHydrated: true,
  nodesHydrated: true,
};

const renderInternal = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useWorkspaceInternal(), { wrapper });
};

describe('useWorkspaceInternal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useIsMutatingMock.mockReturnValue(0);
    useWorkspaceCoreMock.mockReturnValue({ ...coreDefaults });
    useWorkspaceQueriesMock.mockReturnValue({ ...queryDefaults });
    useWorkspaceNodeMutationsMock.mockReturnValue({ actions: { createWorkspace: vi.fn() } });
  });

  it('selects nothing when the backend reports no open Workspace', () => {
    useWorkspaceCoreMock.mockReturnValue({
      ...coreDefaults,
      isAuthenticated: false,
    });
    const { result } = renderInternal();
    expect(result.current.currentWorkspaceId).toBeNull();
    expect(result.current.currentWorkspace).toBeNull();
  });

  it('clears local Data Block selection when the backend open Workspace changes', () => {
    const clearSelection = vi.fn();
    useWorkspaceCoreMock.mockReturnValue({ ...coreDefaults, clearSelection });
    useWorkspaceQueriesMock.mockReturnValue({
      ...queryDefaults,
      currentWorkspaceId: 'workspace-1',
    });
    const { rerender } = renderInternal();
    useWorkspaceQueriesMock.mockReturnValue({
      ...queryDefaults,
      currentWorkspaceId: 'workspace-2',
    });
    rerender();
    expect(clearSelection).toHaveBeenCalledOnce();
  });

  it('combines operation loading with query loading', () => {
    useIsMutatingMock.mockReturnValue(1);
    useWorkspaceQueriesMock.mockReturnValue({
      ...queryDefaults,
      queryLoadingState: { workspaces: true },
    });
    const { result } = renderInternal();
    expect(result.current.isLoading).toMatchObject({ operations: true, workspaces: true });
  });

  it('exposes selected workspace and graph data from the local selection plus canonical queries', () => {
    useWorkspaceCoreMock.mockReturnValue({ ...coreDefaults, activeNodeId: 'node-1' });
    useWorkspaceQueriesMock.mockReturnValue({
      ...queryDefaults,
      currentWorkspace: { id: 'workspace-1' },
      currentWorkspaceId: 'workspace-1',
      workspaceGraph: { nodes: [{ id: 'node-1' }] },
    });
    const { result } = renderInternal();
    expect(result.current.currentWorkspaceId).toBe('workspace-1');
    expect(result.current.activeNodeId).toBe('node-1');
    expect(result.current.workspaceGraph).toEqual({ nodes: [{ id: 'node-1' }] });
  });
});
