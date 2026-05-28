import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadWorkspaceZip } from '@/api/generated/sdk.gen';
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

/**
 * Owns Data Loader workspace mutations and user-facing notifications. The
 * feature shell consumes this hook to keep workspace cards/dialogs free of API
 * and cache-invalidation details.
 * Used by: DataLoaderDialogs component, workspaceName module, DataLoaderFeature module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: keep transient dialog/busy state, validate workspace names, call generated workspace
 * APIs, refresh workspace data, and return action handlers for cards/dialogs.
 */
export function useDataLoaderWorkspaceActions({
  workspaces,
  hasWorkspaceSelected,
  authHeaders,
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
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Flow: reject empty names, call the workspace action, surface invalid-name errors inline, and notify success or failure.
   */
  const handleCreateWorkspace = async (name: string, description: string): Promise<boolean> => {
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

  /**
   * Renames the active workspace while preserving the same invalid-name alert
   * path used by create.
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
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
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
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
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
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
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
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
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const openDeleteWorkspaceDialog = (workspaceId: string) => {
    const target = workspaces.find((workspace) => getWorkspaceId(workspace) === workspaceId);
    setWorkspaceToDelete({ id: workspaceId, name: target?.name });
  };

  /**
   * Performs the confirmed delete and resets confirmation state for the dialog
   * used by `DataLoaderDialogs`.
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
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
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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

  /**
   * Uploads a saved workspace archive and refreshes workspace summaries so the
   * manager can show the imported workspace immediately.
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Flow: mark upload busy, send the ZIP through the generated API, refetch workspace summaries, notify the user, and always clear busy state.
   */
  const handleUploadWorkspaceZip = async (file: File) => {
    setUploadingWorkspaceZip(true);
    try {
      await uploadWorkspaceZip({ body: { file }, headers: authHeaders, throwOnError: true });
      await queryClient.refetchQueries({ queryKey: queryKeys.workspaces, exact: true });
      notify('success', `Workspace ZIP "${file.name}" uploaded.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to upload workspace ZIP.');
    } finally {
      setUploadingWorkspaceZip(false);
    }
  };

  /**
   * Adds a file-browser path to the active workspace and clears upload-followup
   * hints when the selected file matches the last uploaded path.
   * Called by: useDataLoaderWorkspaceActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleAddFileToWorkspace = async (filename: string, selectedSheet?: string | null) => {
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
    // Dialog close handlers are returned with the state they clear because
    // `DataLoaderDialogs` owns only presentation, not workspace state.
    // Consumed by: useDataLoaderWorkspaceActions return object for feature components because consumers need this returned value or action without owning the hook internals.
    closeWorkspaceNameAlert: () => setWorkspaceNameAlert(null),
    /**
     * Clears the workspace pending deletion target after cancel or success.
     * Consumed by: useDataLoaderWorkspaceActions return object for feature components because consumers need this returned value or action without owning the hook internals.
     */
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
