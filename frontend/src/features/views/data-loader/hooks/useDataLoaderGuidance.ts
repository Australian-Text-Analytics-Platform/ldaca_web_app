import { useEffect } from 'react';

import { useGuidance } from '@/features/guidance/GuidanceContext';
import { DATA_LOADER_GUIDANCE_IDS } from '@/features/guidance/registry';

interface DataLoaderGuidanceState {
  currentWorkspaceId: string | null;
  loadingFiles: boolean;
  nodeCount: number;
  totalFileCount: number;
  workspaceBusy: boolean;
  workspaceCount: number;
}

/**
 * Requests the next first-run explanation from the Data Loader's real workflow
 * state. Acknowledgment and single-session policy remain owned by GuidanceProvider.
 */
export function useDataLoaderGuidance({
  currentWorkspaceId,
  loadingFiles,
  nodeCount,
  totalFileCount,
  workspaceBusy,
  workspaceCount,
}: DataLoaderGuidanceState) {
  const { requestContextualHint } = useGuidance();

  useEffect(() => {
    if (workspaceBusy || loadingFiles) return;

    if (!currentWorkspaceId) {
      requestContextualHint(
        workspaceCount === 0
          ? DATA_LOADER_GUIDANCE_IDS.workspace
          : DATA_LOADER_GUIDANCE_IDS.workspaceLoad,
      );
      return;
    }
    if (totalFileCount === 0) {
      requestContextualHint(DATA_LOADER_GUIDANCE_IDS.fileSources);
      return;
    }
    if (nodeCount === 0) {
      requestContextualHint(DATA_LOADER_GUIDANCE_IDS.addDataBlock);
      return;
    }
    requestContextualHint(DATA_LOADER_GUIDANCE_IDS.dataBlocks);
  }, [
    currentWorkspaceId,
    loadingFiles,
    nodeCount,
    requestContextualHint,
    totalFileCount,
    workspaceBusy,
    workspaceCount,
  ]);
}
