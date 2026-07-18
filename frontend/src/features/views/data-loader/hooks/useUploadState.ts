import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

type UploadFile = (file: File) => Promise<boolean>;

interface UseUploadStateParams {
  uploadFile: UploadFile;
  notify: Notify;
}

/**
 * Detects native file drags so Data Loader does not intercept unrelated text or
 * internal file-tree move drags.
 * Called by the upload area's drag-over, drag-leave, and drop handlers.
 */
function isFileDrag(event: DragEvent<HTMLElement>) {
  // dataTransfer/types are typed non-null by React but can be absent on some browsers/synthetic drags
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Owns upload picker/drop-zone state for Data Loader. The feature consumes the
 * returned handlers for both the hidden file input and drag-and-drop upload
 * area.
 * Used by `DataLoaderFeature` for its upload button, hidden input, and drop zone.
 * Flow: normalize picker/drop input into file arrays, serialize uploads through the provided
 * upload function, manage drag/busy state, and notify success/failure counts.
 */
export function useUploadState({ uploadFile, notify }: UseUploadStateParams) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [isFileDropActive, setIsFileDropActive] = useState(false);

  /**
   * Opens the hidden file input from the visible Upload files button.
   * Returned to `DataLoaderFeature` as the button's click handler.
   */
  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  /**
   * Uploads one or more selected files sequentially, tracks partial failures,
   * and reports aggregate success or failure.
   * Shared by the picker-change and drop handlers below.
   * Steps: copy the selected list, skip empty batches, upload files sequentially so
   * notifications match actual outcomes, then reset busy/drop state.
   */
  const uploadSelectedFiles = async (filesToUpload: FileList | File[] | null | undefined) => {
    const selectedFiles = Array.from(filesToUpload ?? []);
    if (selectedFiles.length === 0) {
      return;
    }

    setUploadingFiles(true);
    let uploadedCount = 0;
    const failedFiles: string[] = [];
    try {
      for (const file of selectedFiles) {
        try {
          const success = await uploadFile(file);
          if (success) {
            uploadedCount += 1;
          } else {
            failedFiles.push(file.name);
          }
        } catch {
          failedFiles.push(file.name);
        }
      }

      if (failedFiles.length === 0) {
        if (uploadedCount === 1) {
          notify('success', `Uploaded ${selectedFiles[0]?.name ?? ''}.`);
        } else {
          notify('success', `Uploaded ${String(uploadedCount)} files.`);
        }
        return;
      }

      if (uploadedCount === 0) {
        notify(
          'error',
          `Failed to upload ${
            failedFiles.length === 1
              ? (failedFiles[0] ?? '')
              : `${String(failedFiles.length)} files`
          }.`,
        );
        return;
      }

      notify(
        'error',
        `Uploaded ${String(uploadedCount)} of ${String(selectedFiles.length)} files. Failed: ${failedFiles.join(', ')}.`,
      );
    } finally {
      setUploadingFiles(false);
    }
  };

  /**
   * Activates the drop-zone state for native file drags and tells the browser
   * this target accepts copy drops.
   * Attached to the upload area's `onDragOver` prop.
   */
  const handleFileAreaDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsFileDropActive(true);
  };

  /**
   * Clears drop-zone highlighting once the native file drag leaves the upload
   * area rather than a child element inside it.
   * Attached to the upload area's `onDragLeave` prop.
   */
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

  /**
   * Accepts dropped native files from the upload area and reuses the same batch
   * upload path as the picker.
   * Attached to the upload area's `onDrop` prop.
   */
  const handleFileAreaDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    setIsFileDropActive(false);
    await uploadSelectedFiles(event.dataTransfer.files);
  };

  /**
   * Handles the hidden file input change event and clears its value so the same
   * files can be selected again later.
   * Attached to the hidden input's `onChange` prop.
   */
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
