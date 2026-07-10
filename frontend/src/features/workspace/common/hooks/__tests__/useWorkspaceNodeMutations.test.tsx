import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- API mocks ---------------------------------------------------

/** Hoisted generated-SDK mock lets mutation actions be verified without HTTP. */
const workspaceSdkMock = vi.hoisted(() => ({
  addNodeToWorkspace: vi.fn(),
  castNode: vi.fn(),
  cloneNode: vi.fn(),
  concatNodes: vi.fn(),
  concatNodesPreview: vi.fn(),
  createAnalysisTaskDetachment: vi.fn(),
  createAnalysisTaskDispersionDetachment: vi.fn(),
  createAnalysisTaskMaterialization: vi.fn(),
  createWorkspace: vi.fn(),
  deleteNode: vi.fn(),
  deleteNodeColumn: vi.fn(),
  deleteWorkspaceById: vi.fn(),
  filterNode: vi.fn(),
  filterPreview: vi.fn(),
  getQuotation: vi.fn(),
  joinNodes: vi.fn(),
  listWorkspaces: vi.fn(),
  polarsExpressionApply: vi.fn(),
  polarsExpressionPreview: vi.fn(),
  redoNodeOperation: vi.fn(),
  renameNodeColumn: vi.fn(),
  replaceApply: vi.fn(),
  replacePreview: vi.fn(),
  saveWorkspaceById: vi.fn(),
  setMyCurrentWorkspace: vi.fn(),
  sliceNode: vi.fn(),
  slicePreview: vi.fn(),
  undoNodeOperation: vi.fn(),
  updateNodeName: vi.fn(),
  updateWorkspaceById: vi.fn(),
}));

/** Hoisted node-info mock isolates schema refresh behavior from network I/O. */
const fetchNodeInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/generated/sdk.gen', () => workspaceSdkMock);
vi.mock('@/lib/nodeInfo', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchNodeInfo: fetchNodeInfoMock,
  };
});

// Import AFTER the mocks are registered.
import { useWorkspaceNodeMutations } from '../useWorkspaceNodeMutations';

// ---------- Wrapper helpers --------------------------------------------

/**
 * Creates a no-retry QueryClient for deterministic mutation-hook tests.
 * Used by: Vitest setup or assertions in workspace/useWorkspaceNodeMutations.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
const createTestClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

/**
 * Wraps hook renders with the query client under test.
 * Used by: Vitest setup or assertions in workspace/useWorkspaceNodeMutations.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
const wrapWithClient = (client: QueryClient) => {
  /**
   * Provides the caller's QueryClient to the mutation hook render.
   * Used by: Vitest setup or assertions in workspace/useWorkspaceNodeMutations.
   * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
   */
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

// Narrowly-typed mock factories so the args object satisfies
// WorkspaceNodeMutationsParams without `as any` casts.
type SetWorkspaceIdSpy = ReturnType<typeof vi.fn> & ((workspaceId: string | null) => void);
type ReplaceSelectedNodesSpy = ReturnType<typeof vi.fn> &
  ((nodeIds: string[], activeNodeId?: string | null) => void);
type RemoveNodeSpy = ReturnType<typeof vi.fn> & ((nodeId: string) => void);
type ClearSelectionSpy = ReturnType<typeof vi.fn> & (() => void);
type OperationFnSpy = ReturnType<typeof vi.fn> & ((operationId: string) => void);

