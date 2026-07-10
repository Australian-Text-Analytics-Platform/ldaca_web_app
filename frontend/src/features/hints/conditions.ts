import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
import { useHintsStore } from '@/stores/hintsStore';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import type { HintConditionMap, HintResolverContext } from './types';

/**
 * Build the boolean map of currently-true hint conditions plus the resolver
 * context the registry can use to locate dynamic anchors.
 *
 * This hook is the single place where new condition ids are wired up to
 * existing app state. Keep it cheap — it runs on every render of the
 * `HintsController`.
 * Used by `HintsController` to decide which registered coach mark may render.
 * Flow: read UI/workspace stores, derive each coach-mark condition from current app state, and
 * provide resolver context for anchor lookup/action handlers.
 */
export function useHintConditions(): {
  conditions: HintConditionMap;
  context: HintResolverContext;
} {
  const { currentWorkspaceId, workspaceGraph } = useWorkspaceData();
  const { activeNodeId } = useWorkspaceSelection();
  const { currentView, hasAnyModalOpen } = useUIStore(
    useShallow((s) => ({
      currentView: s.currentView,
      hasAnyModalOpen: s.feedbackOpen || s.documentTarget !== null,
    })),
  );
  const lastUploadedFilePath = useHintsStore((state) => state.lastUploadedFilePath);

  const noActiveWorkspace = !currentWorkspaceId;
  const workspaceHasNoNodes = !!currentWorkspaceId && (workspaceGraph?.nodes.length ?? 0) === 0;
  const workspaceHasNodes = !!currentWorkspaceId && (workspaceGraph?.nodes.length ?? 0) > 0;

  // "File uploaded without an active workspace": user uploaded something but
  // hasn't created/loaded a workspace yet. This is a separate hint id from
  // `no-active-workspace` so that previously dismissing the generic
  // workspace-card nudge doesn't suppress the upload follow-up.
  const fileUploadedNoWorkspace = !!lastUploadedFilePath && !currentWorkspaceId;

  // "File uploaded but not added": there is a remembered last-uploaded file
  // and that path/basename is not represented as a node id or name in the
  // active workspace graph.
  const fileUploadedNotAdded = (() => {
    if (!lastUploadedFilePath) return false;
    if (!currentWorkspaceId) return false;
    const nodes = workspaceGraph?.nodes ?? [];
    if (nodes.length === 0) return true;
    const basename = lastUploadedFilePath.split('/').pop() ?? lastUploadedFilePath;
    const matched = nodes.some((node) => {
      const id = String((node as { id?: string | number }).id ?? '');
      const data = (node as { data?: { name?: string | number } }).data;
      const name = String(data?.name ?? '');
      return (
        id === lastUploadedFilePath ||
        id.endsWith(`/${basename}`) ||
        name === basename ||
        name === lastUploadedFilePath
      );
    });
    return !matched;
  })();

  // Suppress all hints while a modal/dialog is open to avoid stacking UI.
  const enabled = !hasAnyModalOpen;
  const isFilterView = currentView === 'filter';
  const filterNoNodeSelected = isFilterView && workspaceHasNodes && !activeNodeId;
  const filterAwaitingColumnSelection = isFilterView && !!activeNodeId;

  // Stable identities are a correctness contract for HintsController's poll
  // effect: a measurement revision must not tear down/restart the interval.
  const conditions = useMemo<HintConditionMap>(
    () => ({
      'no-active-workspace': enabled && noActiveWorkspace,
      'workspace-has-no-nodes': enabled && workspaceHasNoNodes,
      'file-uploaded-not-added': enabled && fileUploadedNotAdded,
      'file-uploaded-no-workspace': enabled && fileUploadedNoWorkspace,
      'filter-no-node-selected': enabled && filterNoNodeSelected,
      'filter-awaiting-column-selection': enabled && filterAwaitingColumnSelection,
    }),
    [
      enabled,
      fileUploadedNoWorkspace,
      fileUploadedNotAdded,
      filterAwaitingColumnSelection,
      filterNoNodeSelected,
      noActiveWorkspace,
      workspaceHasNoNodes,
    ],
  );
  const context = useMemo<HintResolverContext>(
    () => ({ lastUploadedFilePath }),
    [lastUploadedFilePath],
  );

  return {
    conditions,
    context,
  };
}
