import type { FileTreeDirectory } from '@/features/views/data-loader/types';

export interface FileBrowserCitationState {
  directory: FileTreeDirectory | null;
  path: string | null;
  content: string | null;
  loading: boolean;
}

export type FileBrowserCitationAction =
  | { type: 'openWithoutReadme'; directory: FileTreeDirectory }
  | { type: 'startLoading'; directory: FileTreeDirectory; path: string }
  | { type: 'loaded'; content: string }
  | { type: 'failed' }
  | { type: 'close' };

export const createFileBrowserCitationState = (): FileBrowserCitationState => ({
  directory: null,
  path: null,
  content: null,
  loading: false,
});

/**
 * Owns the citation dialog lifecycle for the Data Loader file browser.
 * Used by: useFileBrowserActions so opening a folder, fetching README text,
 * handling fetch failure, and closing the dialog update one state object.
 */
export const fileBrowserCitationReducer = (
  state: FileBrowserCitationState,
  action: FileBrowserCitationAction,
): FileBrowserCitationState => {
  switch (action.type) {
    case 'openWithoutReadme':
      return {
        directory: action.directory,
        path: null,
        content: null,
        loading: false,
      };
    case 'startLoading':
      return {
        directory: action.directory,
        path: action.path,
        content: null,
        loading: true,
      };
    case 'loaded':
      return {
        ...state,
        content: action.content,
        loading: false,
      };
    case 'failed':
      return {
        ...state,
        loading: false,
      };
    case 'close':
      return createFileBrowserCitationState();
  }
};
