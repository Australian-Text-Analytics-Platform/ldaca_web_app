import { useState } from 'react';
import { createFolder } from '@/api/generated/sdk.gen';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface UseFolderCreationParams {
  authHeaders: Record<string, string>;
  refetchFiles: () => Promise<unknown>;
  notify: Notify;
}

/**
 * Manages the create-folder dialog state and backend mutation for the Data
 * Loader file browser.
 * Used by: DataLoaderFeature module and DataLoaderDialogs component because
 * they need shared dialog state, validation feedback, and refresh side effects
 * without duplicating folder-creation mutation logic.
 * Flow: tracks the selected parent, resets stale draft/error state when opened,
 * then submits the trimmed folder name and refreshes the browser on success.
 */
export function useFolderCreation({ authHeaders, refetchFiles, notify }: UseFolderCreationParams) {
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderParentPath, setCreateFolderParentPath] = useState('');
  const [createFolderParentLabel, setCreateFolderParentLabel] = useState('root');
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderNameAlert, setFolderNameAlert] = useState<string | null>(null);

  /**
   * Opens folder creation for a specific parent row while clearing any previous
   * draft or validation alert.
   * Called by: FileTree/DataLoaderFeature actions because the dialog needs the
   * target parent path and a clean form before the user types a folder name.
   */
  const openCreateFolderDialog = (parentPath: string, parentLabel: string) => {
    setCreateFolderParentPath(parentPath);
    setCreateFolderParentLabel(parentLabel);
    setNewFolderName('');
    setFolderNameAlert(null);
    setCreateFolderOpen(true);
  };

  /**
   * Creates the folder, refreshes the file browser, and routes invalid-name
   * errors to the alert dialog shown by `DataLoaderDialogs`.
   * Called by: DataLoaderDialogs submit handling because the UI needs one
   * guarded path for validation, backend mutation, refresh, toast, and cleanup.
   * Steps: ignore blank names, mark the request busy, call the generated API,
   * refetch files, then split invalid-name errors into dialog alerts.
   */
  const handleCreateFolder = async () => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      return;
    }

    setCreatingFolder(true);
    try {
      await createFolder({
        body: { parent_path: createFolderParentPath, name: trimmedName },
        headers: authHeaders,
        throwOnError: true,
      });
      await refetchFiles();
      notify('success', `Folder "${trimmedName}" created.`);
      setCreateFolderOpen(false);
      setNewFolderName('');
    } catch (error) {
      // read message off any thrown value; an empty message should fall through to the fallback
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const message = (error as { message?: string } | undefined)?.message || 'Failed to create folder.';
      if (message.toLowerCase().includes('invalid folder name')) {
        setFolderNameAlert(message);
        return;
      }
      notify('error', message);
    } finally {
      setCreatingFolder(false);
    }
  };

  return {
    createFolderOpen,
    setCreateFolderOpen,
    createFolderParentPath,
    createFolderParentLabel,
    newFolderName,
    setNewFolderName,
    creatingFolder,
    folderNameAlert,
    /**
     * Consumed by: DataLoaderDialogs because it needs to dismiss validation alerts
     * while leaving folder mutation state inside this hook.
     */
    closeFolderNameAlert: () => { setFolderNameAlert(null); },
    openCreateFolderDialog,
    handleCreateFolder,
  };
}
