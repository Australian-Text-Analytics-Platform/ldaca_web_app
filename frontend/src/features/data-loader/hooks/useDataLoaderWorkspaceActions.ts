import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/lib/backend/workspaces';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { getInvalidWorkspaceNameMessage } from '@/features/workspace/common/workspaceName';
import { queryKeys } from '@/lib/queryKeys';
import { useUIStore } from '@/stores/uiStore';
import type { WorkspaceSummary } from '@/api/generated/types.gen';
import { getWorkspaceId } from '../utils/format';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface DeleteWorkspaceTarget {
  id: string;
  name?: string | null;
}

interface UseDataLoaderWorkspaceActionsParams {
  workspaces: WorkspaceSummary[];
  hasWorkspaceSelected: boolean;
  authHeaders: Record<string, string>;
  notify: Notify;
}

export function useDataLoaderWorkspaceActions({
  workspaces,
  hasWorkspaceSelected,
  authHeaders,
  notify,
}: UseDataLoaderWorkspaceActionsParams) {
  const queryClient = useQueryClient();
  const workspaceActions = useWorkspaceActions();
  const [workspaceToDelete, setWorkspaceToDelete] =
    useState<DeleteWorkspaceTarget | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [workspaceNameAlert, setWorkspaceNameAlert] = useState<string | null>(null);
  const [refreshingWorkspaces, setRefreshingWorkspaces] = useState(false);
  const [uploadingWorkspaceZip, setUploadingWorkspaceZip] = useState(false);

  const handleCreateWorkspace = async (
    name: string,
    description: string,
  ): Promise<boolean> => {
    if (!name) return false;
    try {
      await workspaceActions.createWorkspace(name, description || undefined);
      notify('success', `Workspace "${name}" created.`);
      return true;
    } catch (error) {
      const message = getInvalidWorkspaceNameMessage(error);
      if (message) {
        setWorkspaceNameAlert(message);
        return false;
      }
      notify('error', (error as Error).message || 'Failed to create workspace.');
      return false;
    }
  };

  const handleRenameWorkspace = async (value: string) => {
    try {
      await workspaceActions.renameWorkspace(value);
      notify('success', 'Workspace renamed.');
    } catch (error) {
      const message = getInvalidWorkspaceNameMessage(error);
      if (message) {
        setWorkspaceNameAlert(message);
        return;
      }
      notify('error', (error as Error).message || 'Failed to rename workspace.');
    }
  };

  const handleSaveWorkspace = async () => {
    if (!hasWorkspaceSelected) return;
    try {
      await workspaceActions.saveWorkspace();
      notify('success', 'Workspace saved.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to save workspace.');
    }
  };

  const handleSetCurrentWorkspace = async (workspaceId: string | null) => {
    try {
      await workspaceActions.setCurrentWorkspace(workspaceId);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to update active workspace.');
    }
  };

  const handleUpdateWorkspaceDescription = async (value: string) => {
    try {
      await workspaceActions.updateWorkspaceDescription(value);
      notify('success', 'Workspace description updated.');
    } catch (error) {
      notify(
        'error',
        (error as Error).message || 'Failed to update workspace description.',
      );
    }
  };

  const openDeleteWorkspaceDialog = (workspaceId: string) => {
    const target = workspaces.find((workspace) => getWorkspaceId(workspace) === workspaceId);
    setWorkspaceToDelete({ id: workspaceId, name: target?.name });
  };

  const handleConfirmDeleteWorkspace = async () => {
    if (!workspaceToDelete) return;
    setDeletingWorkspace(true);
    try {
      await workspaceActions.deleteWorkspace(workspaceToDelete.id);
      notify('success', 'Workspace deleted.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to delete workspace.');
    } finally {
      setDeletingWorkspace(false);
      setWorkspaceToDelete(null);
    }
  };

  const handleRefreshWorkspaces = async () => {
    setRefreshingWorkspaces(true);
    try {
      await queryClient.refetchQueries({
        queryKey: queryKeys.workspaces,
        exact: true,
      });
      notify('success', 'Workspace list refreshed.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to refresh workspace list.');
    } finally {
      setRefreshingWorkspaces(false);
    }
  };

  const handleUploadWorkspaceZip = async (file: File) => {
    setUploadingWorkspaceZip(true);
    try {
      await workspacesApi.uploadZip(file, authHeaders);
      await queryClient.refetchQueries({ queryKey: queryKeys.workspaces, exact: true });
      notify('success', `Workspace ZIP "${file.name}" uploaded.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to upload workspace ZIP.');
    } finally {
      setUploadingWorkspaceZip(false);
    }
  };

  const handleAddFileToWorkspace = async (
    filename: string,
    selectedSheet?: string | null,
  ) => {
    await workspaceActions.createNodeFromFile(filename, selectedSheet ?? undefined);
    notify('success', `${filename} added to workspace.`);
    const lastUploaded = useUIStore.getState().lastUploadedFilePath;
    if (lastUploaded && (lastUploaded === filename || filename.endsWith(`/${lastUploaded}`))) {
      useUIStore.getState().setLastUploadedFilePath(null);
    }
  };

  return {
    workspaceToDelete,
    deletingWorkspace,
    workspaceNameAlert,
    refreshingWorkspaces,
    uploadingWorkspaceZip,
    closeWorkspaceNameAlert: () => setWorkspaceNameAlert(null),
    closeDeleteWorkspaceDialog: () => setWorkspaceToDelete(null),
    handleCreateWorkspace,
    handleRenameWorkspace,
    handleSaveWorkspace,
    handleSetCurrentWorkspace,
    handleUpdateWorkspaceDescription,
    openDeleteWorkspaceDialog,
    handleConfirmDeleteWorkspace,
    handleRefreshWorkspaces,
    handleUploadWorkspaceZip,
    handleAddFileToWorkspace,
  };
}
