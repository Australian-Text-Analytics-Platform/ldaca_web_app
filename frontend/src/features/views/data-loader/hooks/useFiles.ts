import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createFolder,
  deleteFile,
  downloadFile,
  getUserFileResource,
  listUserFiles,
  uploadFile,
} from '@/api';
import { saveBackendDownload } from '@/lib/download';
import { type FileTreeNode } from '../types';
import { queryKeys } from '@/lib/queryKeys';
import { refreshFilePathQuery } from './fileCache';
import { toFileTree } from '@/api/frontendModels';
import { filterLoadableFileTree } from '../utils/fileTreeHelpers';

interface UseFilesProps {
  /** Defer the initial fetch until auth has been resolved. */
  enabled?: boolean;
}

/** Coordinates user file tree loading plus upload/delete/download actions for data-loader panels. */
/**
 * Used by: src/features/views/data-loader/DataLoaderFeature.tsx.
 * Flow: fetch the file tree, wire upload/delete mutations to cache invalidation, then expose selection and file actions for data-loader panels.
 */
export const useFiles = ({ enabled = true }: UseFilesProps = {}) => {
  const queryClient = useQueryClient();

  const filesQuery = useQuery<FileTreeNode[]>({
    queryKey: queryKeys.fileList,
    /**
     * Fetches the user-visible file tree for data-loader consumers.
     * Called by: TanStack Query while the Data Loader's files query is enabled.
     */
    queryFn: async () => {
      const { data } = await listUserFiles({ throwOnError: true });
      return toFileTree(data) as FileTreeNode[];
    },
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const deleteMutation = useMutation({
    /** Deletes the selected server-side file and lets mutation success refresh the tree. */
    /** Called by: the delete mutation when `handleDeleteFile` invokes `mutateAsync`. */
    mutationFn: (filename: string) =>
      deleteFile({
        query: { path: filename },
        throwOnError: true,
      }),
    onSuccess: (_response, filename) => refreshFilePathQuery(queryClient, filename),
  });

  /**
   * Runs only the explicit user-requested file-list refresh command. Used by:
   * Data Loader's Refresh button; mutation owners invalidate through
   * file mutation cache helpers instead of calling this command.
   */
  const refreshFiles = async () => (await filesQuery.refetch()).data ?? null;

  /** Uploads one file at its preflighted destination without refreshing mid-batch. */
  const uploadFileAtPath = async (file: File, path: string) => {
    await uploadFile({ body: file, query: { path }, throwOnError: true });
  };

  /** Creates one preflighted destination directory without refreshing mid-batch. */
  const createUploadDirectory = async (path: string) => {
    const separatorIndex = path.lastIndexOf('/');
    const parentPath = separatorIndex === -1 ? '' : path.slice(0, separatorIndex);
    const name = separatorIndex === -1 ? path : path.slice(separatorIndex + 1);
    await createFolder({ body: { name, parent_path: parentPath }, throwOnError: true });
  };

  /** Reads one destination after a late create conflict so callers can verify directory reuse. */
  const getUploadResource = async (path: string) => {
    const { data } = await getUserFileResource({ query: { path }, throwOnError: true });
    return data;
  };

  /** Deletes a user file and clears selection if the deleted file was active. */
  /** Returned to: `DataLoaderFeature` for the file-tree delete action. */
  const handleDeleteFile = async (filename: string) => {
    try {
      await deleteMutation.mutateAsync(filename);
      if (selectedFile === filename) setSelectedFile(null);
      return true;
    } catch (error) {
      console.error('Failed to delete file:', error);
      return false;
    }
  };

  /** Downloads a user file through the shared browser/Tauri save helper. */
  /** Returned to: `DataLoaderFeature` for the file-tree download action. */
  const handleDownloadFile = async (filename: string) => {
    try {
      const query = new URLSearchParams({ path: filename });
      const omissions = await saveBackendDownload(
        `/api/user-files/content?${query.toString()}`,
        filename,
        async () => {
          const { data } = await downloadFile({
            parseAs: 'blob',
            query: { path: filename },
            throwOnError: true,
          });
          return { blob: data instanceof Blob ? data : new Blob([data]) };
        },
      );
      return omissions !== null;
    } catch (error) {
      console.error('Failed to download file:', error);
      return false;
    }
  };

  return {
    completeFileTree: filesQuery.data ?? [],
    fileTree: filterLoadableFileTree(filesQuery.data ?? []),
    selectedFile,
    setSelectedFile,
    loadingFiles: filesQuery.isLoading || filesQuery.isFetching,
    uploadFileAtPath,
    createUploadDirectory,
    getUploadResource,
    handleDeleteFile,
    handleDownloadFile,
    refreshFiles,
  };
};
