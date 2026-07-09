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
 * Used by: AnalysisTabsHost to list/create/close/rename/activate tabs and to
 * wire a tab to its task id after a run or clear. Each analysis feature passes
 * its own analysis type.
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clearTask, getWorkspaceTabs, putWorkspaceTabs } from '@/api';
import type { AnalysisTab, AnalysisTabInput, WorkspaceTabsState } from '@/api';
import {
  EMPTY_TABS_STATE,
  closeTabInState,
  createTabInState,
  getActiveTabId,
  getTabs,
  renameTabInState,
  reorderTabsInState,
  setActiveTabInState,
  setTabInputSetInState,
  setTabSettingInState,
  setTabTaskInState,
} from './tabStateOps';

/**
 * Query key for the whole-workspace tab state (shared across analysis types).
 * Used by: useWorkspaceTabs and workspace-level cleanup hooks so all tab
 * sidecar mutations reconcile the same React Query cache entry.
 */
export function workspaceTabsQueryKey(workspaceId: string): string[] {
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
  /** Replaces one named input node set for multi-selector views. */
  setTabInputSet: (tabId: string, selectorId: string, inputs: AnalysisTabInput[]) => void;
  /** Persists one free-form per-view setting (string→string) on a tab. */
  setTabSetting: (tabId: string, key: string, value: string) => void;
}

/**
 * Manages the analysis tab group for one workspace + analysis type.
 * Used by: AnalysisTabsHost because the tab bar and the keyed feature panel
 * both need the same live tab list, active id, and mutators.
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
  //
  // The client is the sole author of tab state (every mutation is an optimistic
  // read-modify-write + PUT), so the cache stays authoritative within a session.
  // A short staleTime lets cross-view navigation reuse that cache instead of
  // refetching on every mount. This is deliberate, not just an optimization:
  // a mount-time GET (the old ``refetchOnMount: 'always'``) could resolve
  // mid-flight and overwrite a tab that was just created optimistically right
  // before navigating — exactly the token-click → concordance handoff, where
  // ``createTab`` runs and then ``setCurrentView('concordance')`` immediately
  // mounts this hook again under the concordance group. The per-workspace query
  // key still forces a fresh GET whenever the user switches workspaces.
  const { data, isLoading } = useQuery({
    queryKey: workspaceTabsQueryKey(workspaceId ?? '__none__'),
    enabled: !!workspaceId,
    staleTime: 30_000,
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
    // Write the server's authoritative response back into the cache. Without
    // this, a concurrent mount-time GET that resolved with stale data (one that
    // raced the PUT) could leave the cache permanently behind the persisted
    // state — silently dropping a tab that was just created.
    onSuccess: (saved) => {
      if (!workspaceId) return;
      queryClient.setQueryData(workspaceTabsQueryKey(workspaceId), saved);
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
    (tabId: string) => {
      const current = readState();
      // Capture the task id this tab owns BEFORE dropping it from state. A tab
      // is the sole owner of its backend task (tab_id -> task_id), so closing it
      // abandons that task; we must tell the backend to clear its records —
      // identical to the explicit "Clear results" action — or the server-side
      // task cache (request/result/materialized artifacts) would leak.
      const closingTab = getTabs(current, analysisType).find((t) => t.tab_id === tabId);
      const taskId = closingTab?.task_id ?? null;
      commit(closeTabInState(current, analysisType, tabId));
      if (taskId) {
        // Fire-and-forget: the tab is already removed optimistically, so a
        // failed cleanup must not block the UI. A miss just leaves a harmless
        // orphan task for later garbage collection; log it for diagnosis.
        void clearTask({
          headers: getAuthHeaders(),
          path: { task_id: taskId },
          throwOnError: true,
        }).catch((error: unknown) => {
          console.warn(`[${analysisType}] Failed to clear task ${taskId} on tab close:`, error);
        });
      }
    },
    [analysisType, readState, commit, getAuthHeaders],
  );

  const renameTab = useCallback(
    (tabId: string, title: string) => {
      commit(renameTabInState(readState(), analysisType, tabId, title));
    },
    [analysisType, readState, commit],
  );

  const setActiveTab = useCallback(
    (tabId: string) => {
      commit(setActiveTabInState(readState(), analysisType, tabId));
    },
    [analysisType, readState, commit],
  );

  const reorderTabs = useCallback(
    (orderedTabIds: string[]) => {
      commit(reorderTabsInState(readState(), analysisType, orderedTabIds));
    },
    [analysisType, readState, commit],
  );

  const setTabTask = useCallback(
    (tabId: string, taskId: string | null) => {
      commit(setTabTaskInState(readState(), analysisType, tabId, taskId));
    },
    [analysisType, readState, commit],
  );

  const setTabInputSet = useCallback(
    (tabId: string, selectorId: string, inputs: AnalysisTabInput[]) => {
      commit(setTabInputSetInState(readState(), analysisType, tabId, selectorId, inputs));
    },
    [analysisType, readState, commit],
  );

  const setTabSetting = useCallback(
    (tabId: string, key: string, value: string) => {
      commit(setTabSettingInState(readState(), analysisType, tabId, key, value));
    },
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
    setTabInputSet,
    setTabSetting,
  };
}
