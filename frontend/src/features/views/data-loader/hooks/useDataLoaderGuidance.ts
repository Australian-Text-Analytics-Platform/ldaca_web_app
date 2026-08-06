import { CONTEXTUAL_HINT_IDS } from '@/features/guidance/registry';
import { useProgressiveContextualHints } from '@/features/guidance/useProgressiveContextualHints';

interface DataLoaderGuidanceState {
  currentWorkspaceId: string | null;
  loadingFiles: boolean;
  nodeCount: number;
  totalFileCount: number;
  workspaceBusy: boolean;
  workspaceCount: number;
}

/**
 * Publishes the Data Loader milestones reached by the current workflow state.
 * Ordering, visit deferral, and acknowledgment remain owned by GuidanceProvider.
 */
export function useDataLoaderGuidance({
  currentWorkspaceId,
  loadingFiles,
  nodeCount,
  totalFileCount,
  workspaceBusy,
  workspaceCount,
}: DataLoaderGuidanceState) {
  const ids = CONTEXTUAL_HINT_IDS.dataLoader;
  const eligibleHintIds: string[] = [];
  if (!workspaceBusy && !loadingFiles) {
    if (!currentWorkspaceId) {
      eligibleHintIds.push(workspaceCount === 0 ? ids.workspace : ids.workspaceLoad);
    } else {
      eligibleHintIds.push(ids.activeWorkspace, ids.fileSources);
      if (totalFileCount > 0) eligibleHintIds.push(ids.addDataBlock);
      if (nodeCount > 0) eligibleHintIds.push(ids.dataBlocks);
    }
  }
  useProgressiveContextualHints(eligibleHintIds);
}
