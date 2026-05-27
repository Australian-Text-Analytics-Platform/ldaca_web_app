import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- API mocks ---------------------------------------------------

const workspaceSdkMock = vi.hoisted(() => ({
  addNodeToWorkspace: vi.fn(),
  castNode: vi.fn(),
  cloneNode: vi.fn(),
  concatNodes: vi.fn(),
  concatNodesPreview: vi.fn(),
  createWorkspace: vi.fn(),
  deleteNode: vi.fn(),
  deleteNodeColumn: vi.fn(),
  deleteWorkspace: vi.fn(),
  detachConcordance: vi.fn(),
  detachConcordanceDispersion: vi.fn(),
  detachQuotation: vi.fn(),
  filterNode: vi.fn(),
  filterPreview: vi.fn(),
  getQuotation: vi.fn(),
  joinNodes: vi.fn(),
  listWorkspaces: vi.fn(),
  materializeConcordance: vi.fn(),
  materializeQuotation: vi.fn(),
  polarsExpressionApply: vi.fn(),
  polarsExpressionPreview: vi.fn(),
  renameWorkspace: vi.fn(),
  redoNodeOperation: vi.fn(),
  renameNodeColumn: vi.fn(),
  replaceApply: vi.fn(),
  replacePreview: vi.fn(),
  saveWorkspace: vi.fn(),
  setCurrentWorkspace: vi.fn(),
  sliceNode: vi.fn(),
  slicePreview: vi.fn(),
  undoNodeOperation: vi.fn(),
  updateNodeName: vi.fn(),
  updateWorkspaceDescription: vi.fn(),
}));

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

const createTestClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

const wrapWithClient = (client: QueryClient): React.FC<{ children: React.ReactNode }> => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

// Narrowly-typed mock factories so the args object satisfies
// WorkspaceNodeMutationsParams without `as any` casts.
type SetWorkspaceIdSpy = ReturnType<typeof vi.fn> & ((workspaceId: string | null) => void);
type SetSelectedNodesSpy = ReturnType<typeof vi.fn> & ((nodeIds: string[]) => void);
type ClearSelectionSpy = ReturnType<typeof vi.fn> & (() => void);
type OperationFnSpy = ReturnType<typeof vi.fn> & ((operationId: string) => void);
type OperationErrorSpy = ReturnType<typeof vi.fn> & ((operationId: string, error: string) => void);

const mkSetWorkspaceId = () => vi.fn() as unknown as SetWorkspaceIdSpy;
const mkSetSelectedNodes = () => vi.fn() as unknown as SetSelectedNodesSpy;
const mkClearSelection = () => vi.fn() as unknown as ClearSelectionSpy;
const mkOperationFn = () => vi.fn() as unknown as OperationFnSpy;
const mkOperationError = () => vi.fn() as unknown as OperationErrorSpy;

interface BuildArgs {
  authHeaders?: Record<string, string>;
  currentWorkspaceId?: string | null;
  selectedNodeId?: string | null;
  setCurrentWorkspaceId?: SetWorkspaceIdSpy;
  setSelectedNodes?: SetSelectedNodesSpy;
  clearSelection?: ClearSelectionSpy;
  startOperation?: OperationFnSpy;
  endOperation?: OperationFnSpy;
  setOperationError?: OperationErrorSpy;
}

