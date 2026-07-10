import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// useWorkspaceInternal stitches together useWorkspaceCore +
// useWorkspaceQueries + useWorkspaceNodeMutations and adds a reconciler
// effect that syncs `currentWorkspaceId` from the server query into core
// state. The smoke tests focus on that orchestration contract; the three
// sub-hooks are mocked so we can drive their outputs directly.

/** Hoisted core-hook mock lets each test drive selection/auth state. */
const useWorkspaceCoreMock = vi.hoisted(() => vi.fn());
/** Hoisted query-hook mock lets each test drive server-derived workspace data. */
const useWorkspaceQueriesMock = vi.hoisted(() => vi.fn());
/** Hoisted mutation-hook mock lets each test assert action composition. */
const useWorkspaceNodeMutationsMock = vi.hoisted(() => vi.fn());

vi.mock('../useWorkspaceCore', () => ({ useWorkspaceCore: useWorkspaceCoreMock }));
vi.mock('../useWorkspaceQueries', () => ({ useWorkspaceQueries: useWorkspaceQueriesMock }));
vi.mock('../useWorkspaceNodeMutations', () => ({
  useWorkspaceNodeMutations: useWorkspaceNodeMutationsMock,
}));

// Text-analysis mutations live in useWorkspaceNodeMutations, which is mocked above.

import { useWorkspaceInternal } from '../useWorkspaceInternal';

interface CoreOverrides {
  isAuthenticated?: boolean;
  currentWorkspaceId?: string | null;
  setCurrentWorkspaceId?: ReturnType<typeof vi.fn>;
  activeNodeId?: string | null;
  selectedNodeIds?: string[];
  loadingOperationCount?: number;
}

interface QueriesOverrides {
  workspaces?: unknown;
  currentWorkspace?: unknown;
  workspaceGraph?: unknown;
  nodes?: unknown[];
  selectedNode?: unknown;
  selectedNodes?: unknown[];
  queryLoadingState?: Record<string, boolean>;
  currentWorkspaceIdFromQuery?: string | null | undefined;
  currentWorkspaceQueryError?: Error | null;
}

/**
 * Builds the core-hook contract used by orchestration tests.
 * Flow: start from production-shaped defaults, then override only the fields a test scenario needs.
 */
const buildCoreReturn = (overrides: CoreOverrides = {}) => ({
  isAuthenticated: overrides.isAuthenticated ?? true,
  currentWorkspaceId: overrides.currentWorkspaceId ?? null,
  setCurrentWorkspaceId: overrides.setCurrentWorkspaceId ?? vi.fn(),
  activeNodeId: overrides.activeNodeId ?? null,
  selectedNodeIds: overrides.selectedNodeIds ?? [],
  activateNode: vi.fn(),
  reorderSelectedNodes: vi.fn(),
  removeNode: vi.fn(),
  replaceSelectedNodes: vi.fn(),
  toggleNode: vi.fn(),
  clearSelection: vi.fn(),
  loadingOperationCount: overrides.loadingOperationCount ?? 0,
  startOperation: vi.fn(),
  endOperation: vi.fn(),
});

/**
 * Builds the query-hook contract used by orchestration tests.
 * Flow: fill query data/loading defaults first, then layer scenario-specific query results or errors.
 */
const buildQueriesReturn = (overrides: QueriesOverrides = {}) => ({
  workspaces: overrides.workspaces ?? [],
  currentWorkspace: overrides.currentWorkspace ?? null,
  workspaceGraph: overrides.workspaceGraph ?? null,
  nodes: overrides.nodes ?? [],
  selectedNode: overrides.selectedNode ?? null,
  selectedNodes: overrides.selectedNodes ?? [],
  queryLoadingState: overrides.queryLoadingState ?? {},
  currentWorkspaceIdFromQuery: overrides.currentWorkspaceIdFromQuery,
  currentWorkspaceQueryError: overrides.currentWorkspaceQueryError ?? null,
});

/**
 * Builds the mutation-hook contract with overridable action spies.
 * Flow: create default action spies, then replace the individual actions asserted by each orchestration test.
 */
