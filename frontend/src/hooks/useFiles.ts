import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '../api/files';
import { type FileTreeNode } from '../types';
import { queryKeys } from '../lib/queryKeys';

interface UseFilesProps {
  authHeaders?: Record<string, string>;
  enabled?: boolean; // allow caller to defer initial fetch until ready (e.g., after auth)
}

export const useFiles = ({ authHeaders = {}, enabled = true }: UseFilesProps = {}) => {
  const queryClient = useQueryClient();
  const normalizedHeaders = authHeaders ?? {};
  const headerSignature = JSON.stringify(normalizedHeaders);
  const filesQuery = useQuery<FileTreeNode[]>({
    queryKey: [...queryKeys.files, headerSignature],
    queryFn: () => filesApi.list(normalizedHeaders),
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const uploadMutation = useMutation({
    mutationFn: (file: File) => filesApi.upload(file, normalizedHeaders),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.files });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (filename: string) => filesApi.delete(filename, normalizedHeaders),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.files });
    },
  });

  const fileTree = filesQuery.data ?? [];
  const refetchFiles = async () => {
    const result = await filesQuery.refetch();
    return result.data ?? null;
  };

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
      if (selectedFile === filename) {
        setSelectedFile(null);
      }
      return true;
    } catch (error) {
      console.error('Failed to delete file:', error);
      return false;
    }
  };

  const handleDownloadFile = async (filename: string) => {
    try {
      const blob = await filesApi.download(filename, normalizedHeaders);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error('Failed to download file:', error);
      return false;
    }
  };

  return {
    fileTree,
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