/**
 * Creates a typed current-workspace setter spy for hook args.
 * Used by: Vitest setup or assertions in workspace/useWorkspaceNodeMutations.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
const mkSetWorkspaceId = () => vi.fn() as unknown as SetWorkspaceIdSpy;
/**
 * Creates a typed selected-nodes setter spy for hook args.
 * Used by: Vitest setup or assertions in workspace/useWorkspaceNodeMutations.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
const mkReplaceSelectedNodes = () => vi.fn() as unknown as ReplaceSelectedNodesSpy;
const mkRemoveNode = () => vi.fn() as unknown as RemoveNodeSpy;
/**
 * Creates a typed selection-clear spy for hook args.
 * Used by: Vitest setup or assertions in workspace/useWorkspaceNodeMutations.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
const mkClearSelection = () => vi.fn() as unknown as ClearSelectionSpy;
/**
 * Creates a typed operation lifecycle spy for hook args.
 * Used by: Vitest setup or assertions in workspace/useWorkspaceNodeMutations.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
const mkOperationFn = () => vi.fn() as unknown as OperationFnSpy;
interface BuildArgs {
  currentWorkspaceId?: string | null;
  setCurrentWorkspaceId?: SetWorkspaceIdSpy;
  removeNode?: RemoveNodeSpy;
  replaceSelectedNodes?: ReplaceSelectedNodesSpy;
  clearSelection?: ClearSelectionSpy;
  startOperation?: OperationFnSpy;
  endOperation?: OperationFnSpy;
}

/**
 * Builds hook params while preserving explicit null workspace test cases.
 * Used by: Vitest setup or assertions in workspace/useWorkspaceNodeMutations.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 * Flow: merge default spies and ids with overrides, preserving explicit nulls for no-workspace branches.
 */
const buildHookArgs = (queryClient: QueryClient, overrides: BuildArgs = {}) => ({
  // `'currentWorkspaceId' in overrides` so callers can pass `null` to test
  // the no-workspace-selected branches; `?? 'ws-1'` would silently coerce
  // nullish overrides back to 'ws-1'. The cast preserves the
  // `WorkspaceNodeMutationsParams` shape (which doesn't allow undefined).
  currentWorkspaceId: ('currentWorkspaceId' in overrides ? overrides.currentWorkspaceId : 'ws-1') as
    | string
    | null,
  setCurrentWorkspaceId: overrides.setCurrentWorkspaceId ?? mkSetWorkspaceId(),
  removeNode: overrides.removeNode ?? mkRemoveNode(),
  replaceSelectedNodes: overrides.replaceSelectedNodes ?? mkReplaceSelectedNodes(),
  clearSelection: overrides.clearSelection ?? mkClearSelection(),
  queryClient,
  startOperation: overrides.startOperation ?? mkOperationFn(),
  endOperation: overrides.endOperation ?? mkOperationFn(),
});

