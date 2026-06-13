/**
 * React Query bridge between the per-workspace ``tabs.json`` sidecar and the
 * analysis tab UI. Mirrors the ui-state sync pattern: a single GET hydrates the
 * whole ``WorkspaceTabsState``, and every mutation does an optimistic
 * read-modify-write of the full state followed by a PUT (full-replacement
 * semantics, matching the backend router).
 *
 * Scoped to one ``analysisType`` (the tab-group namespace) so a feature only
 * sees and mutates its own tabs. The pure reducers in ``tabStateOps`` do the
 * actual state math; this hook owns caching, auth headers, and persistence.
 *
 * Used by: ConcordanceTabbedFeature (the pilot wrapper) to list/create/close/
 * rename/activate tabs and to wire a tab to its task id after a run or clear.
 * Other analysis features can reuse it by passing their own analysis type.
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkspaceTabs, putWorkspaceTabs } from '@/api/generated/sdk.gen';
import type { AnalysisTab, AnalysisTabInput, WorkspaceTabsState } from '@/api/generated/types.gen';
import {
  EMPTY_TABS_STATE,
  closeTabInState,
  createTabInState,
  getActiveTabId,
  getTabs,
  renameTabInState,
  reorderTabsInState,
  setActiveTabInState,
  setTabInputsInState,
  setTabTaskInState,
} from './tabStateOps';

/** Query key for the whole-workspace tab state (shared across analysis types). */
function workspaceTabsQueryKey(workspaceId: string): string[] {
  return ['workspace-tabs', workspaceId];
}

export interface UseWorkspaceTabsResult {
  /** Ordered tabs for this analysis type (empty until loaded). */
  tabs: AnalysisTab[];
  /** Resolved active tab id, or null when there are no tabs. */
  activeTabId: string | null;
  /** True until the initial GET resolves — gates auto-create to avoid races. */
  isLoading: boolean;
  /** Appends a new empty tab, focuses it, and returns its id. */
  createTab: (title?: string) => string | null;
  /** Removes a tab and reselects a neighbour when needed. */
  closeTab: (tabId: string) => void;
  /** Renames a tab's title. */
  renameTab: (tabId: string, title: string) => void;
  /** Focuses a tab. */
  setActiveTab: (tabId: string) => void;
  /** Persists a drag-and-drop tab order (full list of tab ids). */
  reorderTabs: (orderedTabIds: string[]) => void;
  /** Wires a tab to a task id (or clears it with null). */
  setTabTask: (tabId: string, taskId: string | null) => void;
  /** Replaces a tab's input node set (add-node-as-needed selection). */
  setTabInputs: (tabId: string, inputs: AnalysisTabInput[]) => void;
}

/**
 * Manages the analysis tab group for one workspace + analysis type.
 * Used by: ConcordanceTabbedFeature wrapper because the tab bar and the keyed
 * feature panel both need the same live tab list, active id, and mutators.
 * Flow: query the full sidecar, derive this type's tabs/active id, then expose
 * mutators that optimistically patch the cache and PUT the whole state back.
 */
export function useWorkspaceTabs(
  workspaceId: string | null | undefined,
  analysisType: string,
  getAuthHeaders: () => Record<string, string>,
): UseWorkspaceTabsResult {
  const queryClient = useQueryClient();

  // Single source of truth for the whole workspace's tabs. Disabled until a
  // workspace is selected so we don't fire an unscoped request.
  const { data, isLoading } = useQuery({
    queryKey: workspaceTabsQueryKey(workspaceId ?? '__none__'),
    enabled: !!workspaceId,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data: payload } = await getWorkspaceTabs({
        headers: getAuthHeaders(),
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- query is enabled only when workspaceId is set
        path: { workspace_id: workspaceId! },
        throwOnError: true,
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- API payload may be undefined at runtime
      return payload ?? EMPTY_TABS_STATE;
    },
  });

  const state = data ?? EMPTY_TABS_STATE;

  // Full-replacement PUT. Optimistic cache write keeps the UI instant; the
  // mutation reconciles with the server response (same shape) on success.
  const putMutation = useMutation({
    mutationFn: async (next: WorkspaceTabsState) => {
      if (!workspaceId) return next;
      const { data: saved } = await putWorkspaceTabs({
        body: next,
        headers: getAuthHeaders(),
        path: { workspace_id: workspaceId },
        throwOnError: true,
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- API response may be undefined at runtime
      return saved ?? next;
    },
  });

  // Applies a pure reducer to the current cached state, optimistically writes
  // the result, and persists it. Centralizes the read-modify-write so each
  // mutator below stays a one-liner.
  const commit = useCallback(
    (next: WorkspaceTabsState) => {
      if (!workspaceId) return;
      queryClient.setQueryData(workspaceTabsQueryKey(workspaceId), next);
      putMutation.mutate(next);
    },
    [workspaceId, queryClient, putMutation],
  );

  const readState = useCallback((): WorkspaceTabsState => {
    if (!workspaceId) return EMPTY_TABS_STATE;
    return (
      queryClient.getQueryData<WorkspaceTabsState>(workspaceTabsQueryKey(workspaceId)) ??
      EMPTY_TABS_STATE
    );
  }, [workspaceId, queryClient]);

  const createTab = useCallback(
    (title?: string): string | null => {
      if (!workspaceId) return null;
      const current = readState();
      const count = getTabs(current, analysisType).length;
      const { state: next, tabId } = createTabInState(
        current,
        analysisType,
        title ?? `Analysis ${String(count + 1)}`,
      );
      commit(next);
      return tabId;
    },
    [workspaceId, analysisType, readState, commit],
  );

  const closeTab = useCallback(
    (tabId: string) => { commit(closeTabInState(readState(), analysisType, tabId)); },
    [analysisType, readState, commit],
  );

  const renameTab = useCallback(
    (tabId: string, title: string) =>
      { commit(renameTabInState(readState(), analysisType, tabId, title)); },
    [analysisType, readState, commit],
  );

  const setActiveTab = useCallback(
    (tabId: string) => { commit(setActiveTabInState(readState(), analysisType, tabId)); },
    [analysisType, readState, commit],
  );

  const reorderTabs = useCallback(
    (orderedTabIds: string[]) =>
      { commit(reorderTabsInState(readState(), analysisType, orderedTabIds)); },
    [analysisType, readState, commit],
  );

  const setTabTask = useCallback(
    (tabId: string, taskId: string | null) =>
      { commit(setTabTaskInState(readState(), analysisType, tabId, taskId)); },
    [analysisType, readState, commit],
  );

  const setTabInputs = useCallback(
    (tabId: string, inputs: AnalysisTabInput[]) =>
      { commit(setTabInputsInState(readState(), analysisType, tabId, inputs)); },
    [analysisType, readState, commit],
  );

  return {
    tabs: getTabs(state, analysisType),
    activeTabId: getActiveTabId(state, analysisType),
    isLoading: !!workspaceId && isLoading,
    createTab,
    closeTab,
    renameTab,
    setActiveTab,
    reorderTabs,
    setTabTask,
    setTabInputs,
  };
}
