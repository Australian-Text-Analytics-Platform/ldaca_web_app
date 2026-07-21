import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useWorkspaceCoreMock = vi.hoisted(() => vi.fn());
const useWorkspaceQueriesMock = vi.hoisted(() => vi.fn());
const useWorkspaceNodeMutationsMock = vi.hoisted(() => vi.fn());

vi.mock('../useWorkspaceCore', () => ({ useWorkspaceCore: useWorkspaceCoreMock }));
vi.mock('../useWorkspaceQueries', () => ({ useWorkspaceQueries: useWorkspaceQueriesMock }));
vi.mock('../useWorkspaceNodeMutations', () => ({
  useWorkspaceNodeMutations: useWorkspaceNodeMutationsMock,
}));

import { useWorkspaceInternal } from '../useWorkspaceInternal';

const coreDefaults = {
  isAuthenticated: true,
  currentWorkspaceId: null,
  setCurrentWorkspaceId: vi.fn(),
  activeNodeId: null,
  selectedNodeIds: [],
  activateNode: vi.fn(),
  reorderSelectedNodes: vi.fn(),
  removeNode: vi.fn(),
  replaceSelectedNodes: vi.fn(),
  toggleNode: vi.fn(),
  clearSelection: vi.fn(),
  loadingOperationCount: 0,
  startOperation: vi.fn(),
  endOperation: vi.fn(),
};

const queryDefaults = {
  workspaces: [],
  currentWorkspace: null,
  workspaceGraph: null,
  nodes: [],
  selectedNode: null,
  selectedNodes: [],
  queryLoadingState: {},
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
    useWorkspaceCoreMock.mockReturnValue({ ...coreDefaults });
    useWorkspaceQueriesMock.mockReturnValue({ ...queryDefaults });
    useWorkspaceNodeMutationsMock.mockReturnValue({ actions: { createWorkspace: vi.fn() } });
  });

  it('clears an explicitly selected workspace when authentication ends', () => {
    const setCurrentWorkspaceId = vi.fn();
    useWorkspaceCoreMock.mockReturnValue({
      ...coreDefaults,
      isAuthenticated: false,
      currentWorkspaceId: 'workspace-1',
      setCurrentWorkspaceId,
    });
    renderInternal();
    expect(setCurrentWorkspaceId).toHaveBeenCalledWith(null);
  });

  it('does not consult or write a backend current-workspace resource', () => {
    const setCurrentWorkspaceId = vi.fn();
    useWorkspaceCoreMock.mockReturnValue({ ...coreDefaults, setCurrentWorkspaceId });
    useWorkspaceQueriesMock.mockReturnValue({
      ...queryDefaults,
      workspaces: [{ id: 'workspace-1' }],
    });
    renderInternal();
    expect(setCurrentWorkspaceId).not.toHaveBeenCalled();
  });

  it('combines operation loading with query loading', () => {
    useWorkspaceCoreMock.mockReturnValue({ ...coreDefaults, loadingOperationCount: 1 });
    useWorkspaceQueriesMock.mockReturnValue({
      ...queryDefaults,
      queryLoadingState: { workspaces: true },
    });
    const { result } = renderInternal();
    expect(result.current.isLoading).toMatchObject({ operations: true, workspaces: true });
  });

  it('exposes selected workspace and graph data from the local selection plus canonical queries', () => {
    useWorkspaceCoreMock.mockReturnValue({
      ...coreDefaults,
      currentWorkspaceId: 'workspace-1',
      activeNodeId: 'node-1',
    });
    useWorkspaceQueriesMock.mockReturnValue({
      ...queryDefaults,
      currentWorkspace: { id: 'workspace-1' },
      workspaceGraph: { nodes: [{ id: 'node-1' }] },
    });
    const { result } = renderInternal();
    expect(result.current.currentWorkspaceId).toBe('workspace-1');
    expect(result.current.activeNodeId).toBe('node-1');
    expect(result.current.workspaceGraph).toEqual({ nodes: [{ id: 'node-1' }] });
  });
});