describe('useWorkspaceNodeMutations', () => {
  beforeEach(() => {
    Object.values(workspaceSdkMock).forEach((value) => {
      if (typeof value === 'function') (value as ReturnType<typeof vi.fn>).mockReset();
    });
    fetchNodeInfoMock.mockReset();
  });

  describe('actions shape and stability', () => {
    it('memoizes actions across re-renders when currentWorkspaceId stays stable', () => {
      const queryClient = createTestClient();
      const args = buildHookArgs(queryClient);

      const { result, rerender } = renderHook(
        (props: ReturnType<typeof buildHookArgs>) => useWorkspaceNodeMutations(props),
        { wrapper: wrapWithClient(queryClient), initialProps: args },
      );

      const firstActions = result.current.actions;
      rerender(args);
      expect(result.current.actions).toBe(firstActions);
    });

  });

  describe('createWorkspace', () => {
    it('calls generated createWorkspace and invalidates the workspaces list', async () => {
      const queryClient = createTestClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const startOperation = mkOperationFn();
      const endOperation = mkOperationFn();
      workspaceSdkMock.createWorkspace.mockResolvedValue({
        data: { id: 'ws-new' },
        error: undefined,
      });

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(buildHookArgs(queryClient, { startOperation, endOperation })),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.createWorkspace('My ws', 'desc');
      });

      expect(workspaceSdkMock.createWorkspace).toHaveBeenCalledWith({
        body: { name: 'My ws', description: 'desc' },
        throwOnError: true,
      });
      expect(startOperation).toHaveBeenCalledWith('createWorkspace');
      expect(endOperation).toHaveBeenCalledWith('createWorkspace');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaces'] });
    });

    it('ends operation loading when an API mutation rejects', async () => {
      const queryClient = createTestClient();
      const endOperation = mkOperationFn();
      workspaceSdkMock.createWorkspace.mockRejectedValue(new Error('server down'));

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { endOperation }),
          ),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.createWorkspace('ws', 'd').catch(() => undefined);
      });

      expect(endOperation).toHaveBeenCalledWith('createWorkspace');
    });
  });

  describe('setCurrentWorkspace', () => {
    it('writes the new id to the selectionStore setter and clears node selection', async () => {
      const queryClient = createTestClient();
      workspaceSdkMock.setMyCurrentWorkspace.mockResolvedValue({
        data: { state: 'successful', id: 'ws-2' },
        error: undefined,
      });
      const setCurrentWorkspaceId = mkSetWorkspaceId();
      const clearSelection = mkClearSelection();

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { setCurrentWorkspaceId, clearSelection }),
          ),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.setCurrentWorkspace('ws-2');
      });

      expect(workspaceSdkMock.setMyCurrentWorkspace).toHaveBeenCalledWith({
        body: { workspace_id: 'ws-2' },
        throwOnError: true,
      });
      expect(setCurrentWorkspaceId).toHaveBeenCalledWith('ws-2');
      expect(clearSelection).toHaveBeenCalled();
    });
  });

  describe('deleteWorkspace', () => {
    it('clears the selection when the deleted workspace is the active one', async () => {
      const queryClient = createTestClient();
      const setCurrentWorkspaceId = mkSetWorkspaceId();
      const clearSelection = mkClearSelection();
      workspaceSdkMock.deleteWorkspaceById.mockResolvedValue({
        data: { id: 'ws-1' },
        error: undefined,
      });

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, {
              currentWorkspaceId: 'ws-1',
              setCurrentWorkspaceId,
              clearSelection,
            }),
          ),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.deleteWorkspace('ws-1');
      });

      expect(workspaceSdkMock.deleteWorkspaceById).toHaveBeenCalledWith({
        path: { workspace_id: 'ws-1' },
        throwOnError: true,
      });
      expect(setCurrentWorkspaceId).toHaveBeenCalledWith(null);
      expect(clearSelection).toHaveBeenCalled();
    });

    it('rejects when called with an empty id', async () => {
      const queryClient = createTestClient();
      const { result } = renderHook(() => useWorkspaceNodeMutations(buildHookArgs(queryClient)), {
        wrapper: wrapWithClient(queryClient),
      });

      await expect(result.current.actions.deleteWorkspace('   ')).rejects.toThrow(
        /workspaceId is required/,
      );
      expect(workspaceSdkMock.deleteWorkspaceById).not.toHaveBeenCalled();
    });
  });

  describe('refreshNodeSchema', () => {
    it('returns null when no workspace is selected without calling fetchNodeInfo', async () => {
      const queryClient = createTestClient();
      const { result } = renderHook(
        () => useWorkspaceNodeMutations(buildHookArgs(queryClient, { currentWorkspaceId: null })),
        { wrapper: wrapWithClient(queryClient) },
      );

      const schema = await result.current.actions.refreshNodeSchema('node-1');
      expect(schema).toBeNull();
      expect(fetchNodeInfoMock).not.toHaveBeenCalled();
    });

    it('returns null when the node is not present in the workspace graph cache', async () => {
      const queryClient = createTestClient();
      queryClient.setQueryData(['workspaces', 'ws-1', 'graph'], {
        nodes: [{ id: 'node-other' }],
      });
      const { result } = renderHook(() => useWorkspaceNodeMutations(buildHookArgs(queryClient)), {
        wrapper: wrapWithClient(queryClient),
      });

      const schema = await result.current.actions.refreshNodeSchema('node-missing');
      expect(schema).toBeNull();
      expect(fetchNodeInfoMock).not.toHaveBeenCalled();
    });

    it('fetches with force=true and normalises the response into NodeSchemaResponse', async () => {
      const queryClient = createTestClient();
      queryClient.setQueryData(['workspaces', 'ws-1', 'graph'], {
        nodes: [{ id: 'node-1' }],
      });
      fetchNodeInfoMock.mockResolvedValue({ schema: { col_a: 'string', col_b: 'integer' } });

      const { result } = renderHook(() => useWorkspaceNodeMutations(buildHookArgs(queryClient)), {
        wrapper: wrapWithClient(queryClient),
      });

      const schema = await result.current.actions.refreshNodeSchema('node-1');

      expect(fetchNodeInfoMock).toHaveBeenCalledWith({
        queryClient,
        workspaceId: 'ws-1',
        nodeId: 'node-1',
        force: true,
      });
      expect(schema).toEqual({
        node_id: 'node-1',
        schema: { col_a: 'string', col_b: 'integer' },
        columns: ['col_a', 'col_b'],
        column_types: { col_a: 'string', col_b: 'integer' },
        is_text_data: false,
      });
    });
  });

  describe('castColumn', () => {
    it('invalidates the workspace graph + node-data + node-info keys on success', async () => {
      const queryClient = createTestClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      workspaceSdkMock.castNode.mockResolvedValue({ data: {}, error: undefined });

      const { result } = renderHook(() => useWorkspaceNodeMutations(buildHookArgs(queryClient)), {
        wrapper: wrapWithClient(queryClient),
      });

      await act(async () => {
        await result.current.actions.castColumn('node-1', 'col_a', 'integer');
      });

      expect(workspaceSdkMock.castNode).toHaveBeenCalledWith({
        body: { column: 'col_a', target_type: 'integer', format: undefined },
        path: { workspace_id: 'ws-1', node_id: 'node-1' },
        throwOnError: true,
      });

      const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]);
      expect(invalidatedKeys).toEqual(
        expect.arrayContaining([
          { queryKey: ['workspaces', 'ws-1', 'graph'] },
          expect.objectContaining({ queryKey: ['workspaces', 'ws-1', 'nodes', 'node-1', 'data'] }),
        ]),
      );
      const nodeInfoInvalidation = invalidatedKeys.find(
        (options): options is { predicate: (query: { queryKey: readonly unknown[] }) => boolean } =>
          typeof options === 'object' && 'predicate' in options,
      );
      expect(nodeInfoInvalidation).toBeDefined();
      if (!nodeInfoInvalidation) throw new Error('node-info invalidation was not recorded');
      const { predicate } = nodeInfoInvalidation;
      expect(predicate({ queryKey: ['workspaces', 'ws-1', 'nodes', 'node-1', 'info'] })).toBe(true);
      expect(
        predicate({ queryKey: ['workspaces', 'ws-1', 'nodes', 'info', 'batch', 'node-1'] }),
      ).toBe(true);
      expect(predicate({ queryKey: ['workspaces', 'ws-1', 'nodes', 'node-2', 'info'] })).toBe(false);
    });
  });

  describe('deleteNode', () => {
    it('removes active and non-active deleted nodes through the same semantic action', async () => {
      const queryClient = createTestClient();
      const removeNode = mkRemoveNode();
      workspaceSdkMock.deleteNode.mockResolvedValue({ data: {}, error: undefined });

      const { result } = renderHook(
        () => useWorkspaceNodeMutations(buildHookArgs(queryClient, { removeNode })),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.deleteNode('node-1');
      });
      await act(async () => {
        await result.current.actions.deleteNode('node-other');
      });

      expect(removeNode).toHaveBeenNthCalledWith(1, 'node-1');
      expect(removeNode).toHaveBeenNthCalledWith(2, 'node-other');
    });
  });

  describe('combined-node mutations', () => {
    it('maps the request workspace and exact signal to concatNodesPreview', async () => {
      const queryClient = createTestClient();
      const signal = new AbortController().signal;
      workspaceSdkMock.concatNodesPreview.mockResolvedValue({
        data: { data: [], columns: [], pagination: null },
        error: undefined,
      });

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { currentWorkspaceId: 'closure-workspace' }),
          ),
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

      expect(workspaceSdkMock.concatNodesPreview).toHaveBeenCalledWith({
        body: { node_ids: ['node-a', 'node-b'], deduplicate: true },
        path: { workspace_id: 'request-workspace' },
        query: { page: 2, page_size: 25 },
        signal,
        throwOnError: true,
      });
    });

    it('selects the id returned by joinNodes', async () => {
      const queryClient = createTestClient();
      const replaceSelectedNodes = mkReplaceSelectedNodes();
      const clearSelection = mkClearSelection();
      workspaceSdkMock.joinNodes.mockResolvedValue({
        data: { id: 'joined-node' },
        error: undefined,
      });

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { clearSelection, replaceSelectedNodes }),
          ),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.joinNodes(
          'left-node',
          'right-node',
          'inner',
          ['left_id'],
          ['right_id'],
          'Joined',
        );
      });

      expect(workspaceSdkMock.joinNodes).toHaveBeenCalledWith({
        path: { workspace_id: 'ws-1' },
        query: {
          left_node_id: 'left-node',
          right_node_id: 'right-node',
          left_on: 'left_id',
          right_on: 'right_id',
          how: 'inner',
          new_node_name: 'Joined',
        },
        throwOnError: true,
      });
      expect(clearSelection).toHaveBeenCalled();
      expect(replaceSelectedNodes).toHaveBeenCalledWith(['joined-node'], 'joined-node');
    });

    it('selects the id returned by concatNodes', async () => {
      const queryClient = createTestClient();
      const replaceSelectedNodes = mkReplaceSelectedNodes();
      const clearSelection = mkClearSelection();
      workspaceSdkMock.concatNodes.mockResolvedValue({
        data: { id: 'concat-node' },
        error: undefined,
      });

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { clearSelection, replaceSelectedNodes }),
          ),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.concatNodes(['node-a', 'node-b'], 'Combined', true);
      });

      expect(workspaceSdkMock.concatNodes).toHaveBeenCalledWith({
        body: {
          node_ids: ['node-a', 'node-b'],
          new_node_name: 'Combined',
          deduplicate: true,
        },
        path: { workspace_id: 'ws-1' },
        throwOnError: true,
      });
      expect(clearSelection).toHaveBeenCalled();
      expect(replaceSelectedNodes).toHaveBeenCalledWith(['concat-node'], 'concat-node');
    });
  });

  describe('text-analysis actions', () => {
    it('detachConcordance synchronously throws when no workspace is selected', () => {
      // ensureWorkspaceSelected runs while building the mutateAsync args, so
      // the failure surfaces as a synchronous throw rather than a rejected
      // promise — keep this assertion tight (() => …) instead of awaiting.
      const queryClient = createTestClient();
      const { result } = renderHook(
        () => useWorkspaceNodeMutations(buildHookArgs(queryClient, { currentWorkspaceId: null })),
        { wrapper: wrapWithClient(queryClient) },
      );

      expect(() =>
        result.current.actions.detachConcordance('node-1', {
          node_id: 'node-1',
          column: 'c',
          search_word: 'w',
          selected_columns: ['c'],
        }),
      ).toThrow(/No workspace selected/);
      expect(workspaceSdkMock.createAnalysisTaskDetachment).not.toHaveBeenCalled();
    });

    it('detachConcordance forwards through generated SDK and invalidates the workspace graph', async () => {
      const queryClient = createTestClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      workspaceSdkMock.createAnalysisTaskDetachment.mockResolvedValue({
        data: {},
        error: undefined,
      });

      const { result } = renderHook(() => useWorkspaceNodeMutations(buildHookArgs(queryClient)), {
        wrapper: wrapWithClient(queryClient),
      });

      await act(async () => {
        await result.current.actions.detachConcordance('task-1', {
          node_id: 'node-1',
          column: 'c',
          search_word: 'w',
          selected_columns: ['c'],
        });
      });

      expect(workspaceSdkMock.createAnalysisTaskDetachment).toHaveBeenCalledWith({
        body: { node_id: 'node-1', column: 'c', search_word: 'w', selected_columns: ['c'] },
        path: { workspace_id: 'ws-1', task_id: 'task-1' },
        throwOnError: true,
      });

      const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]);
      expect(invalidatedKeys).toEqual(
        expect.arrayContaining([{ queryKey: ['workspaces', 'ws-1', 'graph'] }]),
      );
    });

    it('quotationSearch forwards through generated SDK with the active workspace', async () => {
      const queryClient = createTestClient();
      workspaceSdkMock.getQuotation.mockResolvedValue({ data: { rows: [] }, error: undefined });

      const { result } = renderHook(() => useWorkspaceNodeMutations(buildHookArgs(queryClient)), {
        wrapper: wrapWithClient(queryClient),
      });

      await act(async () => {
        await result.current.actions.quotationSearch('node-1', { column: 'c' });
      });

      expect(workspaceSdkMock.getQuotation).toHaveBeenCalledWith({
        body: { column: 'c' },
        path: { workspace_id: 'ws-1', node_id: 'node-1' },
        throwOnError: true,
      });
    });
  });
});