const buildMutationsReturn = (actions: Record<string, unknown> = {}) => ({
  actions: {
    setCurrentWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    saveWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    updateWorkspaceDescription: vi.fn(),
    renameNode: vi.fn(),
    undoNode: vi.fn(),
    redoNode: vi.fn(),
    copyNode: vi.fn(),
    deleteNode: vi.fn(),
    createNodeFromFile: vi.fn(),
    joinNodes: vi.fn(),
    concatNodes: vi.fn(),
    concatPreview: vi.fn(),
    filterNode: vi.fn(),
    filterPreview: vi.fn(),
    sliceNode: vi.fn(),
    slicePreview: vi.fn(),
    replaceText: vi.fn(),
    replaceTextPreview: vi.fn(),
    polarsExpressionPreview: vi.fn(),
    polarsExpressionApply: vi.fn(),
    castColumn: vi.fn(),
    renameColumn: vi.fn(),
    deleteColumn: vi.fn(),
    refreshNodeSchema: vi.fn(),
    detachConcordance: vi.fn(),
    materializeConcordance: vi.fn(),
    quotationSearch: vi.fn(),
    detachQuotation: vi.fn(),
    materializeQuotation: vi.fn(),
    ...actions,
  },
});

/**
 * Renders the hook under a query client so effects/invalidation can run.
 */
const renderInternal = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  /**
   * Provides QueryClient context required by workspace internals under test.
   */
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useWorkspaceInternal(), { wrapper: Wrapper });
};

