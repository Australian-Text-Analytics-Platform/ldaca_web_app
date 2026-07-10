import { useReducer, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getRawFile, moveFile } from '@/api';
import type { FileTreeDirectory } from '@/features/views/data-loader/types';
import {
  createFileBrowserCitationState,
  fileBrowserCitationReducer,
} from './fileBrowserCitationState';
import { invalidateFilesQuery } from './fileCache';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface UseFileBrowserActionsParams {
  authHeaders: Record<string, string>;
  refreshFiles: () => Promise<unknown>;
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
  refreshFiles,
  notify,
}: UseFileBrowserActionsParams) {
  const queryClient = useQueryClient();
  const [citation, dispatchCitation] = useReducer(
    fileBrowserCitationReducer,
    undefined,
    createFileBrowserCitationState,
  );
  const [refreshingFiles, setRefreshingFiles] = useState(false);

  /**
   * Refreshes the server-backed file tree and surfaces the result through the
   * Data Loader toast channel.
   * Called by: useFileBrowserActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleRefreshFiles = async () => {
    setRefreshingFiles(true);
    try {
      await refreshFiles();
      notify('success', 'File list refreshed.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to refresh file list.');
    } finally {
      setRefreshingFiles(false);
    }
  };

  /**
   * Moves a file into a target directory for `FileTree` drop events, then
   * invalidates the browser query so the row appears in its new location.
   * Called by: useFileBrowserActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleMoveFile = async (sourcePath: string, targetDirectoryPath: string) => {
    try {
      await moveFile({
        body: { source_path: sourcePath, target_directory_path: targetDirectoryPath },
        headers: authHeaders,
        throwOnError: true,
      });
      await invalidateFilesQuery(queryClient);
      notify('success', `Moved ${String(sourcePath.split('/').at(-1))}.`);
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
  const openCitation = async (directory: FileTreeDirectory, readmePath: string | null) => {
    if (!readmePath) {
      dispatchCitation({ type: 'openWithoutReadme', directory });
      return;
    }

    dispatchCitation({ type: 'startLoading', directory, path: readmePath });
    try {
      const { data } = await getRawFile({
        headers: authHeaders,
        parseAs: 'text',
        query: { path: readmePath },
        throwOnError: true,
      });
      const rawContent = data;
      dispatchCitation({ type: 'loaded', content: rawContent });
    } catch (error) {
      dispatchCitation({ type: 'failed' });
      notify('error', (error as Error).message || 'Failed to load citation.');
    }
  };

  /**
   * Resets citation-preview state for the dialog close action.
   * Called by: useFileBrowserActions internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const closeCitation = () => {
    dispatchCitation({ type: 'close' });
  };

  return {
    citationDirectory: citation.directory,
    citationPath: citation.path,
    citationContent: citation.content,
    citationLoading: citation.loading,
    refreshingFiles,
    handleRefreshFiles,
    handleMoveFile,
    openCitation,
    closeCitation,
  };
}
