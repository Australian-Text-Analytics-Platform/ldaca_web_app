import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { FileResource } from '@/api';
import { isExternalFileDrag } from '@/lib/externalFileDropGuard';
import type { FileTreeNode } from '../types';
import {
  collectDroppedSelection,
  collectPickerSelection,
  computeUploadConflicts,
  getMissingUploadDirectories,
  prepareUploadSelection,
  type DroppedEntry,
  type UploadSelectionInput,
} from '../utils/uploadSelection';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

export type UploadActivity =
  | { phase: 'idle' }
  | { phase: 'preparing' }
  | { phase: 'creating-folders'; current: number; total: number; path: string }
  | { phase: 'uploading'; current: number; total: number; path: string };

interface UseUploadStateParams {
  createUploadDirectory: (path: string) => Promise<void>;
  getUploadResource: (path: string) => Promise<FileResource>;
  notify: Notify;
  refreshFiles: () => Promise<FileTreeNode[] | null>;
  uploadFileAtPath: (file: File, path: string) => Promise<void>;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return 'Unexpected error';
}

function isResourceConflict(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'resource_conflict'
  );
}

function skippedSummary(skipped: { files: number; directories: number }) {
  if (skipped.files === 0 && skipped.directories === 0) return '';
  return ` Skipped ${String(skipped.files)} hidden ${skipped.files === 1 ? 'file' : 'files'} and ${String(skipped.directories)} hidden ${skipped.directories === 1 ? 'folder' : 'folders'}.`;
}

