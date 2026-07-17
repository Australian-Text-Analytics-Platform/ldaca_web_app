import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceSdkMock = vi.hoisted(() => ({
  closeWorkspaceById: vi.fn(),
  createNode: vi.fn(),
  createWorkspace: vi.fn(),
  deleteNode: vi.fn(),
  deleteWorkspaceById: vi.fn(),
  openWorkspaceById: vi.fn(),
  previewNodeCreationTable: vi.fn(),
  reorderWorkspaceNodesById: vi.fn(),
  submitChildAnalysis: vi.fn(),
  submitTabAnalysis: vi.fn(),
  updateNode: vi.fn(),
  updateWorkspaceById: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  ...workspaceSdkMock,
}));

import { useWorkspaceNodeMutations } from '../useWorkspaceNodeMutations';

const createTestClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

const wrapWithClient =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

const operationSpy = () => vi.fn() as unknown as (operationId: string) => void;

const buildArgs = (queryClient: QueryClient, currentWorkspaceId: string | null = 'ws-1') => ({
  currentWorkspaceId,
  setCurrentWorkspaceId: vi.fn(),
  removeNode: vi.fn(),
  replaceSelectedNodes: vi.fn(),
  clearSelection: vi.fn(),
  queryClient,
  startOperation: operationSpy(),
  endOperation: operationSpy(),
});

