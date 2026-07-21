import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteFile, downloadFile, listUserFiles, uploadFile } from '@/api';
import { saveBlob } from '@/lib/download';
import { type FileTreeNode } from '../types';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateFilesQuery } from './fileCache';
import { toFileTree } from '@/api/frontendModels';

interface UseFilesProps {
  /** Defer the initial fetch until auth has been resolved. */
  enabled?: boolean;
}

const uploadPath = (file: File): string => file.name;

/** Coordinates user file tree loading plus upload/delete/download actions for data-loader panels. */
/**
 * Used by: src/features/views/data-loader/DataLoaderFeature.tsx.
 * Flow: fetch the file tree, wire upload/delete mutations to cache invalidation, then expose selection and file actions for data-loader panels.
 */
export const useFiles = ({ enabled = true }: UseFilesProps = {}) => {
  const queryClient = useQueryClient();

  const filesQuery = useQuery<FileTreeNode[]>({
    queryKey: queryKeys.files,
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

  const uploadMutation = useMutation({
    /** Uploads a browser File object through the generated SDK for file panel actions. */
    /** Called by: the upload mutation when `handleUploadFile` invokes `mutateAsync`. */
    mutationFn: (file: File) =>
      uploadFile({
        body: file,
        query: { path: uploadPath(file) },
        throwOnError: true,
      }),
    onSuccess: () => invalidateFilesQuery(queryClient),
  });

  const deleteMutation = useMutation({
    /** Deletes the selected server-side file and lets mutation success refresh the tree. */
    /** Called by: the delete mutation when `handleDeleteFile` invokes `mutateAsync`. */
    mutationFn: (filename: string) =>
      deleteFile({
        query: { path: filename },
        throwOnError: true,
      }),
    onSuccess: () => invalidateFilesQuery(queryClient),
  });

  /**
   * Runs only the explicit user-requested file-list refresh command. Used by:
   * Data Loader's Refresh button; mutation owners invalidate through
   * `invalidateFilesQuery` instead of calling this command.
   */
  const refreshFiles = async () => (await filesQuery.refetch()).data ?? null;

  /** Uploads a selected file and returns a boolean so panels can update inline status. */
  /** Returned to: `DataLoaderFeature`, which passes it into `useUploadState`. */
  const handleUploadFile = async (file: File) => {
    try {
      await uploadMutation.mutateAsync(file);
      return true;
    } catch (error) {
      console.error('Failed to upload file:', error);
      return false;
    }
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
      const { data } = await downloadFile({
        parseAs: 'blob',
        query: { path: filename },
        throwOnError: true,
      });
      const blob = data;
      await saveBlob(new Blob([blob]), filename);
      return true;
    } catch (error) {
      console.error('Failed to download file:', error);
      return false;
    }
  };

  return {
    fileTree: filesQuery.data ?? [],
    selectedFile,
    setSelectedFile,
    loadingFiles: filesQuery.isLoading || filesQuery.isFetching,
    uploading: uploadMutation.isPending,
    handleUploadFile,
    handleDeleteFile,
    handleDownloadFile,
    refreshFiles,
  };
};
