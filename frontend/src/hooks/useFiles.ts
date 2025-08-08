import { useState, useEffect, useCallback } from 'react';
import { getFiles, loadFile, downloadFile, uploadFile, deleteFile } from '../api';
import { FileInfo, FileListResponse } from '../types';

interface UseFilesProps {
  authHeaders?: Record<string, string>;
}

export const useFiles = ({ authHeaders = {} }: UseFilesProps = {}) => {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [fileListResponse, setFileListResponse] = useState<FileListResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedFile, setLoadedFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await getFiles(authHeaders);
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
      await loadFile(filename, authHeaders);
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
      await uploadFile(file, authHeaders);
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
      await deleteFile(filename, authHeaders);
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
      const blob = await downloadFile(filename, authHeaders);
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
    fetchFiles();
  }, [fetchFiles]);

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
