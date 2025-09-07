import { useState, useEffect, useCallback, useRef } from 'react';
import { filesApi } from '../api/files';
import { FileInfo, FileListResponse } from '../types';

interface UseFilesProps {
  authHeaders?: Record<string, string>;
  enabled?: boolean; // allow caller to defer initial fetch until ready (e.g., after auth)
}

export const useFiles = ({ authHeaders = {}, enabled = true }: UseFilesProps = {}) => {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [fileListResponse, setFileListResponse] = useState<FileListResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedFile, setLoadedFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const hasFetchedRef = useRef(false);
  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
  const res = await filesApi.list(authHeaders);
      setFileListResponse(res);
      setFiles(res.files || []);
    } catch (error) {
      console.error('Failed to fetch files:', error);
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, [authHeaders]);

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
    setUploading(true);
    try {
  await filesApi.upload(file, authHeaders);
      await fetchFiles(); // Refresh file list
      return true;
    } catch (error) {
      console.error('Failed to upload file:', error);
      return false;
    } finally {
      setUploading(false);
    }
  }, [authHeaders, fetchFiles]);

  const handleDeleteFile = useCallback(async (filename: string) => {
    try {
  await filesApi.delete(filename, authHeaders);
      await fetchFiles(); // Refresh file list
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
  }, [authHeaders, fetchFiles, selectedFile, loadedFile]);

  const handleDownloadFile = useCallback(async (filename: string) => {
    try {
  const blob = await filesApi.download(filename, authHeaders);
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
  }, [authHeaders]);

  useEffect(() => {
    if (!enabled) return; // do not fetch until enabled
    // Avoid duplicate initial fetches (e.g., React StrictMode double-mount or auth state transition immediately after mount)
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    fetchFiles();
  }, [enabled, fetchFiles]);

  return {
    files,
    fileListResponse,
    selectedFile,
    setSelectedFile,
    loadingFiles,
    loading,
    uploading,
    loadedFile,
    handleLoadFile,
    handleUploadFile,
    handleDeleteFile,
    handleDownloadFile,
  refetchFiles: fetchFiles
  };
};
