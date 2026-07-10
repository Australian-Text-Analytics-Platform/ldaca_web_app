import { useReducer } from 'react';
import { importLdacaDataset, listLdacaFeaturedCollections, searchLdacaCollections } from '@/api';
import type { OniSearchRequest } from '@/api';
import {
  initialLdacaImportState,
  ldacaImportReducer,
  type LdacaSearchMethod,
} from './ldacaImportState';

const LDACA_API_TOKEN_HEADER = 'X-LDACA-API-Token';

type LdacaSearchRequest = Omit<OniSearchRequest, 'method' | 'query'> & {
  method: LdacaSearchMethod;
  query: string;
};

/**
 * Adds an optional Oni API token to generated-client headers. LDaCA search,
 * featured records, and import calls all share this adapter.
 * Called by featured, search, and import request paths in `useLdacaImport`.
 */
function withLdacaApiToken(token?: string | null): Record<string, string> {
  const trimmed = token?.trim();
  return trimmed ? { [LDACA_API_TOKEN_HEADER]: trimmed } : {};
}

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface UseLdacaImportParams {
  ldacaApiToken?: string | null;
  notify: Notify;
}

/**
 * Owns the LDaCA Oni import workflow for the Data Loader. It keeps search,
 * filters, staff picks, token-aware headers, and import progress outside the
 * dialog presentation component.
 * Used by `DataLoaderFeature` to supply Oni search/import state to `DataLoaderDialogs`.
 * Flow: load featured records, run ONI search from dialog filters, import selected records
 * through backend APIs, and keep loading/error state isolated for DataLoaderDialogs.
 */
export function useLdacaImport({ ldacaApiToken, notify }: UseLdacaImportParams) {
  const [state, dispatch] = useReducer(ldacaImportReducer, initialLdacaImportState);

  /**
   * Lazily loads staff-picked collections for the import dialog, with an
   * optional token override after saving/deleting an Oni token.
   * Called by the dialog-open path and `reloadFeaturedRecords` after token changes.
   * Steps: skip cached loads, apply token-aware headers, request featured records, update cached
   * results, and surface load errors through the dialog state.
   */
  const loadFeaturedRecords = async (tokenOverride = ldacaApiToken, force = false) => {
    if (state.featuredLoading || (!force && state.featuredLoaded)) return;

    dispatch({ type: 'featuredStarted' });
    try {
      const { data: response } = await listLdacaFeaturedCollections({
        headers: withLdacaApiToken(tokenOverride),
        throwOnError: true,
      });
      dispatch({ type: 'featuredSucceeded', records: response.data });
    } catch (error) {
      const message = (error as Error).message || 'Failed to load LDaCA staff picks.';
      dispatch({ type: 'featuredFailed', message });
      notify('error', message);
    }
  };

  /**
   * Forces staff picks to reload after token changes so the dialog reflects the
   * current authentication context.
   */
  const reloadFeaturedRecords = async (tokenOverride = ldacaApiToken) => {
    dispatch({ type: 'featuredInvalidated' });
    await loadFeaturedRecords(tokenOverride, true);
  };

  /**
   * Opens/closes the import dialog and triggers the initial staff-picks load on
   * first open.
   */
  const setLdacaImportOpen = (open: boolean) => {
    dispatch({ type: 'setOpen', open });
    if (open) {
      void loadFeaturedRecords();
    }
  };

  const setSearchMethod = (method: LdacaSearchMethod) => {
    dispatch({ type: 'setSearchMethod', method });
  };

  const setSearchQuery = (query: string) => {
    dispatch({ type: 'setSearchQuery', query });
  };

  const setCollectionFilter = (value: string) => {
    dispatch({ type: 'setCollectionFilter', value });
  };

  const setFileFormatFilter = (value: string) => {
    dispatch({ type: 'setFileFormatFilter', value });
  };

  /**
   * Searches the Oni portal using the current method/query and resets local
   * filters so result filtering starts from the full response.
   * Returned to `DataLoaderDialogs` as the search-form submit action.
   * Steps: trim the query, clear stale results/filters, submit the search request, then publish
   * results or an error message for DataLoaderDialogs.
   */
  const handleLdacaSearch = async () => {
    const trimmedQuery = state.searchQuery.trim();
    if (!trimmedQuery) return;

    dispatch({ type: 'searchStarted' });
    try {
      const request: LdacaSearchRequest = {
        method: state.searchMethod,
        query: trimmedQuery,
        limit: 25,
        offset: 0,
      };
      const { data: response } = await searchLdacaCollections({
        body: request,
        headers: withLdacaApiToken(ldacaApiToken),
        throwOnError: true,
      });
      dispatch({ type: 'searchSucceeded', records: response.data });
    } catch (error) {
      const message = (error as Error).message || 'Failed to search LDaCA.';
      dispatch({ type: 'searchFailed', message });
      notify('error', message);
    }
  };

  /**
   * Starts a backend import for a selected Oni record or typed identifier.
   * Returned to `DataLoaderDialogs` for search-result and typed-id import actions.
   * Steps: resolve the selected record, call the import endpoint, close/reset dialog state,
   * and clear the row-level importing flag. The workspace task inbox owns the
   * single file-query invalidation when the background import reaches success.
   */
  const handleLdacaImport = async (recordId?: string) => {
    // an empty recordId should fall through to the typed search query
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const target = (recordId || state.searchQuery).trim();
    if (!target) return;

    dispatch({ type: 'importStarted', importingId: target });
    try {
      const { data: response } = await importLdacaDataset({
        body: { url: target },
        headers: withLdacaApiToken(ldacaApiToken),
        throwOnError: true,
      });

      notify('success', response.message || 'LDaCA import started in background.');
      dispatch({ type: 'importSucceeded' });
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to start LDaCA import.');
    } finally {
      dispatch({ type: 'importFinished' });
    }
  };

  return {
    ldacaImportOpen: state.ldacaImportOpen,
    setLdacaImportOpen,
    searchMethod: state.searchMethod,
    setSearchMethod,
    searchQuery: state.searchQuery,
    setSearchQuery,
    collectionFilter: state.collectionFilter,
    setCollectionFilter,
    fileFormatFilter: state.fileFormatFilter,
    setFileFormatFilter,
    featuredRecords: state.featuredRecords,
    featuredLoading: state.featuredLoading,
    reloadFeaturedRecords,
    searchResults: state.searchResults,
    hasSearched: state.hasSearched,
    searching: state.searching,
    importingId: state.importingId,
    ldacaImporting: Boolean(state.importingId),
    errorMessage: state.errorMessage,
    handleLdacaSearch,
    handleLdacaImport,
  };
}