const buildHookArgs = (queryClient: QueryClient, overrides: BuildArgs = {}) => ({
  authHeaders: overrides.authHeaders ?? { Authorization: 'Bearer test' },
  // `'currentWorkspaceId' in overrides` so callers can pass `null` to test
  // the no-workspace-selected branches; `?? 'ws-1'` would silently coerce
  // nullish overrides back to 'ws-1'. The cast preserves the
  // `WorkspaceNodeMutationsParams` shape (which doesn't allow undefined).
  currentWorkspaceId: ('currentWorkspaceId' in overrides
    ? overrides.currentWorkspaceId
    : 'ws-1') as string | null,
  selectedNodeId: overrides.selectedNodeId ?? null,
  setCurrentWorkspaceId: overrides.setCurrentWorkspaceId ?? mkSetWorkspaceId(),
  setSelectedNodes: overrides.setSelectedNodes ?? mkSetSelectedNodes(),
  clearSelection: overrides.clearSelection ?? mkClearSelection(),
  queryClient,
  startOperation: overrides.startOperation ?? mkOperationFn(),
  endOperation: overrides.endOperation ?? mkOperationFn(),
  setOperationError: overrides.setOperationError ?? mkOperationError(),
});

describe('useWorkspaceNodeMutations', () => {
  beforeEach(() => {
    Object.values(workspaceSdkMock).forEach((value) => {
      if (typeof value === 'function') (value as ReturnType<typeof vi.fn>).mockReset();
    });
    fetchNodeInfoMock.mockReset();
  });

  describe('actions shape and stability', () => {
    it('returns the full set of node-mutation actions, all callable', () => {
      const queryClient = createTestClient();
      const { result } = renderHook(
        () => useWorkspaceNodeMutations(buildHookArgs(queryClient)),
        { wrapper: wrapWithClient(queryClient) },
      );

      const expectedKeys = [
        'setCurrentWorkspace',
        'createWorkspace',
        'deleteWorkspace',
        'saveWorkspace',
        'renameWorkspace',
        'updateWorkspaceDescription',
        'renameNode',
        'undoNode',
        'redoNode',
        'copyNode',
        'deleteNode',
        'createNodeFromFile',
        'joinNodes',
        'concatNodes',
        'concatPreview',
        'filterNode',
        'filterPreview',
        'sliceNode',
        'slicePreview',
        'replaceText',
        'replaceTextPreview',
        'polarsExpressionPreview',
        'polarsExpressionApply',
        'castColumn',
        'renameColumn',
        'deleteColumn',
        'refreshNodeSchema',
        // Phase 4.8: text-analysis actions moved here from useWorkspaceInternal.
        'detachConcordance',
        'materializeConcordance',
        'quotationSearch',
        'detachQuotation',
        'materializeQuotation',
      ];

      const { actions } = result.current;
      for (const key of expectedKeys) {
        expect(typeof (actions as Record<string, unknown>)[key]).toBe('function');
      }
    });

    it('memoizes actions across re-renders when authHeaders + currentWorkspaceId stay stable', () => {
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

    it('rebuilds actions when authHeaders identity changes', () => {
      const queryClient = createTestClient();
      const args = buildHookArgs(queryClient, { authHeaders: { Authorization: 'Bearer A' } });

      const { result, rerender } = renderHook(
        (props: ReturnType<typeof buildHookArgs>) => useWorkspaceNodeMutations(props),
        { wrapper: wrapWithClient(queryClient), initialProps: args },
      );

      const firstActions = result.current.actions;
      rerender({ ...args, authHeaders: { Authorization: 'Bearer B' } });
      expect(result.current.actions).not.toBe(firstActions);
    });
  });

  describe('createWorkspace', () => {
    it('calls generated createWorkspace with the auth headers and invalidates the workspaces list', async () => {
      const queryClient = createTestClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const startOperation = mkOperationFn();
      const endOperation = mkOperationFn();
      workspaceSdkMock.createWorkspace.mockResolvedValue({ data: { id: 'ws-new' }, error: undefined });

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { startOperation, endOperation }),
          ),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.createWorkspace('My ws', 'desc');
      });

      expect(workspaceSdkMock.createWorkspace).toHaveBeenCalledWith({
        body: { name: 'My ws', description: 'desc' },
        headers: { Authorization: 'Bearer test' },
        throwOnError: true,
      });
      expect(startOperation).toHaveBeenCalledWith('createWorkspace');
      expect(endOperation).toHaveBeenCalledWith('createWorkspace');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaces'] });
    });

    it('routes API errors through setOperationError + endOperation', async () => {
      const queryClient = createTestClient();
      const setOperationError = mkOperationError();
      const endOperation = mkOperationFn();
      workspaceSdkMock.createWorkspace.mockRejectedValue(new Error('server down'));

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { setOperationError, endOperation }),
          ),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions
          .createWorkspace('ws', 'd')
          .catch(() => undefined);
      });

      expect(setOperationError).toHaveBeenCalledWith('createWorkspace', 'server down');
      expect(endOperation).toHaveBeenCalledWith('createWorkspace');
    });
  });

  describe('setCurrentWorkspace', () => {
    it('writes the new id to the selectionStore setter and clears node selection', async () => {
      // Phase 4.1: the mutation no longer writes to the
      // `['workspaces','current']` query cache — the selectionStore is
      // canonical and the server query is one-shot bootstrap.
      const queryClient = createTestClient();
      workspaceSdkMock.setCurrentWorkspace.mockResolvedValue({ data: { state: 'successful', id: 'ws-2' }, error: undefined });
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

      expect(workspaceSdkMock.setCurrentWorkspace).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer test' },
        query: { workspace_id: 'ws-2' },
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
      workspaceSdkMock.deleteWorkspace.mockResolvedValue({ data: { id: 'ws-1' }, error: undefined });

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

      expect(setCurrentWorkspaceId).toHaveBeenCalledWith(null);
      expect(clearSelection).toHaveBeenCalled();
    });

    it('rejects when called with an empty id', async () => {
      const queryClient = createTestClient();
      const { result } = renderHook(
        () => useWorkspaceNodeMutations(buildHookArgs(queryClient)),
        { wrapper: wrapWithClient(queryClient) },
      );

      await expect(result.current.actions.deleteWorkspace('   ')).rejects.toThrow(
        /workspaceId is required/,
      );
      expect(workspaceSdkMock.deleteWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('refreshNodeSchema', () => {
    it('returns null when no workspace is selected without calling fetchNodeInfo', async () => {
      const queryClient = createTestClient();
      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { currentWorkspaceId: null }),
          ),
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
      const { result } = renderHook(
        () => useWorkspaceNodeMutations(buildHookArgs(queryClient)),
        { wrapper: wrapWithClient(queryClient) },
      );

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

      const { result } = renderHook(
        () => useWorkspaceNodeMutations(buildHookArgs(queryClient)),
        { wrapper: wrapWithClient(queryClient) },
      );

      const schema = await result.current.actions.refreshNodeSchema('node-1');

      expect(fetchNodeInfoMock).toHaveBeenCalledWith({
        queryClient,
        workspaceId: 'ws-1',
        nodeId: 'node-1',
        headers: { Authorization: 'Bearer test' },
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
    it('invalidates the workspace graph + node-data + node-schema keys on success', async () => {
      const queryClient = createTestClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      workspaceSdkMock.castNode.mockResolvedValue({ data: {}, error: undefined });

      const { result } = renderHook(
        () => useWorkspaceNodeMutations(buildHookArgs(queryClient)),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.castColumn('node-1', 'col_a', 'integer');
      });

      expect(workspaceSdkMock.castNode).toHaveBeenCalledWith({
        body: { column: 'col_a', target_type: 'integer', format: undefined },
        headers: { Authorization: 'Bearer test' },
        path: { node_id: 'node-1' },
        throwOnError: true,
      });

      const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]);
      expect(invalidatedKeys).toEqual(
        expect.arrayContaining([
          { queryKey: ['workspaces', 'ws-1', 'graph'] },
          expect.objectContaining({ queryKey: ['workspaces', 'ws-1', 'nodes', 'node-1', 'data'] }),
          { queryKey: ['workspaces', 'ws-1', 'nodes', 'node-1', 'schema'] },
        ]),
      );
    });
  });

  describe('deleteNode', () => {
    it('clears selection only when the deleted node was the selected one', async () => {
      const queryClient = createTestClient();
      const clearSelection = mkClearSelection();
      workspaceSdkMock.deleteNode.mockResolvedValue({ data: {}, error: undefined });

      const { result, rerender } = renderHook(
        (props: ReturnType<typeof buildHookArgs>) => useWorkspaceNodeMutations(props),
        {
          wrapper: wrapWithClient(queryClient),
          initialProps: buildHookArgs(queryClient, {
            selectedNodeId: 'node-1',
            clearSelection,
          }),
        },
      );

      await act(async () => {
        await result.current.actions.deleteNode('node-1');
      });
      expect(clearSelection).toHaveBeenCalledTimes(1);

      // Re-render with a different selected node — deleting an unrelated node
      // must NOT touch selection.
      const clearSelection2 = vi.fn();
      rerender(
        buildHookArgs(queryClient, {
          selectedNodeId: 'node-1',
          clearSelection: clearSelection2,
        }),
      );

      await act(async () => {
        await result.current.actions.deleteNode('node-other');
      });
      expect(clearSelection2).not.toHaveBeenCalled();
    });
  });

  describe('text-analysis actions (Phase 4.8 move)', () => {
    it('detachConcordance synchronously throws when no workspace is selected', () => {
      // ensureWorkspaceSelected runs while building the mutateAsync args, so
      // the failure surfaces as a synchronous throw rather than a rejected
      // promise — keep this assertion tight (() => …) instead of awaiting.
      const queryClient = createTestClient();
      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { currentWorkspaceId: null }),
          ),
        { wrapper: wrapWithClient(queryClient) },
      );

      expect(() =>
        result.current.actions.detachConcordance('node-1', {
          node_id: 'node-1',
          column: 'c',
          search_word: 'w',
        }),
      ).toThrow(/No workspace selected/);
      expect(workspaceSdkMock.detachConcordance).not.toHaveBeenCalled();
    });

    it('detachConcordance forwards through generated SDK and invalidates the workspace graph', async () => {
      const queryClient = createTestClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      workspaceSdkMock.detachConcordance.mockResolvedValue({ data: {}, error: undefined });

      const { result } = renderHook(
        () => useWorkspaceNodeMutations(buildHookArgs(queryClient)),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.detachConcordance('node-1', {
          node_id: 'node-1',
          column: 'c',
          search_word: 'w',
        });
      });

      expect(workspaceSdkMock.detachConcordance).toHaveBeenCalledWith({
        body: { node_id: 'node-1', column: 'c', search_word: 'w' },
        headers: { Authorization: 'Bearer test' },
        path: { node_id: 'node-1' },
        throwOnError: true,
      });

      const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]);
      expect(invalidatedKeys).toEqual(
        expect.arrayContaining([{ queryKey: ['workspaces', 'ws-1', 'graph'] }]),
      );
    });

    it('quotationSearch forwards through generated SDK without requiring a workspace', async () => {
      // quotationSearch (and the materialize variants) deliberately don't
      // call ensureWorkspaceSelected — the backend route is node-scoped, so
      // a node id is enough.
      const queryClient = createTestClient();
      workspaceSdkMock.getQuotation.mockResolvedValue({ data: { rows: [] }, error: undefined });

      const { result } = renderHook(
        () =>
          useWorkspaceNodeMutations(
            buildHookArgs(queryClient, { currentWorkspaceId: null }),
          ),
        { wrapper: wrapWithClient(queryClient) },
      );

      await act(async () => {
        await result.current.actions.quotationSearch('node-1', { column: 'c' });
      });

      expect(workspaceSdkMock.getQuotation).toHaveBeenCalledWith({
        body: { column: 'c' },
        headers: { Authorization: 'Bearer test' },
        path: { node_id: 'node-1' },
        throwOnError: true,
      });
    });
  });
});