describe('useWorkspaceNodeMutations', () => {
  beforeEach(() => {
    Object.values(workspaceSdkMock).forEach((mock) => mock.mockReset());
  });

  it('creates a workspace through the canonical resource endpoint', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.createWorkspace.mockResolvedValue({ data: { id: 'ws-new' } });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.createWorkspace('My workspace', 'Description');
    });

    expect(workspaceSdkMock.createWorkspace).toHaveBeenCalledWith({
      body: { name: 'My workspace', description: 'Description' },
      throwOnError: true,
    });
  });

  it('opens a workspace before updating the local selection', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.openWorkspaceById.mockResolvedValue({ data: { id: 'ws-2' } });
    const args = buildArgs(queryClient);
    const { result } = renderHook(() => useWorkspaceNodeMutations(args), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.setCurrentWorkspace('ws-2');
    });

    expect(workspaceSdkMock.openWorkspaceById).toHaveBeenCalledWith({
      path: { workspace_id: 'ws-2' },
      throwOnError: true,
    });
    expect(args.setCurrentWorkspaceId).toHaveBeenCalledWith('ws-2');
    expect(args.clearSelection).toHaveBeenCalledOnce();
  });

  it('closes the selected workspace when the selection is cleared', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.closeWorkspaceById.mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient, 'ws-1')), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.setCurrentWorkspace(null);
    });

    expect(workspaceSdkMock.closeWorkspaceById).toHaveBeenCalledWith({
      path: { workspace_id: 'ws-1' },
      throwOnError: true,
    });
  });

  it('uses the canonical node resource for rename, clone, and delete', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.updateNode.mockResolvedValue({ data: { id: 'node-1' } });
    workspaceSdkMock.createNode.mockResolvedValue({ data: { id: 'node-copy' } });
    workspaceSdkMock.deleteNode.mockResolvedValue({ data: undefined });
    const args = buildArgs(queryClient);
    const { result } = renderHook(() => useWorkspaceNodeMutations(args), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.renameNode('node-1', 'Renamed');
      await result.current.actions.copyNode('node-1');
      await result.current.actions.deleteNode('node-1');
    });

    expect(workspaceSdkMock.updateNode).toHaveBeenCalledWith({
      body: { name: 'Renamed' },
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
    expect(workspaceSdkMock.createNode).toHaveBeenCalledWith({
      body: { kind: 'clone', source_node_id: 'node-1' },
      path: { workspace_id: 'ws-1' },
      throwOnError: true,
    });
    expect(workspaceSdkMock.deleteNode).toHaveBeenCalledWith({
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
    expect(args.removeNode).toHaveBeenCalledWith('node-1');
  });

  it('creates joins and concatenations as typed node resources', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.createNode
      .mockResolvedValueOnce({ data: { id: 'joined-node' } })
      .mockResolvedValueOnce({ data: { id: 'concat-node' } });
    const args = buildArgs(queryClient);
    const { result } = renderHook(() => useWorkspaceNodeMutations(args), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.joinNodes(
        'left-node',
        'right-node',
        'inner',
        ['left_id'],
        ['right_id'],
        'Joined',
      );
      await result.current.actions.concatNodes(['node-a', 'node-b'], 'Combined', true);
    });

    expect(workspaceSdkMock.createNode).toHaveBeenNthCalledWith(1, {
      body: {
        kind: 'join',
        left_node_id: 'left-node',
        right_node_id: 'right-node',
        left_on: 'left_id',
        right_on: 'right_id',
        how: 'inner',
        name: 'Joined',
      },
      path: { workspace_id: 'ws-1' },
      throwOnError: true,
    });
    expect(workspaceSdkMock.createNode).toHaveBeenNthCalledWith(2, {
      body: {
        kind: 'concat',
        source_node_ids: ['node-a', 'node-b'],
        name: 'Combined',
        deduplicate: true,
      },
      path: { workspace_id: 'ws-1' },
      throwOnError: true,
    });
    expect(args.replaceSelectedNodes).toHaveBeenNthCalledWith(1, ['joined-node'], 'joined-node');
    expect(args.replaceSelectedNodes).toHaveBeenNthCalledWith(2, ['concat-node'], 'concat-node');
  });

  it('previews node creation with the request workspace and cancellation signal', async () => {
    const queryClient = createTestClient();
    const signal = new AbortController().signal;
    workspaceSdkMock.previewNodeCreationTable.mockResolvedValue({
      rows: [{ id: 1 }],
      columns: ['id'],
      hasNext: false,
    });
    const { result } = renderHook(
      () => useWorkspaceNodeMutations(buildArgs(queryClient, 'closure-workspace')),
      { wrapper: wrapWithClient(queryClient) },
    );

    await act(async () => {
      await result.current.actions.concatPreview({
        workspaceId: 'request-workspace',
        nodeIds: ['node-a', 'node-b'],
        page: 2,
        pageSize: 25,
        deduplicate: true,
        signal,
      });
    });

    expect(workspaceSdkMock.previewNodeCreationTable).toHaveBeenCalledWith({
      body: { kind: 'concat', source_node_ids: ['node-a', 'node-b'], deduplicate: true },
      path: { workspace_id: 'request-workspace' },
      query: { page: 2, page_size: 25 },
      signal,
    });
  });

  it('casts a column by creating a typed cast node', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.createNode.mockResolvedValue({ data: { id: 'cast-node' } });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.castColumn('node-1', 'published_at', 'datetime', '%Y-%m-%d');
    });

    expect(workspaceSdkMock.createNode).toHaveBeenCalledWith({
      body: {
        kind: 'cast',
        source_node_id: 'node-1',
        column: 'published_at',
        target_type: 'datetime',
        datetime_format: '%Y-%m-%d',
      },
      path: { workspace_id: 'ws-1' },
      throwOnError: true,
    });
  });

  it('submits child analysis resources under their parent analysis', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.submitChildAnalysis.mockResolvedValue({ data: { id: 'child-1' } });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.detachConcordance('analysis-1', {
        node_id: 'node-1',
        selected_columns: ['text'],
      });
    });

    expect(workspaceSdkMock.submitChildAnalysis).toHaveBeenCalledWith({
      body: {
        kind: 'concordance_detachment',
        node_id: 'node-1',
        selected_columns: ['text'],
      },
      path: { workspace_id: 'ws-1', analysis_id: 'analysis-1' },
      throwOnError: true,
    });
  });

  it('submits quotation analyses through the tab analysis resource', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.submitTabAnalysis.mockResolvedValue({ data: { id: 'analysis-2' } });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.quotationSearch('tab-1', {
        node_ids: ['node-1'],
        node_columns: { 'node-1': 'text' },
      });
    });

    expect(workspaceSdkMock.submitTabAnalysis).toHaveBeenCalledWith({
      body: {
        kind: 'quotation',
        node_ids: ['node-1'],
        node_columns: { 'node-1': 'text' },
      },
      path: { workspace_id: 'ws-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
  });
});
