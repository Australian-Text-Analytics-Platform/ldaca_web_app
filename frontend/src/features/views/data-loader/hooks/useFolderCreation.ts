import { useReducer } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createFolder } from '@/api';
import { invalidateFilesQuery } from './fileCache';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface UseFolderCreationParams {
  authHeaders: Record<string, string>;
  notify: Notify;
}

interface FolderCreationState {
  createFolderOpen: boolean;
  createFolderParentPath: string;
  createFolderParentLabel: string;
  newFolderName: string;
  creatingFolder: boolean;
  folderNameAlert: string | null;
}

type FolderCreationAction =
  | { type: 'open-dialog'; parentPath: string; parentLabel: string }
  | { type: 'set-open'; open: boolean }
  | { type: 'set-name'; name: string }
  | { type: 'create-started' }
  | { type: 'create-succeeded' }
  | { type: 'create-finished' }
  | { type: 'invalid-name'; message: string }
  | { type: 'close-name-alert' };

const initialFolderCreationState: FolderCreationState = {
  createFolderOpen: false,
  createFolderParentPath: '',
  createFolderParentLabel: 'root',
  newFolderName: '',
  creatingFolder: false,
  folderNameAlert: null,
};

/**
 * Owns create-folder dialog transitions as one state machine.
 * Used by: useFolderCreation so the dialog open state, selected parent,
 * draft name, submit spinner, and invalid-name alert cannot drift across
 * independent setters.
 * Flow: opening selects a parent and clears stale form state, closing discards
 * drafts, submit transitions set/clear the spinner, and invalid names stay in
 * the dialog while surfacing the alert message.
 */
function folderCreationReducer(
  state: FolderCreationState,
  action: FolderCreationAction,
): FolderCreationState {
  switch (action.type) {
    case 'open-dialog':
      return {
        ...state,
        createFolderOpen: true,
        createFolderParentPath: action.parentPath,
        createFolderParentLabel: action.parentLabel,
        newFolderName: '',
        folderNameAlert: null,
      };
    case 'set-open':
      return action.open
        ? { ...state, createFolderOpen: true }
        : { ...state, createFolderOpen: false, newFolderName: '', folderNameAlert: null };
    case 'set-name':
      return { ...state, newFolderName: action.name };
    case 'create-started':
      return { ...state, creatingFolder: true };
    case 'create-succeeded':
      return {
        ...state,
        createFolderOpen: false,
        newFolderName: '',
        creatingFolder: false,
        folderNameAlert: null,
      };
    case 'invalid-name':
      return { ...state, creatingFolder: false, folderNameAlert: action.message };
    case 'create-finished':
      return { ...state, creatingFolder: false };
    case 'close-name-alert':
      return { ...state, folderNameAlert: null };
    default:
      return state;
  }
}

/**
 * Manages the create-folder dialog state and backend mutation for the Data
 * Loader file browser.
 * Used by: DataLoaderFeature module and DataLoaderDialogs component because
 * they need shared dialog state, validation feedback, and cache side effects
 * without duplicating folder-creation mutation logic.
 * Flow: tracks the selected parent, resets stale draft/error state when opened,
 * then submits the trimmed folder name and invalidates the browser on success.
 */
export function useFolderCreation({ authHeaders, notify }: UseFolderCreationParams) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(folderCreationReducer, initialFolderCreationState);

  /**
   * Opens folder creation for a specific parent row while clearing any previous
   * draft or validation alert.
   * Called by: FileTree/DataLoaderFeature actions because the dialog needs the
   * target parent path and a clean form before the user types a folder name.
   */
  const openCreateFolderDialog = (parentPath: string, parentLabel: string) => {
    dispatch({ type: 'open-dialog', parentPath, parentLabel });
  };

  /**
   * Creates the folder, invalidates the file browser, and routes invalid-name
   * errors to the alert dialog shown by `DataLoaderDialogs`.
   * Called by: DataLoaderDialogs submit handling because the UI needs one
   * guarded path for validation, backend mutation, invalidation, toast, and cleanup.
   * Steps: ignore blank names, mark the request busy, call the generated API,
   * invalidate files, then split invalid-name errors into dialog alerts.
   */
  const handleCreateFolder = async () => {
    const trimmedName = state.newFolderName.trim();
    if (!trimmedName) {
      return;
    }

    dispatch({ type: 'create-started' });
    try {
      await createFolder({
        body: { parent_path: state.createFolderParentPath, name: trimmedName },
        headers: authHeaders,
        throwOnError: true,
      });
      await invalidateFilesQuery(queryClient);
      notify('success', `Folder "${trimmedName}" created.`);
      dispatch({ type: 'create-succeeded' });
    } catch (error) {
      // read message off any thrown value; an empty message should fall through to the fallback
      const errorMessage = (error as { message?: string } | undefined)?.message;
      const message =
        typeof errorMessage === 'string' && errorMessage.length > 0
          ? errorMessage
          : 'Failed to create folder.';
      if (message.toLowerCase().includes('invalid folder name')) {
        dispatch({ type: 'invalid-name', message });
        return;
      }
      notify('error', message);
    } finally {
      dispatch({ type: 'create-finished' });
    }
  };

  return {
    createFolderOpen: state.createFolderOpen,
    /**
     * Consumed by: DataLoaderDialogs Dialog `onOpenChange` because closing the
     * modal should also discard stale draft and invalid-name state owned here.
     */
    setCreateFolderOpen: (open: boolean) => {
      dispatch({ type: 'set-open', open });
    },
    createFolderParentPath: state.createFolderParentPath,
    createFolderParentLabel: state.createFolderParentLabel,
    newFolderName: state.newFolderName,
    setNewFolderName: (name: string) => {
      dispatch({ type: 'set-name', name });
    },
    creatingFolder: state.creatingFolder,
    folderNameAlert: state.folderNameAlert,
    /**
     * Consumed by: DataLoaderDialogs because it needs to dismiss validation alerts
     * while leaving folder mutation state inside this hook.
     */
    closeFolderNameAlert: () => {
      dispatch({ type: 'close-name-alert' });
    },
    openCreateFolderDialog,
    handleCreateFolder,
  };
}
