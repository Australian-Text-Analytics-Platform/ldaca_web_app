import type { OniSearchRequest, OniSearchResult as LdacaSearchResult } from '@/api';

export type LdacaSearchMethod = Extract<
  NonNullable<OniSearchRequest['method']>,
  'keyword' | 'identifier'
>;

export interface LdacaImportState {
  ldacaImportOpen: boolean;
  searchMethod: LdacaSearchMethod;
  searchQuery: string;
  collectionFilter: string;
  fileFormatFilter: string;
  featuredRecords: LdacaSearchResult[];
  searchResults: LdacaSearchResult[];
  hasSearched: boolean;
  featuredLoaded: boolean;
  featuredLoading: boolean;
  searching: boolean;
  importingId: string | undefined;
  errorMessage: string | undefined;
}

type LdacaImportAction =
  | { type: 'setOpen'; open: boolean }
  | { type: 'setSearchMethod'; method: LdacaSearchMethod }
  | { type: 'setSearchQuery'; query: string }
  | { type: 'setCollectionFilter'; value: string }
  | { type: 'setFileFormatFilter'; value: string }
  | { type: 'featuredInvalidated' }
  | { type: 'featuredStarted' }
  | { type: 'featuredSucceeded'; records: LdacaSearchResult[] }
  | { type: 'featuredFailed'; message: string }
  | { type: 'searchStarted' }
  | { type: 'searchSucceeded'; records: LdacaSearchResult[] }
  | { type: 'searchFailed'; message: string }
  | { type: 'importStarted'; importingId: string }
  | { type: 'importSucceeded' }
  | { type: 'importFinished' };

export const initialLdacaImportState: LdacaImportState = {
  ldacaImportOpen: false,
  searchMethod: 'keyword',
  searchQuery: '',
  collectionFilter: 'all',
  fileFormatFilter: 'all',
  featuredRecords: [],
  searchResults: [],
  hasSearched: false,
  featuredLoaded: false,
  featuredLoading: false,
  searching: false,
  importingId: undefined,
  errorMessage: undefined,
};

/** Owns the LDaCA import dialog's local state transitions as one reducer. */
/**
 * Used by: useLdacaImport and ldacaImportState tests because the Oni import
 * dialog has multiple async phases whose state must be reset consistently.
 * Flow: apply UI field updates, mark featured/search/import async phases, clear
 * stale filters at search start, and close/reset transient search fields after
 * a successful import starts.
 */
export function ldacaImportReducer(
  state: LdacaImportState,
  action: LdacaImportAction,
): LdacaImportState {
  switch (action.type) {
    case 'setOpen':
      return { ...state, ldacaImportOpen: action.open };
    case 'setSearchMethod':
      return { ...state, searchMethod: action.method };
    case 'setSearchQuery':
      return { ...state, searchQuery: action.query };
    case 'setCollectionFilter':
      return { ...state, collectionFilter: action.value };
    case 'setFileFormatFilter':
      return { ...state, fileFormatFilter: action.value };
    case 'featuredInvalidated':
      return { ...state, featuredLoaded: false };
    case 'featuredStarted':
      return { ...state, featuredLoading: true, errorMessage: undefined };
    case 'featuredSucceeded':
      return {
        ...state,
        featuredRecords: action.records,
        featuredLoaded: true,
        featuredLoading: false,
      };
    case 'featuredFailed':
      return { ...state, featuredLoading: false, errorMessage: action.message };
    case 'searchStarted':
      return {
        ...state,
        searching: true,
        hasSearched: true,
        searchResults: [],
        collectionFilter: 'all',
        fileFormatFilter: 'all',
        errorMessage: undefined,
      };
    case 'searchSucceeded':
      return { ...state, searchResults: action.records, searching: false };
    case 'searchFailed':
      return { ...state, searching: false, errorMessage: action.message };
    case 'importStarted':
      return { ...state, importingId: action.importingId };
    case 'importSucceeded':
      return {
        ...state,
        ldacaImportOpen: false,
        searchQuery: '',
        searchResults: [],
        hasSearched: false,
      };
    case 'importFinished':
      return { ...state, importingId: undefined };
  }
}
