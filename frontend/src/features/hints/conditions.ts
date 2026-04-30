import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
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
  const { lastUploadedFilePath, hasAnyModalOpen } = useUIStore(
    useShallow((s) => ({
      lastUploadedFilePath: s.lastUploadedFilePath,
      hasAnyModalOpen: Object.values(s.modals).some(Boolean),
    })),
  );

  const noActiveWorkspace = !currentWorkspaceId;
  const workspaceHasNoNodes =
    !!currentWorkspaceId && (workspaceGraph?.nodes?.length ?? 0) === 0;

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

  // Suppress all hints while a modal/dialog is open to avoid stacking UI.
  const enabled = !hasAnyModalOpen;

  return {
    conditions: {
      'no-active-workspace': enabled && noActiveWorkspace,
      'workspace-has-no-nodes': enabled && workspaceHasNoNodes,
      'file-uploaded-not-added': enabled && fileUploadedNotAdded,
      'file-uploaded-no-workspace': enabled && fileUploadedNoWorkspace,
    },
    context: {
      lastUploadedFilePath,
    },
  };
}
