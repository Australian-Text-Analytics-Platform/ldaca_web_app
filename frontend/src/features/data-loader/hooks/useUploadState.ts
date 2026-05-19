import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useUIStore } from '@/stores/uiStore';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

type UploadFile = (file: File) => Promise<boolean>;

interface UseUploadStateParams {
  uploadFile: UploadFile;
  notify: Notify;
}

function isFileDrag(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function useUploadState({ uploadFile, notify }: UseUploadStateParams) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [isFileDropActive, setIsFileDropActive] = useState(false);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const uploadSelectedFiles = async (
    filesToUpload: FileList | File[] | null | undefined,
  ) => {
    const selectedFiles = Array.from(filesToUpload ?? []);
    if (selectedFiles.length === 0) {
      return;
    }

    setUploadingFiles(true);
    let uploadedCount = 0;
    const failedFiles: string[] = [];
    const setLastUploadedFilePath = useUIStore.getState().setLastUploadedFilePath;
    let lastSuccess: string | null = null;

    try {
      for (const file of selectedFiles) {
        try {
          const success = await uploadFile(file);
          if (success) {
            uploadedCount += 1;
            lastSuccess = file.name;
          } else {
            failedFiles.push(file.name);
          }
        } catch {
          failedFiles.push(file.name);
        }
      }

      if (lastSuccess) {
        setLastUploadedFilePath(lastSuccess);
      }

      if (failedFiles.length === 0) {
        if (uploadedCount === 1) {
          notify('success', `Uploaded ${selectedFiles[0]?.name}.`);
        } else {
          notify('success', `Uploaded ${uploadedCount} files.`);
        }
        return;
      }

      if (uploadedCount === 0) {
        notify(
          'error',
          `Failed to upload ${
            failedFiles.length === 1 ? failedFiles[0] : `${failedFiles.length} files`
          }.`,
        );
        return;
      }

      notify(
        'error',
        `Uploaded ${uploadedCount} of ${selectedFiles.length} files. Failed: ${failedFiles.join(', ')}.`,
      );
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleFileAreaDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsFileDropActive(true);
  };

  const handleFileAreaDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) {
      return;
    }

    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setIsFileDropActive(false);
  };

  const handleFileAreaDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    setIsFileDropActive(false);
    await uploadSelectedFiles(event.dataTransfer.files);
  };

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    try {
      await uploadSelectedFiles(event.target.files);
    } catch (error) {
      notify('error', (error as Error).message || 'Upload failed.');
    } finally {
      event.target.value = '';
    }
  };

  return {
    fileInputRef,
    uploadingFiles,
    isFileDropActive,
    openFilePicker,
    handleFileAreaDragOver,
    handleFileAreaDragLeave,
    handleFileAreaDrop,
    handleFileInputChange,
  };
}
