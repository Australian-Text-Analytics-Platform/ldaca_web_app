import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
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
 */
export function useHintConditions(): {
  conditions: HintConditionMap;
  context: HintResolverContext;
} {
  const { currentWorkspaceId, workspaceGraph } = useWorkspaceData();
  const { selectedNodeId } = useWorkspaceSelection();
  const { currentView, lastUploadedFilePath, lastUploadedWorkspaceId, hasAnyModalOpen } = useUIStore(
    useShallow((s) => ({
      currentView: s.currentView,
      lastUploadedFilePath: s.lastUploadedFilePath,
      lastUploadedWorkspaceId: s.lastUploadedWorkspaceId,
      hasAnyModalOpen: Object.values(s.modals).some(Boolean),
    })),
  );

  const noActiveWorkspace = !currentWorkspaceId;
  const workspaceHasNoNodes =
    !!currentWorkspaceId && (workspaceGraph?.nodes?.length ?? 0) === 0;
  const workspaceHasNodes =
    !!currentWorkspaceId && (workspaceGraph?.nodes?.length ?? 0) > 0;

  // "File uploaded without an active workspace": user uploaded something but
  // hasn't created/loaded a workspace yet. This is a separate hint id from
  // `no-active-workspace` so that previously dismissing the generic
  // workspace-card nudge doesn't suppress the upload follow-up.
  const fileUploadedNoWorkspace =
    !!lastUploadedFilePath && !currentWorkspaceId;

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
      const id = String((node as { id?: unknown }).id ?? '');
      const data = (node as { data?: { name?: unknown } }).data;
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

  // "Workspace uploaded but not current": user just uploaded a workspace ZIP
  // and hasn't loaded it yet. Becomes false the moment they load it (id
  // matches `currentWorkspaceId`), so the highlight naturally goes away.
  const workspaceUploadedNotCurrent =
    !!lastUploadedWorkspaceId && lastUploadedWorkspaceId !== currentWorkspaceId;

  // Suppress all hints while a modal/dialog is open to avoid stacking UI.
  const enabled = !hasAnyModalOpen;
  const isFilterView = currentView === 'filter';
  const filterNoNodeSelected =
    isFilterView && workspaceHasNodes && !selectedNodeId;
  const filterAwaitingColumnSelection =
    isFilterView && !!selectedNodeId;

  return {
    conditions: {
      'no-active-workspace': enabled && noActiveWorkspace,
      'workspace-has-no-nodes': enabled && workspaceHasNoNodes,
      'file-uploaded-not-added': enabled && fileUploadedNotAdded,
      'file-uploaded-no-workspace': enabled && fileUploadedNoWorkspace,
      'workspace-uploaded-not-current': enabled && workspaceUploadedNotCurrent,
      'filter-no-node-selected': enabled && filterNoNodeSelected,
      'filter-awaiting-column-selection': enabled && filterAwaitingColumnSelection,
    },
    context: {
      lastUploadedFilePath,
      lastUploadedWorkspaceId,
    },
  };
}
