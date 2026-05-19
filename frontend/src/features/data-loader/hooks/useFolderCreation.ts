import { useState } from 'react';
import { filesApi } from '@/api/files';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface UseFolderCreationParams {
  authHeaders: Record<string, string>;
  refetchFiles: () => Promise<unknown>;
  notify: Notify;
}

export function useFolderCreation({
  authHeaders,
  refetchFiles,
  notify,
}: UseFolderCreationParams) {
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderParentPath, setCreateFolderParentPath] = useState('');
  const [createFolderParentLabel, setCreateFolderParentLabel] = useState('root');
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderNameAlert, setFolderNameAlert] = useState<string | null>(null);

  const openCreateFolderDialog = (parentPath: string, parentLabel: string) => {
    setCreateFolderParentPath(parentPath);
    setCreateFolderParentLabel(parentLabel);
    setNewFolderName('');
    setFolderNameAlert(null);
    setCreateFolderOpen(true);
  };

  const handleCreateFolder = async () => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      return;
    }

    setCreatingFolder(true);
    try {
      await filesApi.createFolder(createFolderParentPath, trimmedName, authHeaders);
      await refetchFiles();
      notify('success', `Folder "${trimmedName}" created.`);
      setCreateFolderOpen(false);
      setNewFolderName('');
    } catch (error) {
      const message = (error as { message?: string })?.message || 'Failed to create folder.';
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
    closeFolderNameAlert: () => setFolderNameAlert(null),
    openCreateFolderDialog,
    handleCreateFolder,
  };
}
