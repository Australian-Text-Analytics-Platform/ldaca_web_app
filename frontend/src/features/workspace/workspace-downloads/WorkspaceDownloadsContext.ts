import { createContext, useContext } from 'react';

export interface PendingWorkspaceDownload {
  taskId: string;
  workspaceId: string;
  artifactName: string;
  status: 'pending';
}

export interface WorkspaceDownloadsHandle {
  pendingDownloads: readonly PendingWorkspaceDownload[];
  startDownload: (workspaceId: string, workspaceName: string) => Promise<void>;
  isStarting: (workspaceId: string) => boolean;
  isPending: (workspaceId: string) => boolean;
}

/**
 * Carries the shell-owned workspace artifact command/status view. Provided by:
 * WorkspaceDownloadsProvider; consumed by Data Loader's workspace manager.
 */
export const WorkspaceDownloadsContext = createContext<WorkspaceDownloadsHandle | null>(null);

/**
 * Returns the shell-owned workspace-download view/commands. Used by: Data
 * Loader's workspace manager so navigation cannot own or orphan completion.
 */
export function useWorkspaceDownloads(): WorkspaceDownloadsHandle {
  const value = useContext(WorkspaceDownloadsContext);
  if (!value) {
    throw new Error('useWorkspaceDownloads must be used within WorkspaceDownloadsProvider');
  }
  return value;
}
