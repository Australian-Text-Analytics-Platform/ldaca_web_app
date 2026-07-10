import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteFile, downloadFile, getUserFiles, uploadFile } from '@/api';
import { saveBlob } from '@/lib/download';
import { type FileTreeNode } from '../types';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateFilesQuery } from './fileCache';

interface UseFilesProps {
  authHeaders?: Record<string, string>;
  /** Defer the initial fetch until auth has been resolved. */
  enabled?: boolean;
}

/** Coordinates user file tree loading plus upload/delete/download actions for data-loader panels. */
/**
 * Used by: src/features/views/data-loader/DataLoaderFeature.tsx because the hook needs local steps to normalize inputs before exposing stable state to consumers.
 * Flow: fetch the file tree, wire upload/delete mutations to cache invalidation, then expose selection and file actions for data-loader panels.
 */
export const useFiles = ({ authHeaders = {}, enabled = true }: UseFilesProps = {}) => {
  const queryClient = useQueryClient();

  const filesQuery = useQuery<FileTreeNode[]>({
    queryKey: queryKeys.files,
    /**
     * Fetches the user-visible file tree for data-loader consumers.
     * Why: hook consumers need one stable boundary for state, effects, and cache coordination.
     */
    queryFn: async () => {
      const { data } = await getUserFiles({ headers: authHeaders, throwOnError: true });
      return data as FileTreeNode[];
    },
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const uploadMutation = useMutation({
    /** Uploads a browser File object through the generated SDK for file panel actions. */
    /** Called by: TanStack Mutation inside useFiles because mutation callers need one async action path for pending, success, and error handling. */
    mutationFn: (file: File) =>
      uploadFile({ body: { file }, headers: authHeaders, throwOnError: true }),
    onSuccess: () => invalidateFilesQuery(queryClient),
  });

  const deleteMutation = useMutation({
    /** Deletes the selected server-side file and lets mutation success refresh the tree. */
    /** Called by: TanStack Mutation inside useFiles because mutation callers need one async action path for pending, success, and error handling. */
    mutationFn: (filename: string) =>
      deleteFile({
        headers: authHeaders,
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
  /** Used by: useFiles callback wiring in this module because the component or hook needs a named callback boundary for effect and prop handoff steps. */
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
  /** Used by: useFiles callback wiring in this module because the component or hook needs a named callback boundary for effect and prop handoff steps. */
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
  /** Used by: useFiles callback wiring in this module because the component or hook needs a named callback boundary for effect and prop handoff steps. */
  const handleDownloadFile = async (filename: string) => {
    try {
      const { data } = await downloadFile({
        headers: authHeaders,
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
