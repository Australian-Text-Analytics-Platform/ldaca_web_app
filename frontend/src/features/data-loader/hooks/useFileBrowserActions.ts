import { useState } from 'react';
import { getRawFile, moveFile } from '@/api/generated/sdk.gen';
import type { FileTreeDirectory } from '@/types';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface UseFileBrowserActionsParams {
  authHeaders: Record<string, string>;
  refetchFiles: () => Promise<unknown>;
  notify: Notify;
}

export function useFileBrowserActions({
  authHeaders,
  refetchFiles,
  notify,
}: UseFileBrowserActionsParams) {
  const [citationDirectory, setCitationDirectory] =
    useState<FileTreeDirectory | null>(null);
  const [citationPath, setCitationPath] = useState<string | null>(null);
  const [citationContent, setCitationContent] = useState<string | null>(null);
  const [citationLoading, setCitationLoading] = useState(false);
  const [refreshingFiles, setRefreshingFiles] = useState(false);

  const handleRefreshFiles = async () => {
    setRefreshingFiles(true);
    try {
      await refetchFiles();
      notify('success', 'File list refreshed.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to refresh file list.');
    } finally {
      setRefreshingFiles(false);
    }
  };

  const handleMoveFile = async (sourcePath: string, targetDirectoryPath: string) => {
    try {
      await moveFile({
        body: { source_path: sourcePath, target_directory_path: targetDirectoryPath },
        headers: authHeaders,
        throwOnError: true,
      });
      await refetchFiles();
      notify('success', `Moved ${sourcePath.split('/').at(-1)}.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to move file.');
    }
  };

  const openCitation = async (
    directory: FileTreeDirectory,
    readmePath: string | null,
  ) => {
    if (!readmePath) {
      setCitationDirectory(directory);
      setCitationPath(null);
      setCitationContent(null);
      return;
    }

    setCitationDirectory(directory);
    setCitationPath(readmePath);
    setCitationContent(null);
    setCitationLoading(true);
    try {
      const { data } = await getRawFile({
        headers: authHeaders,
        parseAs: 'text',
        query: { path: readmePath },
        throwOnError: true,
      });
      const rawContent = data as string;
      setCitationContent(rawContent);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to load citation.');
    } finally {
      setCitationLoading(false);
    }
  };

  const closeCitation = () => {
    setCitationDirectory(null);
    setCitationPath(null);
    setCitationContent(null);
    setCitationLoading(false);
  };

  return {
    citationDirectory,
    citationPath,
    citationContent,
    citationLoading,
    refreshingFiles,
    handleRefreshFiles,
    handleMoveFile,
    openCitation,
    closeCitation,
  };
}
