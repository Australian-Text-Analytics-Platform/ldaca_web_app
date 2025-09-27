import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '../api/files';
import { FileInfo, FileListResponse } from '../types';
import { queryKeys } from '../lib/queryKeys';

interface UseFilesProps {
  authHeaders?: Record<string, string>;
  enabled?: boolean; // allow caller to defer initial fetch until ready (e.g., after auth)
}

export const useFiles = ({ authHeaders = {}, enabled = true }: UseFilesProps = {}) => {
  const queryClient = useQueryClient();
  const normalizedHeaders = useMemo(() => authHeaders ?? {}, [authHeaders]);
  const headerSignature = useMemo(() => JSON.stringify(normalizedHeaders), [normalizedHeaders]);
  const filesQuery = useQuery<FileListResponse>({
    queryKey: [...queryKeys.files, headerSignature],
    queryFn: () => filesApi.list(normalizedHeaders),
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedFile, setLoadedFile] = useState<string | null>(null);
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

  const files = (filesQuery.data?.files || []) as FileInfo[];
  const fileListResponse = filesQuery.data ?? null;
  const refetchFiles = useCallback(async () => {
    const result = await filesQuery.refetch();
    return result.data ?? null;
  }, [filesQuery]);

  const handleLoadFile = useCallback(async (filename: string) => {
    setLoading(true);
    try {
  // Loading a file into a workspace context isn't part of filesApi; retaining placeholder if backend adds it.
  // For now just set loadedFile for UI consistency.
      setLoadedFile(filename);
      return true;
    } catch (error) {
      console.error('Failed to load file:', error);
      return false;
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const handleUploadFile = useCallback(async (file: File) => {
    try {
      await uploadMutation.mutateAsync(file);
      await refetchFiles();
      return true;
    } catch (error) {
      console.error('Failed to upload file:', error);
      return false;
    }
  }, [uploadMutation, refetchFiles]);

  const handleDeleteFile = useCallback(async (filename: string) => {
    try {
      await deleteMutation.mutateAsync(filename);
      await refetchFiles();
      if (selectedFile === filename) {
        setSelectedFile(null);
      }
      if (loadedFile === filename) {
        setLoadedFile(null);
      }
      return true;
    } catch (error) {
      console.error('Failed to delete file:', error);
      return false;
    }
  }, [deleteMutation, refetchFiles, selectedFile, loadedFile]);

  const handleDownloadFile = useCallback(async (filename: string) => {
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
  }, [normalizedHeaders]);

  return {
    files,
    fileListResponse,
    selectedFile,
    setSelectedFile,
  loadingFiles: filesQuery.isLoading || filesQuery.isFetching,
    loading,
    uploading: uploadMutation.isPending,
    loadedFile,
    handleLoadFile,
    handleUploadFile,
    handleDeleteFile,
    handleDownloadFile,
    refetchFiles,
  };
};
