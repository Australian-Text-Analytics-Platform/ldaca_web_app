import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '../api/files';
import { saveBlob } from '../lib/download';
import { type FileTreeNode } from '../types';
import { queryKeys } from '../lib/queryKeys';

/**
 * Hook returning the file-tree state plus file upload/delete/download actions.
 *
 * The file list is cached per auth-header signature so switching users (or
 * clearing the token) doesn't surface the previous user's files. Each mutation
 * invalidates `queryKeys.files` and returns a `boolean` success so callers can
 * trigger toast-style UI without needing to catch promises.
 */
interface UseFilesProps {
  authHeaders?: Record<string, string>;
  /** Defer the initial fetch until auth has been resolved. */
  enabled?: boolean;
}

export const useFiles = ({ authHeaders = {}, enabled = true }: UseFilesProps = {}) => {
  const queryClient = useQueryClient();
  // The header signature ensures the query cache key changes when auth does;
  // otherwise a logged-out user would briefly see the prior user's tree.
  const headerSignature = JSON.stringify(authHeaders);

  const filesQuery = useQuery<FileTreeNode[]>({
    queryKey: [...queryKeys.files, headerSignature],
    queryFn: () => filesApi.list(authHeaders),
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const invalidateFiles = () => queryClient.invalidateQueries({ queryKey: queryKeys.files });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => filesApi.upload(file, authHeaders),
    onSuccess: invalidateFiles,
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => filesApi.delete(filename, authHeaders),
    onSuccess: invalidateFiles,
  });

  const refetchFiles = async () => (await filesQuery.refetch()).data ?? null;

  const handleUploadFile = async (file: File) => {
    try {
      await uploadMutation.mutateAsync(file);
      await refetchFiles();
      return true;
    } catch (error) {
      console.error('Failed to upload file:', error);
      return false;
    }
  };

  const handleDeleteFile = async (filename: string) => {
    try {
      await deleteMutation.mutateAsync(filename);
      await refetchFiles();
      if (selectedFile === filename) setSelectedFile(null);
      return true;
    } catch (error) {
      console.error('Failed to delete file:', error);
      return false;
    }
  };

  const handleDownloadFile = async (filename: string) => {
    try {
      const blob = await filesApi.download(filename, authHeaders);
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
    refetchFiles,
  };
};
