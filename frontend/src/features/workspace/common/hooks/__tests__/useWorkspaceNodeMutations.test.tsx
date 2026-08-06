import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFreshNodesStore } from '@/stores/freshNodesStore';

const workspaceSdkMock = vi.hoisted(() => ({
  closeWorkspaceById: vi.fn(),
  createNode: vi.fn(),
  createWorkspace: vi.fn(),
  deleteNode: vi.fn(),
  deleteWorkspaceById: vi.fn(),
  editNode: vi.fn(),
  openWorkspaceById: vi.fn(),
  previewNodeCreationTable: vi.fn(),
  reorderWorkspaceNodesById: vi.fn(),
  redoNode: vi.fn(),
  submitTabAnalysis: vi.fn(),
  updateNode: vi.fn(),
  updateWorkspaceById: vi.fn(),
  undoNode: vi.fn(),
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

const buildArgs = (queryClient: QueryClient, currentWorkspaceId: string | null = 'ws-1') => ({
  currentWorkspaceId,
  removeNode: vi.fn(),
  replaceSelectedNodes: vi.fn(),
  clearSelection: vi.fn(),
  queryClient,
});

describe('useWorkspaceNodeMutations', () => {
  beforeEach(() => {
    Object.values(workspaceSdkMock).forEach((mock) => mock.mockReset());
    useFreshNodesStore.getState().reset();
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

  it('opens a Workspace and reconciles through the authoritative Workspace list', async () => {
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
    expect(args.clearSelection).not.toHaveBeenCalled();
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
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.get('ws-1')).toEqual(
      new Set(['node-copy']),
    );
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
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.get('ws-1')).toEqual(
      new Set(['joined-node', 'concat-node']),
    );
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

  it('casts, renames, and deletes columns through identity-preserving edits', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.editNode.mockResolvedValue({ data: { id: 'node-1' } });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.castColumn('node-1', 'published_at', 'datetime', '%Y-%m-%d');
      await result.current.actions.renameColumn('node-1', 'published_at', 'date');
      await result.current.actions.deleteColumn('node-1', 'date');
    });

    expect(workspaceSdkMock.editNode).toHaveBeenNthCalledWith(1, {
      body: {
        kind: 'cast',
        column: 'published_at',
        target_type: 'datetime',
        datetime_format: '%Y-%m-%d',
      },
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
    expect(workspaceSdkMock.editNode).toHaveBeenNthCalledWith(2, {
      body: {
        kind: 'rename_column',
        column: 'published_at',
        new_name: 'date',
      },
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
    expect(workspaceSdkMock.editNode).toHaveBeenNthCalledWith(3, {
      body: { kind: 'delete_column', column: 'date' },
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
  });

  it('routes preprocessing create and update modes to distinct commands', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.createNode.mockResolvedValue({ data: { id: 'derived-node' } });
    workspaceSdkMock.editNode.mockResolvedValue({ data: { id: 'node-1' } });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });
    const request = {
      conditions: [{ column: 'count', operator: 'gte' as const, value: 2 }],
      logic: 'and' as const,
      name: 'Filtered',
    };

    await act(async () => {
      await result.current.actions.filterNode('node-1', request, 'create');
      await result.current.actions.filterNode('node-1', request, 'update');
    });

    expect(workspaceSdkMock.createNode).toHaveBeenCalledWith({
      body: {
        kind: 'filter',
        source_node_id: 'node-1',
        conditions: request.conditions,
        logic: 'and',
        name: 'Filtered',
      },
      path: { workspace_id: 'ws-1' },
      throwOnError: true,
    });
    expect(workspaceSdkMock.editNode).toHaveBeenCalledWith({
      body: {
        kind: 'filter',
        conditions: request.conditions,
        logic: 'and',
      },
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
    expect(useFreshNodesStore.getState().freshIdsByWorkspace.get('ws-1')).toEqual(
      new Set(['derived-node']),
    );
  });

  it('runs Undo and Redo commands through the node history endpoints', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.undoNode.mockResolvedValue({ data: { id: 'node-1' } });
    workspaceSdkMock.redoNode.mockResolvedValue({ data: { id: 'node-1' } });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.undoNode('node-1');
      await result.current.actions.redoNode('node-1');
    });

    expect(workspaceSdkMock.undoNode).toHaveBeenCalledWith({
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
    expect(workspaceSdkMock.redoNode).toHaveBeenCalledWith({
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workspaces', 'ws-1', 'graph'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workspaces', 'ws-1', 'nodes', 'node-1', 'schema'],
    });
    expect(invalidateQueries.mock.calls.some(([options]) => 'predicate' in options)).toBe(true);
  });

  it('submits a tab-owned Concordance Run All group', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.submitTabAnalysis.mockResolvedValue({ data: { id: 'run-all-1' } });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.runConcordanceAll('tab-1', {
        source: {
          kind: 'concordance',
          node_ids: ['node-1'],
          node_columns: { 'node-1': 'text' },
          node_tokenizer_models: {},
          search_word: 'word',
          num_left_tokens: 5,
          num_right_tokens: 5,
          regex: false,
          whole_word: true,
          case_sensitive: false,
          search_mode: 'regex',
        },
      });
    });

    expect(workspaceSdkMock.submitTabAnalysis).toHaveBeenCalledWith({
      body: {
        execution_scope: 'run_all',
        request: expect.objectContaining({
          kind: 'concordance_run_all',
          source: expect.objectContaining({ node_ids: ['node-1'] }),
        }),
        supersedes_analysis_ids: [],
      },
      path: { workspace_id: 'ws-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
  });

  it('submits Result Data Block Creation without treating queue admission as graph creation', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.submitTabAnalysis.mockResolvedValue({ data: { id: 'creation-1' } });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.createResultDataBlocks('tab-1', 'run-all-1', {
        kind: 'concordance_match_data_block_creation',
        sources: [
          {
            source_node_id: 'node-1',
            selected_columns: ['text', 'CONC_matched_text'],
            new_node_name: 'Matches',
          },
        ],
      });
    });

    expect(workspaceSdkMock.submitTabAnalysis).toHaveBeenCalledWith({
      body: {
        execution_scope: 'supporting',
        parent_analysis_id: 'run-all-1',
        request: {
          kind: 'concordance_match_data_block_creation',
          sources: [
            {
              source_node_id: 'node-1',
              selected_columns: ['text', 'CONC_matched_text'],
              new_node_name: 'Matches',
            },
          ],
        },
      },
      path: { workspace_id: 'ws-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['workspaces', 'ws-1', 'graph'],
    });
  });

  it('submits Topic Modeling Data Block Creation as one typed multi-source child', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.submitTabAnalysis.mockResolvedValue({ data: { id: 'child-topics' } });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.createTopicModelingDataBlocks('tab-1', 'analysis-1', {
        node_ids: ['node-1', 'node-2'],
        selected_columns: { 'node-1': ['text'], 'node-2': ['text'] },
        new_node_names: { 'node-1': 'First topics', 'node-2': 'Second topics' },
        topic_ids: [1, 3],
        topic_meanings_override: [{ topic_id: 1, words: ['word'] }],
      });
    });

    expect(workspaceSdkMock.submitTabAnalysis).toHaveBeenCalledWith({
      body: {
        execution_scope: 'supporting',
        parent_analysis_id: 'analysis-1',
        request: {
          kind: 'topic_modeling_data_block_creation',
          node_ids: ['node-1', 'node-2'],
          selected_columns: { 'node-1': ['text'], 'node-2': ['text'] },
          new_node_names: { 'node-1': 'First topics', 'node-2': 'Second topics' },
          topic_ids: [1, 3],
          topic_meanings_override: [{ topic_id: 1, words: ['word'] }],
        },
      },
      path: { workspace_id: 'ws-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
  });

  it('submits manual Annotation changes through Data Block edits', async () => {
    const queryClient = createTestClient();
    workspaceSdkMock.editNode.mockResolvedValue({ data: { id: 'node-1' } });
    const { result } = renderHook(() => useWorkspaceNodeMutations(buildArgs(queryClient)), {
      wrapper: wrapWithClient(queryClient),
    });

    await act(async () => {
      await result.current.actions.setCell('node-1', 'label', 4, 'positive');
      await result.current.actions.saveAnnotationClasses('node-1', 'class', 'description', [
        { class_name: 'positive', description: 'Positive stance' },
      ]);
    });

    expect(workspaceSdkMock.editNode).toHaveBeenNthCalledWith(1, {
      body: {
        kind: 'set_cell',
        column: 'label',
        row_index: 4,
        value: 'positive',
      },
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
    expect(workspaceSdkMock.editNode).toHaveBeenNthCalledWith(2, {
      body: {
        kind: 'annotation_classes',
        class_column: 'class',
        description_column: 'description',
        rows: [{ class_name: 'positive', description: 'Positive stance' }],
      },
      path: { workspace_id: 'ws-1', node_id: 'node-1' },
      throwOnError: true,
    });
  });
});