describe('useWorkspaceInternal', () => {
  beforeEach(() => {
    useWorkspaceCoreMock.mockReset();
    useWorkspaceQueriesMock.mockReset();
    useWorkspaceNodeMutationsMock.mockReset();
  });

  describe('reconciler effect', () => {
    it('clears currentWorkspaceId when not authenticated', () => {
      const setCurrentWorkspaceId = vi.fn();
      useWorkspaceCoreMock.mockReturnValue(
        buildCoreReturn({
          isAuthenticated: false,
          currentWorkspaceId: 'ws-1',
          setCurrentWorkspaceId,
        }),
      );
      useWorkspaceQueriesMock.mockReturnValue(buildQueriesReturn());
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());

      renderInternal();

      expect(setCurrentWorkspaceId).toHaveBeenCalledTimes(1);
      expect(setCurrentWorkspaceId).toHaveBeenCalledWith(null);
    });

    it('does not re-call setCurrentWorkspaceId when not authenticated and store is already null', () => {
      const setCurrentWorkspaceId = vi.fn();
      useWorkspaceCoreMock.mockReturnValue(
        buildCoreReturn({
          isAuthenticated: false,
          currentWorkspaceId: null,
          setCurrentWorkspaceId,
        }),
      );
      useWorkspaceQueriesMock.mockReturnValue(buildQueriesReturn());
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());

      renderInternal();
      expect(setCurrentWorkspaceId).not.toHaveBeenCalled();
    });

    it('syncs currentWorkspaceId from the server query on first hydration', () => {
      const setCurrentWorkspaceId = vi.fn();
      useWorkspaceCoreMock.mockReturnValue(
        buildCoreReturn({
          isAuthenticated: true,
          currentWorkspaceId: null,
          setCurrentWorkspaceId,
        }),
      );
      useWorkspaceQueriesMock.mockReturnValue(
        buildQueriesReturn({ currentWorkspaceIdFromQuery: 'ws-server' }),
      );
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());

      renderInternal();

      expect(setCurrentWorkspaceId).toHaveBeenCalledTimes(1);
      expect(setCurrentWorkspaceId).toHaveBeenCalledWith('ws-server');
    });

    it('clears currentWorkspaceId when the server query errors on first hydration', () => {
      const setCurrentWorkspaceId = vi.fn();
      useWorkspaceCoreMock.mockReturnValue(
        buildCoreReturn({
          isAuthenticated: true,
          currentWorkspaceId: 'ws-1',
          setCurrentWorkspaceId,
        }),
      );
      useWorkspaceQueriesMock.mockReturnValue(
        buildQueriesReturn({
          currentWorkspaceIdFromQuery: undefined,
          currentWorkspaceQueryError: new Error('500'),
        }),
      );
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());

      renderInternal();

      expect(setCurrentWorkspaceId).toHaveBeenCalledTimes(1);
      expect(setCurrentWorkspaceId).toHaveBeenCalledWith(null);
    });

    it('does nothing when authenticated, server query is undefined, and no error', () => {
      const setCurrentWorkspaceId = vi.fn();
      useWorkspaceCoreMock.mockReturnValue(
        buildCoreReturn({
          isAuthenticated: true,
          currentWorkspaceId: 'ws-1',
          setCurrentWorkspaceId,
        }),
      );
      useWorkspaceQueriesMock.mockReturnValue(
        buildQueriesReturn({ currentWorkspaceIdFromQuery: undefined }),
      );
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());

      renderInternal();
      expect(setCurrentWorkspaceId).not.toHaveBeenCalled();
    });

    it('does not re-bootstrap once hydrated even if the server query later returns a different value', () => {
      // After the first server response hydrates the store, mutations win:
      // a stale subsequent server value (e.g. cached refetch landing right
      // after a setCurrentWorkspace mutation) must not revert the store.
      const setCurrentWorkspaceId = vi.fn();
      useWorkspaceCoreMock.mockReturnValue(
        buildCoreReturn({
          isAuthenticated: true,
          currentWorkspaceId: null,
          setCurrentWorkspaceId,
        }),
      );
      useWorkspaceQueriesMock.mockReturnValue(
        buildQueriesReturn({ currentWorkspaceIdFromQuery: 'ws-A' }),
      );
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());

      const { rerender } = renderInternal();
      expect(setCurrentWorkspaceId).toHaveBeenCalledTimes(1);
      expect(setCurrentWorkspaceId).toHaveBeenLastCalledWith('ws-A');

      // Mutation moved store to ws-B. Server is still serving the old ws-A
      // (refetch hasn't landed yet) — the reconciler must NOT revert.
      useWorkspaceCoreMock.mockReturnValue(
        buildCoreReturn({
          isAuthenticated: true,
          currentWorkspaceId: 'ws-B',
          setCurrentWorkspaceId,
        }),
      );
      useWorkspaceQueriesMock.mockReturnValue(
        buildQueriesReturn({ currentWorkspaceIdFromQuery: 'ws-A' }),
      );
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());
      rerender();

      expect(setCurrentWorkspaceId).toHaveBeenCalledTimes(1); // still just the initial hydration
    });
  });

  describe('isLoading + errors aggregates', () => {
    it('reflects loadingOperationCount > 0 in isLoading.operations', () => {
      useWorkspaceCoreMock.mockReturnValue(buildCoreReturn({ loadingOperationCount: 1 }));
      useWorkspaceQueriesMock.mockReturnValue(
        buildQueriesReturn({ queryLoadingState: { workspaces: false } }),
      );
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());

      const { result } = renderInternal();
      expect(result.current.isLoading.operations).toBe(true);
      expect(result.current.isLoading.workspaces).toBe(false);
    });

    it('reflects 0 operations in isLoading.operations even when other loading flags are true', () => {
      useWorkspaceCoreMock.mockReturnValue(buildCoreReturn({ loadingOperationCount: 0 }));
      useWorkspaceQueriesMock.mockReturnValue(
        buildQueriesReturn({ queryLoadingState: { workspaces: true } }),
      );
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());

      const { result } = renderInternal();
      expect(result.current.isLoading.operations).toBe(false);
      expect(result.current.isLoading.workspaces).toBe(true);
    });
  });

  describe('passthrough fields', () => {
    it('exposes active selection fields from core and graph data from queries', () => {
      useWorkspaceCoreMock.mockReturnValue(
        buildCoreReturn({ currentWorkspaceId: 'ws-A', activeNodeId: 'node-A' }),
      );
      useWorkspaceQueriesMock.mockReturnValue(
        buildQueriesReturn({
          workspaceGraph: { nodes: [{ id: 'node-A' }] },
          selectedNode: { id: 'node-A' },
        }),
      );
      useWorkspaceNodeMutationsMock.mockReturnValue(buildMutationsReturn());

      const { result } = renderInternal();
      expect(result.current.currentWorkspaceId).toBe('ws-A');
      expect(result.current.activeNodeId).toBe('node-A');
      expect(result.current.workspaceGraph).toEqual({ nodes: [{ id: 'node-A' }] });
    });
  });
});
