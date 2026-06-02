/**
 * Pure, framework-free transforms over the persisted ``WorkspaceTabsState``
 * sidecar shape. Every operation is keyed by ``analysisType`` (the tab-group
 * namespace) and returns a brand-new state object so React Query's optimistic
 * ``setQueryData`` updates stay immutable.
 *
 * Used by: useWorkspaceTabs hook because the hook needs deterministic,
 * unit-testable read-modify-write reducers before it PUTs the whole state back
 * to ``/workspaces/{id}/tabs``. Keeping the logic here (not inside the hook)
 * lets the reducers be covered by fast pure tests without mounting React.
 */
import type {
  AnalysisTab,
  AnalysisTabGroup,
  WorkspaceTabsState,
} from '@/api/generated/types.gen';

/** Empty default returned when a workspace has no tabs sidecar yet. */
export const EMPTY_TABS_STATE: WorkspaceTabsState = { groups: {} };

/**
 * Generates a stable unique tab id.
 * Called by: createTabInState because new tabs need a collision-free id that
 * also survives reload/serialization. Uses the platform UUID when available and
 * degrades to a timestamp+random fallback for non-secure/test contexts.
 */
export function newTabId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reads the (possibly missing) tab group for one analysis type.
 * Called by: useWorkspaceTabs selectors and the reducers below because all
 * tab operations scope to a single analysis-type namespace.
 */
export function getGroup(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
): AnalysisTabGroup {
  return state?.groups?.[analysisType] ?? { tabs: [], active_tab_id: null };
}

/**
 * Returns the ordered tab list for an analysis type (never undefined).
 * Called by: AnalysisTabbedPanel rendering and auto-create checks.
 */
export function getTabs(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
): AnalysisTab[] {
  return getGroup(state, analysisType).tabs ?? [];
}

/**
 * Resolves the active tab id, defaulting to the first tab when the persisted
 * pointer is missing or dangling (e.g. the active tab was closed elsewhere).
 * Called by: useWorkspaceTabs so consumers always get a valid active id when at
 * least one tab exists.
 */
export function getActiveTabId(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
): string | null {
  const group = getGroup(state, analysisType);
  const tabs = group.tabs ?? [];
  if (tabs.length === 0) return null;
  const active = group.active_tab_id;
  if (active && tabs.some((t) => t.tab_id === active)) return active;
  return tabs[0]!.tab_id;
}

/**
 * Replaces one analysis-type group while preserving every other group.
 * Called by: all reducers below as the single immutable write primitive so the
 * rest of ``WorkspaceTabsState`` is never accidentally dropped on PUT.
 */
function withGroup(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
  group: AnalysisTabGroup,
): WorkspaceTabsState {
  return {
    groups: {
      ...(state?.groups ?? {}),
      [analysisType]: group,
    },
  };
}

/**
 * Appends a new empty tab and makes it active.
 * Called by: useWorkspaceTabs.createTab and the auto-create flow when entering
 * an empty analysis view. Returns both the next state and the new tab id so the
 * caller can persist and immediately focus the tab.
 * Flow: build a thin tab record (task_id null), append it, then point
 * ``active_tab_id`` at it.
 */
export function createTabInState(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
  title: string,
  tabId: string = newTabId(),
): { state: WorkspaceTabsState; tabId: string } {
  const group = getGroup(state, analysisType);
  const tab: AnalysisTab = { tab_id: tabId, task_id: null, title };
  const nextGroup: AnalysisTabGroup = {
    tabs: [...(group.tabs ?? []), tab],
    active_tab_id: tabId,
  };
  return { state: withGroup(state, analysisType, nextGroup), tabId };
}

/**
 * Removes a tab and reselects a neighbour as active when the closed tab was
 * focused.
 * Called by: useWorkspaceTabs.closeTab (the per-tab × button). Chooses the
 * previous tab as the new active one, mirroring Chrome's close behaviour, and
 * falls back to null when the last tab is closed.
 */
export function closeTabInState(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
  tabId: string,
): WorkspaceTabsState {
  const group = getGroup(state, analysisType);
  const tabs = group.tabs ?? [];
  const idx = tabs.findIndex((t) => t.tab_id === tabId);
  if (idx === -1) return withGroup(state, analysisType, group);
  const nextTabs = tabs.filter((t) => t.tab_id !== tabId);
  let activeId = group.active_tab_id ?? null;
  if (activeId === tabId) {
    if (nextTabs.length === 0) {
      activeId = null;
    } else {
      const neighbour = nextTabs[Math.max(0, idx - 1)];
      activeId = neighbour ? neighbour.tab_id : nextTabs[0]!.tab_id;
    }
  }
  return withGroup(state, analysisType, { tabs: nextTabs, active_tab_id: activeId });
}

/**
 * Renames a tab's title.
 * Called by: useWorkspaceTabs.renameTab (inline title edit in AnalysisTabbedPanel).
 */
export function renameTabInState(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
  tabId: string,
  title: string,
): WorkspaceTabsState {
  const group = getGroup(state, analysisType);
  const nextTabs = (group.tabs ?? []).map((t) =>
    t.tab_id === tabId ? { ...t, title } : t,
  );
  return withGroup(state, analysisType, { ...group, tabs: nextTabs });
}

/**
 * Sets the active tab pointer (no-op when the id is unknown).
 * Called by: useWorkspaceTabs.setActiveTab when the user clicks a tab.
 */
export function setActiveTabInState(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
  tabId: string,
): WorkspaceTabsState {
  const group = getGroup(state, analysisType);
  if (!(group.tabs ?? []).some((t) => t.tab_id === tabId)) {
    return withGroup(state, analysisType, group);
  }
  return withGroup(state, analysisType, { ...group, active_tab_id: tabId });
}

/**
 * Associates a tab with a task id (or clears it with null).
 * Called by: useWorkspaceTabs.setTabTask after a run assigns a new task id and
 * after a clear removes it. This is the only place the thin tab record's
 * ``task_id`` changes — the task object itself remains the source of truth for
 * status/request/result.
 */
export function setTabTaskInState(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
  tabId: string,
  taskId: string | null,
): WorkspaceTabsState {
  const group = getGroup(state, analysisType);
  const nextTabs = (group.tabs ?? []).map((t) =>
    t.tab_id === tabId ? { ...t, task_id: taskId } : t,
  );
  return withGroup(state, analysisType, { ...group, tabs: nextTabs });
}
