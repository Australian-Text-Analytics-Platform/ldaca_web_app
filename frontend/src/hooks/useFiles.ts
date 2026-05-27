import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteFile, downloadFile, getUserFiles, uploadFile } from '@/api/generated/sdk.gen';
import { saveBlob } from '../lib/download';
import { type FileTreeNode } from '../types';
import { queryKeys } from '../lib/queryKeys';

interface UseFilesProps {
  authHeaders?: Record<string, string>;
  /** Defer the initial fetch until auth has been resolved. */
  enabled?: boolean;
}

export const useFiles = ({ authHeaders = {}, enabled = true }: UseFilesProps = {}) => {
  const queryClient = useQueryClient();

  const filesQuery = useQuery<FileTreeNode[]>({
    queryKey: queryKeys.files,
    queryFn: async () => {
      const { data } = await getUserFiles({ headers: authHeaders, throwOnError: true });
      return data as FileTreeNode[];
    },
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const invalidateFiles = () => queryClient.invalidateQueries({ queryKey: queryKeys.files });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadFile({ body: { file }, headers: authHeaders, throwOnError: true }),
    onSuccess: invalidateFiles,
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => deleteFile({
      headers: authHeaders,
      path: { filename },
      throwOnError: true,
    }),
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
      const { data } = await downloadFile({
        headers: authHeaders,
        parseAs: 'blob',
        path: { filename },
        throwOnError: true,
      });
      const blob = data as Blob;
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