/** Coordinates every picker and drop upload through one preflighted, cancellable pipeline. */
export function useUploadState({
  createUploadDirectory,
  getUploadResource,
  notify,
  refreshFiles,
  uploadFileAtPath,
}: UseUploadStateParams) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRequestedRef = useRef(false);
  const busyRef = useRef(false);
  const [activity, setActivity] = useState<UploadActivity>({ phase: 'idle' });
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const openFilePicker = () => fileInputRef.current?.click();
  const openFolderPicker = () => folderInputRef.current?.click();

  const cancelUpload = () => {
    cancelRequestedRef.current = true;
  };

  const closeConflictDialog = () => {
    setConflicts([]);
  };

  const isCancellationRequested = () => cancelRequestedRef.current;

  const runUploadSelection = async (input: UploadSelectionInput) => {
    if (input.unsupportedFolderDrop) {
      notify('info', 'Folder drop is not supported here. Use Upload folder instead.');
      return;
    }

    const selection = prepareUploadSelection(input);
    if (selection.files.length === 0) {
      notify('info', `No uploadable files found.${skippedSummary(selection.skipped)}`);
      return;
    }

    if (isCancellationRequested()) {
      notify(
        'info',
        `Upload cancelled after 0 of ${String(selection.files.length)} files.${skippedSummary(selection.skipped)}`,
      );
      return;
    }

    const completeTree = (await refreshFiles()) ?? [];
    if (isCancellationRequested()) {
      notify(
        'info',
        `Upload cancelled after 0 of ${String(selection.files.length)} files.${skippedSummary(selection.skipped)}`,
      );
      return;
    }
    const detectedConflicts = computeUploadConflicts(selection, completeTree);
    if (detectedConflicts.length > 0) {
      setConflicts(detectedConflicts);
      return;
    }

    const missingDirectories = getMissingUploadDirectories(selection, completeTree);
    let attemptedMutation = false;
    let createdFolders = 0;
    let uploadedFiles = 0;
    let cancelled = false;
    let failure: { path: string; error: unknown } | null = null;

    for (let index = 0; index < missingDirectories.length; index += 1) {
      const path = missingDirectories[index] ?? '';
      if (isCancellationRequested()) {
        cancelled = true;
        break;
      }
      setActivity({
        phase: 'creating-folders',
        current: index + 1,
        total: missingDirectories.length,
        path,
      });
      attemptedMutation = true;
      try {
        await createUploadDirectory(path);
        createdFolders += 1;
      } catch (error) {
        if (isResourceConflict(error)) {
          try {
            const resource = await getUploadResource(path);
            if (resource.type !== 'directory') failure = { path, error };
          } catch {
            failure = { path, error };
          }
        } else {
          failure = { path, error };
        }
      }
      if (failure) break;
      if (isCancellationRequested()) {
        cancelled = true;
        break;
      }
    }

    if (!failure && !cancelled) {
      for (let index = 0; index < selection.files.length; index += 1) {
        const candidate = selection.files[index];
        if (!candidate) continue;
        if (isCancellationRequested()) {
          cancelled = true;
          break;
        }
        setActivity({
          phase: 'uploading',
          current: index + 1,
          total: selection.files.length,
          path: candidate.relativePath,
        });
        attemptedMutation = true;
        try {
          await uploadFileAtPath(candidate.file, candidate.relativePath);
          uploadedFiles += 1;
        } catch (error) {
          failure = { path: candidate.relativePath, error };
          break;
        }
        if (isCancellationRequested()) {
          cancelled = true;
          break;
        }
      }
    }

    let refreshFailure: unknown = null;
    if (attemptedMutation) {
      try {
        await refreshFiles();
      } catch (error) {
        refreshFailure = error;
      }
    }

    const skips = skippedSummary(selection.skipped);
    if (failure) {
      notify(
        'error',
        `Upload failed at ${failure.path} after ${String(uploadedFiles)} of ${String(selection.files.length)} files: ${errorMessage(failure.error)}${skips}`,
      );
    } else if (cancelled) {
      notify(
        'info',
        `Upload cancelled after ${String(uploadedFiles)} of ${String(selection.files.length)} files.${skips}`,
      );
    } else if (refreshFailure) {
      notify(
        'error',
        `Uploaded ${String(uploadedFiles)} ${uploadedFiles === 1 ? 'file' : 'files'}, but refreshing User File failed: ${errorMessage(refreshFailure)}${skips}`,
      );
    } else {
      const folderSummary =
        createdFolders > 0
          ? ` Created ${String(createdFolders)} ${createdFolders === 1 ? 'folder' : 'folders'}.`
          : '';
      notify(
        'success',
        `Uploaded ${String(uploadedFiles)} ${uploadedFiles === 1 ? 'file' : 'files'}.${folderSummary}${skips}`,
      );
    }
  };

  const beginUpload = async (collect: () => Promise<UploadSelectionInput>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    cancelRequestedRef.current = false;
    setConflicts([]);
    setActivity({ phase: 'preparing' });
    try {
      await runUploadSelection(await collect());
    } catch (error) {
      notify('error', `Could not prepare the upload: ${errorMessage(error)}`);
    } finally {
      setActivity({ phase: 'idle' });
      busyRef.current = false;
    }
  };

  const uploadSelectedFiles = async (files: File[]) => {
    await beginUpload(() => Promise.resolve(collectPickerSelection(files)));
  };

  const handleFileAreaDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event.dataTransfer) || busyRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsFileDropActive(true);
  };

  const handleFileAreaDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event.dataTransfer)) return;
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setIsFileDropActive(false);
  };

  const handleFileAreaDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event.dataTransfer) || busyRef.current) return;
    event.preventDefault();
    setIsFileDropActive(false);
    // Synthetic and older webviews can expose files without a DataTransferItemList.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const items = Array.from(event.dataTransfer.items ?? []).filter((item) => item.kind === 'file');
    await beginUpload(async () => {
      if (items.length === 0) return collectPickerSelection(Array.from(event.dataTransfer.files));
      const entries: DroppedEntry[] = [];
      const fallbackFiles: File[] = [];
      let unsupportedFolderDrop = false;
      for (const item of items) {
        const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        if (entry) entries.push(entry);
        else {
          const fallbackFile = item.getAsFile();
          if (fallbackFile) fallbackFiles.push(fallbackFile);
          else unsupportedFolderDrop = true;
        }
      }
      if (unsupportedFolderDrop) {
        return {
          candidates: [],
          folderRoots: [],
          skipped: { files: 0, directories: 0 },
          unsupportedFolderDrop: true,
        };
      }
      const dropped = await collectDroppedSelection(entries);
      const fallback = collectPickerSelection(fallbackFiles);
      return {
        candidates: [...dropped.candidates, ...fallback.candidates],
        folderRoots: dropped.folderRoots,
        skipped: {
          files: dropped.skipped.files + fallback.skipped.files,
          directories: dropped.skipped.directories + fallback.skipped.directories,
        },
        unsupportedFolderDrop: false,
      };
    });
  };

  const handleInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    try {
      await uploadSelectedFiles(Array.from(event.target.files ?? []));
    } finally {
      event.target.value = '';
    }
  };

  const progressText =
    activity.phase === 'preparing'
      ? 'Preparing…'
      : activity.phase === 'creating-folders'
        ? `Creating folder ${String(activity.current)} of ${String(activity.total)}: ${activity.path}`
        : activity.phase === 'uploading'
          ? `Uploading file ${String(activity.current)} of ${String(activity.total)}: ${activity.path}`
          : '';

  return {
    fileInputRef,
    folderInputRef,
    activity,
    progressText,
    isBusy: activity.phase !== 'idle',
    isFileDropActive,
    conflicts,
    openFilePicker,
    openFolderPicker,
    cancelUpload,
    closeConflictDialog,
    uploadSelectedFiles,
    handleFileAreaDragOver,
    handleFileAreaDragLeave,
    handleFileAreaDrop,
    handleFileInputChange: handleInputChange,
    handleFolderInputChange: handleInputChange,
  };
}
