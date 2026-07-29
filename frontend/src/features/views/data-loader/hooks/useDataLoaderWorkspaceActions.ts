import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { WorkspaceSummary } from '@/api';
import { importWorkspaceArchive } from '@/api';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { getInvalidWorkspaceNameMessage } from '@/features/workspace/common/workspaceName';
import { queryKeys } from '@/lib/queryKeys';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface DeleteWorkspaceTarget {
  id: string;
  name?: string | null;
}

interface UseDataLoaderWorkspaceActionsParams {
  workspaces: WorkspaceSummary[];
  hasWorkspaceSelected: boolean;
  notify: Notify;
}

/**
 * Owns Data Loader workspace mutations and user-facing notifications. The
 * feature shell consumes this hook to keep workspace cards/dialogs free of API
 * and cache-invalidation details.
 * Used by `DataLoaderFeature`, which passes the returned state and handlers to
 * workspace cards and `DataLoaderDialogs`.
 * Flow: keep transient dialog/busy state, validate workspace names, call generated workspace
 * APIs, refresh workspace data, and return action handlers for cards/dialogs.
 */
export function useDataLoaderWorkspaceActions({
  workspaces,
  hasWorkspaceSelected,
  notify,
}: UseDataLoaderWorkspaceActionsParams) {
  const queryClient = useQueryClient();
  const workspaceActions = useWorkspaceActions();
  const [workspaceToDelete, setWorkspaceToDelete] = useState<DeleteWorkspaceTarget | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [workspaceNameAlert, setWorkspaceNameAlert] = useState<string | null>(null);
  const [refreshingWorkspaces, setRefreshingWorkspaces] = useState(false);
  const [uploadingWorkspaceZip, setUploadingWorkspaceZip] = useState(false);

  /**
   * Creates a workspace from the card form and reports validation errors back
   * through the dialog state the Data Loader owns.
   * Passed to `ActiveWorkspaceCard` as `onCreate`.
   * Flow: reject empty names, create the workspace, load it when no workspace
   * is already active, surface invalid-name errors inline, and notify success
   * or failure.
   */
  const handleCreateWorkspace = async (name: string, description: string): Promise<boolean> => {
    if (!name) return false;
    try {
      const workspace = await workspaceActions.createWorkspace(name, description || undefined);
      if (!hasWorkspaceSelected) {
        try {
          await workspaceActions.setCurrentWorkspace(workspace.id);
        } catch (error) {
          const message = (error as Error).message;
          notify(
            'error',
            message
              ? `Workspace "${name}" was created, but could not be loaded: ${message}`
              : `Workspace "${name}" was created, but could not be loaded.`,
          );
          return true;
        }
      }
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

  /**
   * Renames the active workspace while preserving the same invalid-name alert
   * path used by create.
   * Passed to `ActiveWorkspaceCard` as `onRename`.
   */
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

  /**
   * Saves the active workspace from either workspace card action, guarded so
   * empty selections never call the backend.
   * Passed to `ActiveWorkspaceCard` as `onSave`.
   */
  const handleSaveWorkspace = async () => {
    if (!hasWorkspaceSelected) return;
    try {
      await workspaceActions.saveWorkspace();
      notify('success', 'Workspace saved.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to save workspace.');
    }
  };

  /**
   * Loads or unloads the active workspace for the manager and active card. It
   * centralizes notification handling around the shared workspace action hook.
   * Used for `WorkspaceManagerCard.onLoadWorkspace` and `ActiveWorkspaceCard.onUnload`.
   */
  const handleSetCurrentWorkspace = async (workspaceId: string | null) => {
    try {
      await workspaceActions.setCurrentWorkspace(workspaceId);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to update active workspace.');
    }
  };

  /**
   * Persists the active workspace description from the card's inline editor.
   * Passed to `ActiveWorkspaceCard` as `onUpdateDescription`.
   */
  const handleUpdateWorkspaceDescription = async (value: string) => {
    try {
      await workspaceActions.updateWorkspaceDescription(value);
      notify('success', 'Workspace description updated.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to update workspace description.');
    }
  };

  /**
   * Opens the delete confirmation with the display name looked up from the
   * current workspace list.
   * Passed to `WorkspaceManagerCard` as `onDeleteWorkspace`.
   */
  const openDeleteWorkspaceDialog = (workspaceId: string) => {
    const target = workspaces.find((workspace) => workspace.id === workspaceId);
    setWorkspaceToDelete({ id: workspaceId, name: target?.name });
  };

  /**
   * Performs the confirmed delete and resets confirmation state for the dialog
   * used by `DataLoaderDialogs`.
   * Passed to the delete dialog as its confirmation callback.
   */
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

  /**
   * Refetches the workspace list for the manager refresh button without
   * changing the current workspace selection.
   * Passed to `WorkspaceManagerCard` as `onRefresh`.
   */
  const handleRefreshWorkspaces = async () => {
    setRefreshingWorkspaces(true);
    try {
      await queryClient.refetchQueries({
        queryKey: queryKeys.workspaceList,
        exact: true,
      });
      notify('success', 'Workspace list refreshed.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to refresh workspace list.');
    } finally {
      setRefreshingWorkspaces(false);
    }
  };

  /**
   * Uploads a saved workspace archive and refreshes workspace summaries so the
   * manager can show the imported workspace immediately.
   * Passed to `WorkspaceManagerCard` as `onUploadZip`.
   * Flow: mark upload busy, send the ZIP through the generated API, refetch workspace summaries, notify the user, and always clear busy state.
   */
  const handleUploadWorkspaceZip = async (file: File) => {
    setUploadingWorkspaceZip(true);
    try {
      await importWorkspaceArchive({
        body: file,
        query: { filename: file.name },
        throwOnError: true,
      });
      await queryClient.refetchQueries({ queryKey: queryKeys.workspaceList, exact: true });
      notify('success', `Workspace ZIP "${file.name}" uploaded.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to upload workspace ZIP.');
    } finally {
      setUploadingWorkspaceZip(false);
    }
  };

  /**
   * Adds a file-browser path to the active workspace.
   * Passed to `FileTree` as its add-file action.
   */
  const handleAddFileToWorkspace = async (filename: string, selectedSheet?: string | null) => {
    await workspaceActions.createNodeFromFile(filename, selectedSheet ?? undefined);
    notify('success', `${filename} added to workspace.`);
  };

  return {
    workspaceToDelete,
    deletingWorkspace,
    workspaceNameAlert,
    refreshingWorkspaces,
    uploadingWorkspaceZip,
    // Dialog close handlers are returned with the state they clear because
    // `DataLoaderDialogs` owns only presentation, not workspace state.
    // Passed to DataLoaderDialogs as workspaceNameAlert.onClose.
    closeWorkspaceNameAlert: () => {
      setWorkspaceNameAlert(null);
    },
    /**
     * Clears the workspace pending deletion target after cancel or success.
     * Passed to DataLoaderDialogs as the delete dialog's cancel action.
     */
    closeDeleteWorkspaceDialog: () => {
      setWorkspaceToDelete(null);
    },
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
