import { useState } from 'react';
import { getRawFile, moveFile } from '@/api/generated/sdk.gen';
import type { FileTreeDirectory } from '@/features/data-loader/types';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface UseFileBrowserActionsParams {
  authHeaders: Record<string, string>;
  refetchFiles: () => Promise<unknown>;
  notify: Notify;
}

/**
 * Owns file-browser side effects that are not simple rendering. Data Loader
 * uses this hook for refresh, drag-to-move, and citation README preview state.
 * Used by: FileTree component, DataLoaderFeature module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: wrap file refresh/move/citation operations with loading state and notifications, then
 * expose handlers consumed by FileTree and DataLoaderFeature.
 */
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

  /**
   * Refreshes the server-backed file tree and surfaces the result through the
   * Data Loader toast channel.
   * Called by: useFileBrowserActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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

  /**
   * Moves a file into a target directory for `FileTree` drop events, then
   * refreshes the browser so the row appears in its new location.
   * Called by: useFileBrowserActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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

  /**
   * Opens the citation dialog and loads README content when the selected folder
   * has a citation file.
   * Called by: useFileBrowserActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: open the dialog, handle folders without README files, fetch README text, then clear
   * loading state after success or error.
   */
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

  /**
   * Resets citation-preview state for the dialog close action.
   * Called by: useFileBrowserActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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
