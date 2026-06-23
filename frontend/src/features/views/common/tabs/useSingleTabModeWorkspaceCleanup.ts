/**
 * Workspace-level cleanup for the analysis multi-tab preference. When the user
 * disables multi-tab mode, the UI should not merely hide tab controls while
 * leaving old tab-owned backend tasks referenced in `tabs.json`.
 *
 * Used by: WorkspaceShell because the preference is global to the current
 * workspace, while ViewRouter only mounts one analysis view at a time. Running
 * the cleanup at the workspace level lets a single preference toggle collapse
 * every persisted analysis group, including groups whose view is not currently
 * mounted.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { clearTasks, getWorkspaceTabs, putWorkspaceTabs } from '@/api/generated/sdk.gen';
import type { WorkspaceTabsState } from '@/api/generated/types.gen';
import { EMPTY_TABS_STATE, getTabs, keepFirstTabInState } from './tabStateOps';
import { workspaceTabsQueryKey } from './useWorkspaceTabs';

/**
 * Collapses every tab group in a workspace to its first tab.
 * Called by: useSingleTabModeWorkspaceCleanup when `analysisMultiTabEnabled`
 * becomes false. Flow: fetch the full sidecar, collect task ids from removed
 * tabs, PUT the collapsed sidecar once, update the shared tab query cache, then
 * best-effort clear removed tabs' backend tasks.
 */
async function collapseWorkspaceTabsToFirst(
  workspaceId: string,
  headers: Record<string, string>,
): Promise<WorkspaceTabsState | null> {
  const { data: payload } = await getWorkspaceTabs({
    headers,
    path: { workspace_id: workspaceId },
    throwOnError: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- API payload may be undefined at runtime
  const current = payload ?? EMPTY_TABS_STATE;
  let next = current;
  let changed = false;
  const removedTaskIds: string[] = [];

  for (const analysisType of Object.keys(current.groups ?? {})) {
    const tabs = getTabs(current, analysisType);
    if (tabs.length <= 1) continue;
    changed = true;
    for (const tab of tabs.slice(1)) {
      if (tab.task_id) removedTaskIds.push(tab.task_id);
    }
    next = keepFirstTabInState(next, analysisType);
  }

  if (!changed) return null;

  const { data: saved } = await putWorkspaceTabs({
    body: next,
    headers,
    path: { workspace_id: workspaceId },
    throwOnError: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- API response may be undefined at runtime
  const savedState = saved ?? next;

  for (const taskId of removedTaskIds) {
    void clearTasks({
      headers,
      query: { task_id: taskId },
      throwOnError: true,
    }).catch((error: unknown) => {
      console.warn(`[analysis-tabs] Failed to clear task ${taskId} on single-tab cleanup:`, error);
    });
  }

  return savedState;
}

/**
 * Runs the one-per-workspace cleanup pass while multi-tab mode is disabled.
 * Used by: WorkspaceShell as a headless effect under WorkspaceProvider.
 */
export function useSingleTabModeWorkspaceCleanup(
  workspaceId: string | null | undefined,
  analysisMultiTabEnabled: boolean,
  getAuthHeaders: () => Record<string, string>,
) {
  const queryClient = useQueryClient();
  const cleanedWorkspaceRef = useRef<string | null>(null);

  useEffect(() => {
    if (analysisMultiTabEnabled || !workspaceId) {
      cleanedWorkspaceRef.current = null;
      return;
    }
    if (cleanedWorkspaceRef.current === workspaceId) return;
    cleanedWorkspaceRef.current = workspaceId;

    void collapseWorkspaceTabsToFirst(workspaceId, getAuthHeaders())
      .then((savedState) => {
        if (savedState) {
          queryClient.setQueryData(workspaceTabsQueryKey(workspaceId), savedState);
        }
      })
      .catch((error: unknown) => {
        cleanedWorkspaceRef.current = null;
        console.warn('[analysis-tabs] Failed to collapse workspace tabs for single-tab mode:', error);
      });
  }, [analysisMultiTabEnabled, getAuthHeaders, queryClient, workspaceId]);
}
